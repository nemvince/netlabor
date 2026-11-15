import { zodResolver } from '@hookform/resolvers/zod';
import type { SecretRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyIcon as KeyRound, PlusIcon as Plus, TrashIcon as Trash   } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { CopyButton } from '../../components/copy-button.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { Field, Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Section } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';

const secretSchema = z.object({
  name: z
    .string()
    .max(128, 'use at most 128 characters')
    .refine((value) => value.trim() !== '', 'enter a secret name'),
  value: z.string().min(1, 'paste the secret value').max(65536, 'use at most 65536 characters'),
});

type SecretValues = z.infer<typeof secretSchema>;

function invalidateSecrets() {
  void queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function CreateSecretDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SecretValues>({
    resolver: zodResolver(secretSchema),
    defaultValues: { name: '', value: '' },
  });

  const createSecret = useMutation({
    ...orpc.secrets.create.mutationOptions(),
    onSuccess: () => {
      invalidateSecrets();
      toast.success('Secret stored.');
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    createSecret.mutate({ name: values.name.trim(), value: values.value });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Create secret"
      description="The value is encrypted with the controller secret key and never returned by the API. You can only replace it by creating a new secret."
      width={520}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field
          label="Secret name"
          htmlFor="secret-name"
          hint="Use a name an operator can recognise, for example iourc-lab."
          error={form.formState.errors.name?.message}
        >
          <Input
            id="secret-name"
            autoComplete="off"
            spellCheck={false}
            placeholder="iourc-lab"
            {...form.register('name')}
          />
        </Field>
        <Field
          label="Secret value"
          htmlFor="secret-value"
          hint="Pasted once. For IOU, paste the full iourc file contents."
          error={form.formState.errors.value?.message}
        >
          <Input
            id="secret-value"
            type="password"
            autoComplete="off"
            spellCheck={false}
            {...form.register('value')}
          />
        </Field>
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="nb-button"
            data-variant="primary"
            disabled={createSecret.isPending}
          >
            {createSecret.isPending ? 'Storing…' : 'Store secret'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Encrypted secret inventory. IOU reads its iourc license from a secret by
 * ID; the list exposes the ID because that is the value node properties use.
 */
export function SecretsSection({
  canWrite,
  bare = false,
}: {
  canWrite: boolean;
  /** Render the inventory without the Section chrome, for a settings card. */
  bare?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecretRow | null>(null);

  const secrets = useQuery(orpc.secrets.list.queryOptions({ input: {} }));

  const remove = useMutation({
    ...orpc.secrets.delete.mutationOptions(),
    onSuccess: () => {
      invalidateSecrets();
      toast.success('Secret deleted.');
      setDeleteTarget(null);
    },
  });

  const createButton = canWrite ? (
    <button
      type="button"
      className="nb-button"
      data-variant="primary"
      onClick={() => setCreating(true)}
    >
      <Plus size={14} aria-hidden />
      Create secret
    </button>
  ) : null;

  const body = (
    <>
      {secrets.isPending ? (
        <Loading label="Loading secrets…" />
      ) : secrets.isError ? (
        <Notice tone="error">{messageOf(secrets.error)}</Notice>
      ) : secrets.data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No secrets stored"
          description="Create a secret before starting IOU nodes when license checking is on. The value is write-only; copy the secret ID afterwards."
          action={
            canWrite ? (
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={() => setCreating(true)}
              >
                Create secret
              </button>
            ) : undefined
          }
        />
      ) : (
        <Table label="Encrypted secrets">
          <THead>
            <Th>Name</Th>
            <Th>Secret ID</Th>
            <Th>Created</Th>
            <Th align="right">Actions</Th>
          </THead>
          <TBody>
            {secrets.data.map((secret) => (
              <Tr key={secret.id}>
                <Td>
                  <span className="tabular text-[12px]">{secret.name}</span>
                </Td>
                <Td mono>
                  <span className="flex items-center gap-2">
                    <span className="max-w-[300px] break-all text-[11px]">{secret.id}</span>
                    <CopyButton value={secret.id} label="Copy ID" />
                  </span>
                </Td>
                <Td mono>{formatStamp(secret.createdAt)}</Td>
                <Td align="right">
                  {canWrite ? (
                    <button
                      type="button"
                      className="nb-button"
                      data-variant="ghost"
                      data-size="sm"
                      aria-label={`Delete ${secret.name}`}
                      title="Delete secret"
                      onClick={() => {
                        remove.reset();
                        setDeleteTarget(secret);
                      }}
                    >
                      <Trash size={13} aria-hidden />
                    </button>
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

      {creating ? (
        <CreateSecretDialog
          onOpenChange={(open) => {
            if (!open) setCreating(false);
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
        title={deleteTarget ? `Delete secret ${deleteTarget.name}?` : 'Delete secret?'}
        description="The stored value is destroyed and cannot be recovered. IOU nodes that reference this secret ID fail to start until another secret is assigned."
        confirmLabel="Delete secret"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id });
        }}
      />
    </>
  );

  if (bare) {
    return (
      <div className="flex flex-col gap-2">
        {createButton && (secrets.data?.length ?? 0) > 0 ? (
          <div className="flex justify-end">{createButton}</div>
        ) : null}
        {body}
      </div>
    );
  }

  return (
    <Section
      title="Secrets"
      description="IOU nodes read their iourc license from an encrypted secret. Create a secret with the iourc contents, then paste its ID into the iourc secret ID property of an IOU template or node."
      actions={createButton}
    >
      {body}
    </Section>
  );
}
