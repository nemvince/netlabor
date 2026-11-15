import { zodResolver } from '@hookform/resolvers/zod';
import type { ComputeRow, PoolRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StackIcon as Layers, PencilIcon as Pencil, PlusIcon as Plus, TrashIcon as Trash   } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { CheckboxOption, Field, Input, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Section } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';

const poolSchema = z.object({
  name: z
    .string()
    .max(64, 'use at most 64 characters')
    .refine((value) => value.trim() !== '', 'enter a pool name'),
  description: z.string().max(512, 'use at most 512 characters'),
  computeIds: z.array(z.string()),
});

type PoolValues = z.infer<typeof poolSchema>;

function invalidatePools() {
  void queryClient.invalidateQueries({ queryKey: orpc.pools.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function PoolDialog({
  pool,
  computes,
  onOpenChange,
}: {
  pool?: PoolRow;
  computes: ComputeRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const editing = pool !== undefined;
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<PoolValues>({
    resolver: zodResolver(poolSchema),
    defaultValues: {
      name: pool?.name ?? '',
      description: pool?.description ?? '',
      computeIds: pool?.computeIds ?? [],
    },
  });

  const selected = form.watch('computeIds');

  const createPool = useMutation({
    ...orpc.pools.create.mutationOptions(),
    onSuccess: () => {
      invalidatePools();
      toast.success('Pool created.');
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const updatePool = useMutation({
    ...orpc.pools.update.mutationOptions(),
    onSuccess: () => {
      invalidatePools();
      toast.success('Pool updated.');
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  function toggleCompute(id: string) {
    const current = form.getValues('computeIds');
    form.setValue(
      'computeIds',
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  }

  const pending = createPool.isPending || updatePool.isPending;

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const name = values.name.trim();
    const description = values.description.trim();
    const payload = {
      name,
      description: description === '' ? null : description,
      computeIds: values.computeIds,
    };
    if (pool) {
      updatePool.mutate({ id: pool.id, ...payload });
      return;
    }
    createPool.mutate(payload);
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={pool ? `Edit ${pool.name}` : 'Create pool'}
      description="A pool is a set of computes that a project or template can place nodes on. The least loaded member is chosen at node creation."
      width={560}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field label="Pool name" htmlFor="pool-name" error={form.formState.errors.name?.message}>
          <Input
            id="pool-name"
            autoComplete="off"
            spellCheck={false}
            placeholder="kvm-hosts"
            {...form.register('name')}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="pool-description"
          hint="Optional. Say what these machines have in common."
          error={form.formState.errors.description?.message}
        >
          <Textarea id="pool-description" rows={3} {...form.register('description')} />
        </Field>
        <Field
          label="Member computes"
          hint="Only computes in the pool can receive nodes placed through it."
        >
          {computes.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              No computes are registered yet. Create the pool now and add computes once an agent
              connects.
            </p>
          ) : (
            <div
              className="grid max-h-56 gap-1 overflow-y-auto rounded-[3px] border p-2 sm:grid-cols-2"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              {computes.map((compute) => (
                <CheckboxOption
                  key={compute.id}
                  label={<span className="tabular">{compute.name}</span>}
                  description={compute.url}
                  checked={selected.includes(compute.id)}
                  onChange={() => toggleCompute(compute.id)}
                />
              ))}
            </div>
          )}
        </Field>
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" className="nb-button" data-variant="primary" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save pool' : 'Create pool'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Compute pool CRUD on the Computes page. Pools select where the controller
 * places nodes when a project or template names a pool instead of a compute.
 */
export function PoolsSection({
  canWrite,
  computes,
}: {
  canWrite: boolean;
  computes: ComputeRow[];
}) {
  const [dialog, setDialog] = useState<{ pool?: PoolRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PoolRow | null>(null);

  const pools = useQuery(orpc.pools.list.queryOptions({ input: {} }));

  const remove = useMutation({
    ...orpc.pools.delete.mutationOptions(),
    onSuccess: () => {
      invalidatePools();
      toast.success('Pool deleted.');
      setDeleteTarget(null);
    },
  });

  function computeNames(pool: PoolRow) {
    return pool.computeIds.map((computeId) => {
      const compute = computes.find((entry) => entry.id === computeId);
      return { id: computeId, name: compute?.name ?? computeId.slice(0, 8) };
    });
  }

  return (
    <Section
      title="Pools"
      description="Pools group computes so projects and templates can pick one by capacity instead of naming a host."
      actions={
        canWrite ? (
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            onClick={() => setDialog({})}
          >
            <Plus size={14} aria-hidden />
            Create pool
          </button>
        ) : null
      }
    >
      {pools.isPending ? (
        <Loading label="Loading pools…" />
      ) : pools.isError ? (
        <Notice tone="error">{messageOf(pools.error)}</Notice>
      ) : pools.data.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No pools yet"
          description="Create a pool to give projects and templates a set of computes to place nodes on."
          action={
            canWrite ? (
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={() => setDialog({})}
              >
                Create pool
              </button>
            ) : undefined
          }
        />
      ) : (
        <Table label="Compute pools">
          <THead>
            <Th>Pool</Th>
            <Th>Computes</Th>
            <Th align="right">Actions</Th>
          </THead>
          <TBody>
            {pools.data.map((pool) => (
              <Tr key={pool.id}>
                <Td>
                  <div className="tabular text-[12px]">{pool.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {pool.description ?? 'no description'}
                  </div>
                </Td>
                <Td>
                  {pool.computeIds.length === 0 ? (
                    <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      no computes in this pool
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {computeNames(pool).map((compute) => (
                        <Badge key={compute.id} tone="copper">
                          {compute.name}
                        </Badge>
                      ))}
                    </span>
                  )}
                </Td>
                <Td align="right">
                  {canWrite ? (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        className="nb-button"
                        data-variant="ghost"
                        data-size="sm"
                        aria-label={`Edit ${pool.name}`}
                        title="Edit pool"
                        onClick={() => setDialog({ pool })}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="nb-button"
                        data-variant="ghost"
                        data-size="sm"
                        aria-label={`Delete ${pool.name}`}
                        title="Delete pool"
                        onClick={() => {
                          remove.reset();
                          setDeleteTarget(pool);
                        }}
                      >
                        <Trash size={13} aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      read-only
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {dialog ? (
        <PoolDialog
          computes={computes}
          {...(dialog.pool ? { pool: dialog.pool } : {})}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            remove.reset();
          }
        }}
        title={deleteTarget ? `Delete pool ${deleteTarget.name}?` : 'Delete pool?'}
        description="The computes stay registered and keep their nodes. Projects and templates that selected this pool lose the assignment; node creation then uses the remaining placement rules."
        confirmLabel="Delete pool"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id });
        }}
      />
    </Section>
  );
}
