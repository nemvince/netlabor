import { zodResolver } from '@hookform/resolvers/zod';
import type { GroupRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash,
  UsersIcon as UsersRound,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { Field, Input, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Section } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';
import { Button } from '@netlabor/ui/components/button';

const groupSchema = z.object({
  name: z
    .string()
    .max(64, 'use at most 64 characters')
    .refine((value) => value.trim() !== '', 'enter a group name'),
  description: z.string().max(512, 'use at most 512 characters'),
});

type GroupValues = z.infer<typeof groupSchema>;

function invalidateGroups() {
  void queryClient.invalidateQueries({ queryKey: orpc.groups.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function GroupDialog({
  group,
  onOpenChange,
}: {
  group?: GroupRow;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = group !== undefined;
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: group?.name ?? '',
      description: group?.description ?? '',
    },
  });

  const createGroup = useMutation({
    ...orpc.groups.create.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      toast.success('Group created.');
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const updateGroup = useMutation({
    ...orpc.groups.update.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      toast.success('Group updated.');
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const pending = createGroup.isPending || updateGroup.isPending;

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const name = values.name.trim();
    const description = values.description.trim();
    const payload = {
      name,
      description: description === '' ? null : description,
    };
    if (group) {
      // Membership and group role bindings are intentionally omitted so a
      // rename never rewrites who belongs to the group.
      updateGroup.mutate({ id: group.id, ...payload });
      return;
    }
    createGroup.mutate(payload);
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={group ? `Edit ${group.name}` : 'Create group'}
      description="Group membership is set from each person's user dialog. This dialog only changes the group's name and description."
      width={520}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field label="Group name" htmlFor="group-name" error={form.formState.errors.name?.message}>
          <Input
            id="group-name"
            autoComplete="off"
            spellCheck={false}
            placeholder="network-operators"
            {...form.register('name')}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="group-description"
          hint="Optional. Say what access this group represents."
          error={form.formState.errors.description?.message}
        >
          <Textarea id="group-description" rows={3} {...form.register('description')} />
        </Field>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="submit" disabled={pending} variant="default" size="sm">
            {pending ? 'Saving…' : editing ? 'Save group' : 'Create group'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Group CRUD for the People page. Every group row links people to project
 * grants; membership itself is edited in the user dialog above.
 */
export function GroupsSection({ canWrite }: { canWrite: boolean }) {
  const [dialog, setDialog] = useState<{ group?: GroupRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);

  const groups = useQuery(orpc.groups.list.queryOptions({ input: {} }));

  const remove = useMutation({
    ...orpc.groups.delete.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      toast.success('Group deleted.');
      setDeleteTarget(null);
    },
  });

  return (
    <Section
      title="Groups"
      description="Membership is edited in each person's user dialog. Group names appear in project grants."
      actions={
        canWrite ? (
          <Button type="button" onClick={() => setDialog({})} variant="default" size="sm">
            <Plus size={14} aria-hidden />
            Create group
          </Button>
        ) : null
      }
    >
      {groups.isPending ? (
        <Loading label="Loading groups…" />
      ) : groups.isError ? (
        <Notice tone="error">{messageOf(groups.error)}</Notice>
      ) : groups.data.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No groups yet"
          description="Create a group to grant several people the same project role, then add people to it from their user dialog."
          action={
            canWrite ? (
              <Button type="button" onClick={() => setDialog({})} variant="default" size="sm">
                Create group
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table label="Groups">
          <THead>
            <Th>Group</Th>
            <Th>Members</Th>
            <Th>Created</Th>
            <Th align="right">Actions</Th>
          </THead>
          <TBody>
            {groups.data.map((group) => (
              <Tr key={group.id}>
                <Td>
                  <div className="tabular text-[12px]">{group.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {group.description ?? 'no description'}
                  </div>
                </Td>
                <Td>
                  <span className="tabular">{group.memberCount}</span>
                  <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {' '}
                    {group.memberCount === 1 ? 'person' : 'people'}
                  </span>
                </Td>
                <Td mono>{formatStamp(group.createdAt)}</Td>
                <Td align="right">
                  {canWrite ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Button
                        type="button"
                        aria-label={`Edit ${group.name}`}
                        title="Edit group"
                        onClick={() => setDialog({ group })}
                        variant="ghost"
                        size="xs"
                      >
                        <Pencil size={13} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        aria-label={`Delete ${group.name}`}
                        title="Delete group"
                        onClick={() => {
                          remove.reset();
                          setDeleteTarget(group);
                        }}
                        variant="ghost"
                        size="xs"
                      >
                        <Trash size={13} aria-hidden />
                      </Button>
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
        <GroupDialog
          {...(dialog.group ? { group: dialog.group } : {})}
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
        title={deleteTarget ? `Delete group ${deleteTarget.name}?` : 'Delete group?'}
        description="The group, its memberships, and its project grants are removed. The people in it and their other roles stay unchanged."
        confirmLabel="Delete group"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id });
        }}
      />
    </Section>
  );
}
