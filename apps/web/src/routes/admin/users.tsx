import { zodResolver } from '@hookform/resolvers/zod';
import type { GroupRow, RoleRow, UserRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyIcon as KeyRound, PencilIcon as Pencil, PlusIcon as Plus, TrashIcon as Trash, UsersIcon as UsersRound   } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { CheckboxOption, Field, Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Page, PageHeader } from '../../components/page.tsx';
import { SearchInput } from '../../components/search-input.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { GroupsSection } from '../../features/admin/group-section.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';

interface AssignmentOption {
  id: string;
  name: string;
}

function invalidateUsers() {
  void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.groups.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function AssignmentList({
  label,
  hint,
  options,
  selected,
  onToggle,
  emptyText,
}: {
  label: string;
  hint?: string;
  options: AssignmentOption[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyText: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {options.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
          {emptyText}
        </p>
      ) : (
        <div
          className="grid max-h-40 gap-1 overflow-y-auto rounded-[3px] border p-2 sm:grid-cols-2"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          {options.map((option) => (
            <CheckboxOption
              key={option.id}
              label={<span className="tabular">{option.name}</span>}
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />
          ))}
        </div>
      )}
    </Field>
  );
}

const createSchema = z.object({
  username: z
    .string()
    .min(3, 'use at least 3 characters')
    .max(64, 'use at most 64 characters')
    .regex(/^[a-z0-9._-]+$/, 'lowercase letters, digits, dot, dash, underscore only'),
  password: z.string().min(12, 'use at least 12 characters').max(256, 'use at most 256 characters'),
  email: z.union([z.string().email('enter a valid email address'), z.literal('')]),
  displayName: z.string().max(128, 'use at most 128 characters'),
  isActive: z.boolean(),
  roleIds: z.array(z.string()),
  groupIds: z.array(z.string()),
});

type CreateValues = z.infer<typeof createSchema>;

function CreateUserDialog({
  roles,
  groups,
  onOpenChange,
}: {
  roles: RoleRow[];
  groups: GroupRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: '',
      password: '',
      email: '',
      displayName: '',
      isActive: true,
      roleIds: [],
      groupIds: [],
    },
  });

  const createUser = useMutation({
    ...orpc.users.create.mutationOptions(),
    onSuccess: () => {
      invalidateUsers();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const selectedRoles = form.watch('roleIds');
  const selectedGroups = form.watch('groupIds');
  const toggle = (field: 'roleIds' | 'groupIds', id: string) => {
    const current = form.getValues(field);
    form.setValue(
      field,
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    createUser.mutate({
      username: values.username.toLowerCase(),
      password: values.password,
      email: values.email.trim() === '' ? null : values.email.trim(),
      displayName: values.displayName.trim() === '' ? null : values.displayName.trim(),
      isActive: values.isActive,
      roleIds: values.roleIds,
      groupIds: values.groupIds,
    });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Create user"
      description="Local account with a password. Roles and groups apply immediately."
      width={640}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Username"
            htmlFor="new-username"
            error={form.formState.errors.username?.message}
          >
            <Input
              id="new-username"
              autoComplete="off"
              spellCheck={false}
              placeholder="alice"
              {...form.register('username')}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="new-password"
            hint="Minimum 12 characters."
            error={form.formState.errors.password?.message}
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </Field>
          <Field label="Email" htmlFor="new-email" error={form.formState.errors.email?.message}>
            <Input
              id="new-email"
              type="email"
              autoComplete="off"
              placeholder="optional"
              {...form.register('email')}
            />
          </Field>
          <Field
            label="Display name"
            htmlFor="new-display-name"
            error={form.formState.errors.displayName?.message}
          >
            <Input
              id="new-display-name"
              autoComplete="off"
              placeholder="optional"
              {...form.register('displayName')}
            />
          </Field>
        </div>
        <CheckboxOption
          label="Account is active"
          description="Inactive accounts cannot sign in, and existing sessions stop working."
          checked={form.watch('isActive')}
          onChange={(event) =>
            form.setValue('isActive', event.target.checked, { shouldDirty: true })
          }
        />
        <AssignmentList
          label="Global roles"
          hint="Owner is only assignable through project grants."
          options={roles
            .filter((role) => role.name !== 'owner')
            .map((role) => ({ id: role.id, name: role.name }))}
          selected={selectedRoles}
          onToggle={(id) => toggle('roleIds', id)}
          emptyText="No roles exist yet. Create one on the Roles page."
        />
        <AssignmentList
          label="Groups"
          options={groups.map((group) => ({ id: group.id, name: group.name }))}
          selected={selectedGroups}
          onToggle={(id) => toggle('groupIds', id)}
          emptyText="No groups exist yet."
        />
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="nb-button"
            data-variant="primary"
            disabled={createUser.isPending}
          >
            {createUser.isPending ? 'Creating…' : 'Create user'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const updateSchema = z.object({
  email: z.union([z.string().email('enter a valid email address'), z.literal('')]),
  displayName: z.string().max(128, 'use at most 128 characters'),
  isActive: z.boolean(),
  roleIds: z.array(z.string()),
  groupIds: z.array(z.string()),
});

type UpdateValues = z.infer<typeof updateSchema>;

function EditUserDialog({
  user,
  roles,
  groups,
  onOpenChange,
}: {
  user: UserRow;
  roles: RoleRow[];
  groups: GroupRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<UpdateValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      isActive: user.isActive,
      roleIds: user.roles.map((role) => role.id),
      groupIds: user.groups.map((group) => group.id),
    },
  });

  const updateUser = useMutation({
    ...orpc.users.update.mutationOptions(),
    onSuccess: () => {
      invalidateUsers();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const selectedRoles = form.watch('roleIds');
  const selectedGroups = form.watch('groupIds');
  const toggle = (field: 'roleIds' | 'groupIds', id: string) => {
    const current = form.getValues(field);
    form.setValue(
      field,
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    updateUser.mutate({
      id: user.id,
      email: values.email.trim() === '' ? null : values.email.trim(),
      displayName: values.displayName.trim() === '' ? null : values.displayName.trim(),
      isActive: values.isActive,
      roleIds: values.roleIds,
      groupIds: values.groupIds,
    });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Edit ${user.username}`}
      description="Change contact details, account state, roles, and group membership."
      width={640}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" htmlFor="edit-email" error={form.formState.errors.email?.message}>
            <Input id="edit-email" type="email" autoComplete="off" {...form.register('email')} />
          </Field>
          <Field
            label="Display name"
            htmlFor="edit-display-name"
            error={form.formState.errors.displayName?.message}
          >
            <Input id="edit-display-name" autoComplete="off" {...form.register('displayName')} />
          </Field>
        </div>
        <CheckboxOption
          label="Account is active"
          description="Inactive accounts cannot sign in, and existing sessions stop working."
          checked={form.watch('isActive')}
          onChange={(event) =>
            form.setValue('isActive', event.target.checked, { shouldDirty: true })
          }
        />
        <AssignmentList
          label="Global roles"
          options={roles
            .filter((role) => role.name !== 'owner')
            .map((role) => ({ id: role.id, name: role.name }))}
          selected={selectedRoles}
          onToggle={(id) => toggle('roleIds', id)}
          emptyText="No roles exist yet."
        />
        <AssignmentList
          label="Groups"
          options={groups.map((group) => ({ id: group.id, name: group.name }))}
          selected={selectedGroups}
          onToggle={(id) => toggle('groupIds', id)}
          emptyText="No groups exist yet."
        />
        <LinkedIdentities userId={user.id} />
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="nb-button"
            data-variant="primary"
            disabled={updateUser.isPending}
          >
            {updateUser.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, 'use at least 12 characters')
      .max(256, 'use at most 256 characters'),
    confirm: z.string().min(1, 'repeat the new password'),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'passwords do not match',
    path: ['confirm'],
  });

type SetPasswordValues = z.infer<typeof setPasswordSchema>;

function SetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserRow;
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const setPassword = useMutation({
    ...orpc.users.setPassword.mutationOptions(),
    onSuccess: () => {
      invalidateUsers();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    setPassword.mutate({ id: user.id, password: values.password });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Set password for ${user.username}`}
      description="The new password replaces the old one and signs this user out everywhere."
      width={460}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field
          label="New password"
          htmlFor="set-password"
          hint="Minimum 12 characters, maximum 256."
          error={form.formState.errors.password?.message}
        >
          <Input
            id="set-password"
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
        <Field
          label="Repeat password"
          htmlFor="set-password-confirm"
          error={form.formState.errors.confirm?.message}
        >
          <Input
            id="set-password-confirm"
            type="password"
            autoComplete="new-password"
            {...form.register('confirm')}
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
            disabled={setPassword.isPending}
          >
            {setPassword.isPending ? 'Setting…' : 'Set password'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

type UserDialog =
  { mode: 'create' } | { mode: 'edit'; user: UserRow } | { mode: 'password'; user: UserRow } | null;

export function UsersAdminPage() {
  const { me, can } = useMe();
  const canRead = can('user.read');
  const canWrite = can('user.write');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dialog, setDialog] = useState<UserDialog>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const users = useQuery({
    ...orpc.users.list.queryOptions({
      input: { search: debouncedSearch || undefined, limit: 200, offset: 0 },
    }),
    enabled: canRead,
  });
  const roles = useQuery({
    ...orpc.roles.list.queryOptions({ input: {} }),
    enabled: canRead,
  });
  const groups = useQuery({
    ...orpc.groups.list.queryOptions({ input: {} }),
    enabled: canRead,
  });

  const deleteUser = useMutation({
    ...orpc.users.delete.mutationOptions(),
    onSuccess: () => {
      invalidateUsers();
      setDeleteTarget(null);
    },
  });

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="user.read" />;

  const roleRows = roles.data ?? [];
  const groupRows = groups.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Local accounts, their roles, and the groups used for project grants."
        actions={
          <>
            <SearchInput
              label="Search users"
              placeholder="Search users"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              wrapperStyle={{ width: 220 }}
            />
            {canWrite ? (
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={() => setDialog({ mode: 'create' })}
              >
                <Plus size={14} aria-hidden />
                Create user
              </button>
            ) : null}
          </>
        }
      />

      <div className="mt-5">
        {users.isPending ? (
          <Loading label="Loading users…" />
        ) : users.isError ? (
          <Notice tone="error">{messageOf(users.error)}</Notice>
        ) : users.data.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title={debouncedSearch ? 'No matching users' : 'No users yet'}
            description={
              debouncedSearch
                ? `No account matches “${debouncedSearch}”. Clear the search to list everyone.`
                : 'Create a local account to give someone access to this controller.'
            }
            action={
              canWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setDialog({ mode: 'create' })}
                >
                  Create user
                </button>
              ) : undefined
            }
          />
        ) : (
          <Table label="Users">
            <THead>
              <Th>User</Th>
              <Th>Roles</Th>
              <Th>Groups</Th>
              <Th>Account</Th>
              <Th>Created</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {users.data.map((user) => (
                <Tr key={user.id}>
                  <Td>
                    <div className="tabular text-[12px]">{user.username}</div>
                    <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      {user.displayName ?? user.email ?? 'no display name'}
                    </div>
                  </Td>
                  <Td>
                    {user.roles.length === 0 ? (
                      <span style={{ color: 'var(--color-ink-faint)' }}>—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <Badge key={role.id} tone="neutral">
                            {role.name}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {user.groups.length === 0 ? (
                      <span style={{ color: 'var(--color-ink-faint)' }}>—</span>
                    ) : (
                      <span className="text-[12px]">
                        {user.groups.map((group) => group.name).join(', ')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {user.isActive ? (
                      <Badge tone="up">active</Badge>
                    ) : (
                      <Badge tone="down">disabled</Badge>
                    )}
                  </Td>
                  <Td mono>{formatStamp(user.createdAt)}</Td>
                  <Td align="right">
                    {canWrite ? (
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          className="nb-button"
                          data-variant="ghost"
                          data-size="sm"
                          aria-label={`Edit ${user.username}`}
                          title="Edit user"
                          onClick={() => setDialog({ mode: 'edit', user })}
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="nb-button"
                          data-variant="ghost"
                          data-size="sm"
                          aria-label={`Set password for ${user.username}`}
                          title="Set password"
                          onClick={() => setDialog({ mode: 'password', user })}
                        >
                          <KeyRound size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="nb-button"
                          data-variant="ghost"
                          data-size="sm"
                          aria-label={`Delete ${user.username}`}
                          title="Delete user"
                          onClick={() => setDeleteTarget(user)}
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
      </div>

      <GroupsSection canWrite={canWrite} />

      {dialog?.mode === 'create' ? (
        <CreateUserDialog
          roles={roleRows}
          groups={groupRows}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <EditUserDialog
          user={dialog.user}
          roles={roleRows}
          groups={groupRows}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.mode === 'password' ? (
        <SetPasswordDialog
          user={dialog.user}
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
            deleteUser.reset();
          }
        }}
        title={deleteTarget ? `Delete ${deleteTarget.username}?` : 'Delete user?'}
        description="The account, its sessions, API keys, and project grants are removed. Projects owned by this user block deletion until ownership is transferred."
        confirmLabel="Delete user"
        pending={deleteUser.isPending}
        error={deleteUser.error}
        onConfirm={() => {
          if (deleteTarget) deleteUser.mutate({ id: deleteTarget.id });
        }}
      />
    </Page>
  );
}

/** Read-only list of OIDC identities linked to a local account. */
function LinkedIdentities({ userId }: { userId: string }) {
  const identities = useQuery({
    ...orpc.auth.oidc.identities.queryOptions({ input: { userId } }),
    retry: false,
  });
  return (
    <fieldset
      className="flex flex-col gap-1.5 rounded-[3px] border px-3 py-2"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      <legend className="nb-rule-label px-1">Linked single sign-on</legend>
      {identities.isPending ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          Reading external identities…
        </p>
      ) : identities.isError ? (
        <Notice tone="error">{messageOf(identities.error)}</Notice>
      ) : identities.data.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          No external identity is linked. The next OIDC sign-in creates one when the provider allows
          auto-create.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-[11px]">
          {identities.data.map((identity) => (
            <li
              key={`${identity.providerId}:${identity.subject}`}
              className="flex flex-wrap items-center gap-x-2"
            >
              <span className="font-medium">{identity.providerName}</span>
              <span className="tabular break-all" style={{ color: 'var(--color-ink-faint)' }}>
                {identity.subject}
              </span>
              {identity.email ? (
                <span style={{ color: 'var(--color-ink-dim)' }}>{identity.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
