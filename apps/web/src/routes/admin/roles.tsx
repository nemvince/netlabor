import { zodResolver } from '@hookform/resolvers/zod';
import { PRIVILEGES, type Privilege, type RoleRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, Pencil, Plus, ShieldCheck, Trash } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { Field, Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Page, PageHeader } from '../../components/page.tsx';
import { PrivilegeGrid } from '../../components/privilege-grid.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { ALL_PRIVILEGES, READ_PRIVILEGES } from '../../lib/privileges.ts';
import { queryClient } from '../../lib/query-client.ts';

const roleSchema = z.object({
  name: z.string().min(1, 'enter a role name').max(64, 'use at most 64 characters'),
  description: z.string().max(512, 'use at most 512 characters'),
  privileges: z.array(z.enum(PRIVILEGES)),
});

type RoleValues = z.infer<typeof roleSchema>;

function invalidateRoles() {
  void queryClient.invalidateQueries({ queryKey: orpc.roles.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function RoleDialog({
  role,
  onOpenChange,
}: {
  role?: RoleRow;
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      privileges: role?.privileges ?? [],
    },
  });

  const createRole = useMutation({
    ...orpc.roles.create.mutationOptions(),
    onSuccess: () => {
      invalidateRoles();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });
  const updateRole = useMutation({
    ...orpc.roles.update.mutationOptions(),
    onSuccess: () => {
      invalidateRoles();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const selected = form.watch('privileges');

  function toggle(privilege: Privilege) {
    const current = form.getValues('privileges');
    form.setValue(
      'privileges',
      current.includes(privilege)
        ? current.filter((value) => value !== privilege)
        : [...current, privilege],
      { shouldDirty: true },
    );
  }

  function select(values: readonly Privilege[]) {
    form.setValue('privileges', [...values], { shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const base = {
      name: values.name.trim(),
      description: values.description.trim() === '' ? null : values.description.trim(),
      privileges: values.privileges,
    };
    if (role) updateRole.mutate({ id: role.id, ...base });
    else createRole.mutate(base);
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={role ? `Edit role ${role.name}` : 'Create role'}
      description="Roles bundle privileges. Assign them globally or per project through grants."
      width={720}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="role-name" error={form.formState.errors.name?.message}>
            <Input id="role-name" spellCheck={false} {...form.register('name')} />
          </Field>
          <Field
            label="Description"
            htmlFor="role-description"
            error={form.formState.errors.description?.message}
          >
            <Input id="role-description" placeholder="optional" {...form.register('description')} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="nb-rule-label">
            Privileges · <span className="tabular">{selected.length}</span> of{' '}
            {ALL_PRIVILEGES.length}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => select(ALL_PRIVILEGES)}
            >
              Select all
            </button>
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => select(READ_PRIVILEGES)}
            >
              Read-only
            </button>
            <button type="button" className="nb-button" data-size="sm" onClick={() => select([])}>
              Clear
            </button>
          </span>
        </div>
        <PrivilegeGrid selected={selected} onToggle={toggle} />
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="nb-button"
            data-variant="primary"
            disabled={createRole.isPending || updateRole.isPending}
          >
            {createRole.isPending || updateRole.isPending
              ? 'Saving…'
              : role
                ? 'Save role'
                : 'Create role'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ViewRoleDialog({
  role,
  onOpenChange,
}: {
  role: RoleRow;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Role ${role.name}`}
      description={
        role.builtin
          ? 'Built-in role: fixed by the contract and read-only.'
          : (role.description ?? 'Custom role.')
      }
      width={720}
    >
      <div className="flex flex-col gap-3">
        {role.builtin ? (
          <Notice tone="info">
            Built-in roles cannot be edited or deleted. Create a custom role if this set does not
            fit.
          </Notice>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="nb-rule-label">
            Privileges · <span className="tabular">{role.privileges.length}</span>
          </span>
        </div>
        <PrivilegeGrid selected={role.privileges} disabled />
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

export function RolesAdminPage() {
  const { me, can } = useMe();
  const canRead = can('user.read');
  const canWrite = can('user.write');
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; role: RoleRow } | { mode: 'view'; role: RoleRow } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  const roles = useQuery({ ...orpc.roles.list.queryOptions({ input: {} }), enabled: canRead });

  const deleteRole = useMutation({
    ...orpc.roles.delete.mutationOptions(),
    onSuccess: () => {
      invalidateRoles();
      setDeleteTarget(null);
    },
  });

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="user.read" />;

  return (
    <Page>
      <PageHeader
        title="Roles"
        description="The six built-in roles are fixed; custom roles hold any subset of the privilege list."
        actions={
          canWrite ? (
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              onClick={() => setDialog({ mode: 'create' })}
            >
              <Plus size={14} aria-hidden />
              Create role
            </button>
          ) : null
        }
      />

      <div className="mt-4">
        {roles.isPending ? (
          <Loading label="Loading roles…" />
        ) : roles.isError ? (
          <Notice tone="error">{messageOf(roles.error)}</Notice>
        ) : roles.data.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No roles defined"
            description="Create a role to give a group of users a shared privilege set."
            action={
              canWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setDialog({ mode: 'create' })}
                >
                  Create role
                </button>
              ) : undefined
            }
          />
        ) : (
          <Table label="Roles">
            <THead>
              <Th>Role</Th>
              <Th>Kind</Th>
              <Th>Privileges</Th>
              <Th>Created</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {roles.data.map((role) => (
                <Tr key={role.id}>
                  <Td>
                    <div className="tabular text-[12px]">{role.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      {role.description ?? 'no description'}
                    </div>
                  </Td>
                  <Td>
                    {role.builtin ? (
                      <Badge tone="neutral" title="Built-in roles are fixed">
                        built-in
                      </Badge>
                    ) : (
                      <Badge tone="copper">custom</Badge>
                    )}
                  </Td>
                  <Td>
                    <span className="tabular">{role.privileges.length}</span>
                    <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      {' '}
                      /{ALL_PRIVILEGES.length}
                    </span>
                  </Td>
                  <Td mono>{formatStamp(role.createdAt)}</Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        className="nb-button"
                        data-variant="ghost"
                        data-size="sm"
                        aria-label={`View privileges of ${role.name}`}
                        title="View privileges"
                        onClick={() => setDialog({ mode: 'view', role })}
                      >
                        <Eye size={13} aria-hidden />
                      </button>
                      {!role.builtin && canWrite ? (
                        <>
                          <button
                            type="button"
                            className="nb-button"
                            data-variant="ghost"
                            data-size="sm"
                            aria-label={`Edit ${role.name}`}
                            title="Edit role"
                            onClick={() => setDialog({ mode: 'edit', role })}
                          >
                            <Pencil size={13} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="nb-button"
                            data-variant="ghost"
                            data-size="sm"
                            aria-label={`Delete ${role.name}`}
                            title="Delete role"
                            onClick={() => setDeleteTarget(role)}
                          >
                            <Trash size={13} aria-hidden />
                          </button>
                        </>
                      ) : role.builtin ? (
                        <span
                          className="px-1 text-[11px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                          title="Built-in roles cannot be edited"
                        >
                          locked
                        </span>
                      ) : null}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      {dialog?.mode === 'create' ? (
        <RoleDialog
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <RoleDialog
          role={dialog.role}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.mode === 'view' ? (
        <ViewRoleDialog
          role={dialog.role}
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
            deleteRole.reset();
          }
        }}
        title={deleteTarget ? `Delete role ${deleteTarget.name}?` : 'Delete role?'}
        description="Users and groups bound to this role lose its privileges immediately. Project grants that reference it are removed."
        confirmLabel="Delete role"
        pending={deleteRole.isPending}
        error={deleteRole.error}
        onConfirm={() => {
          if (deleteTarget) deleteRole.mutate({ id: deleteTarget.id });
        }}
      />
    </Page>
  );
}
