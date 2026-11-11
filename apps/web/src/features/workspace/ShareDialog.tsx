import { zodResolver } from '@hookform/resolvers/zod';
import { PROJECT_ROLE_NAMES } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { useMe } from '../auth/use-me.ts';

const grantSchema = z.object({
  subjectType: z.enum(['user', 'group']),
  subjectId: z.string().min(1, 'choose a user or a group'),
  roleId: z.string().min(1, 'choose a role'),
});

type GrantValues = z.infer<typeof grantSchema>;

function invalidateGrants() {
  void queryClient.invalidateQueries({ queryKey: orpc.grants.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
}

/** Project sharing: grant users or groups a project role and revoke grants. */
export function ShareDialog({
  projectId,
  onOpenChange,
}: {
  projectId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useMe();
  const canReadPeople = can('user.read');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const grants = useQuery({
    ...orpc.grants.list.queryOptions({ input: { projectId } }),
    retry: false,
  });
  const users = useQuery({
    ...orpc.users.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    enabled: canReadPeople,
    retry: false,
  });
  const groups = useQuery({
    ...orpc.groups.list.queryOptions({ input: {} }),
    enabled: canReadPeople,
    retry: false,
  });
  const roles = useQuery({
    ...orpc.roles.list.queryOptions({ input: {} }),
    enabled: canReadPeople,
    retry: false,
  });

  const form = useForm<GrantValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: { subjectType: 'user', subjectId: '', roleId: '' },
  });
  const subjectType = form.watch('subjectType');

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset subject when type changes.
  useEffect(() => {
    form.setValue('subjectId', '');
  }, [subjectType, form]);

  const create = useMutation({
    ...orpc.grants.create.mutationOptions(),
    onSuccess: (grant) => {
      setError(null);
      setNotice(`${grant.subjectName} now holds the ${grant.roleName} role on this project.`);
      form.reset({ subjectType: grant.subjectType, subjectId: '', roleId: '' });
      invalidateGrants();
    },
    onError: (createError) => setError(messageOf(createError)),
  });

  const remove = useMutation({
    ...orpc.grants.delete.mutationOptions(),
    onSuccess: () => {
      setError(null);
      setNotice('Grant removed.');
      invalidateGrants();
    },
    onError: (removeError) => setError(messageOf(removeError)),
  });

  function submit(values: GrantValues) {
    setNotice(null);
    create.mutate({
      projectId,
      subjectType: values.subjectType,
      subjectId: values.subjectId,
      roleId: values.roleId,
    });
  }

  const grantRows = grants.data ?? [];
  const assignableRoles = (roles.data ?? []).filter((role) => role.name !== 'admin');
  const projectRoleOrder = PROJECT_ROLE_NAMES as readonly string[];
  assignableRoles.sort((left, right) => {
    const leftIndex = projectRoleOrder.indexOf(left.name);
    const rightIndex = projectRoleOrder.indexOf(right.name);
    if (leftIndex === -1 && rightIndex === -1) return left.name.localeCompare(right.name);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  const subjectOptions =
    subjectType === 'user'
      ? (users.data ?? []).map((user) => ({
          id: user.id,
          label: user.displayName ? `${user.displayName} (${user.username})` : user.username,
        }))
      : (groups.data ?? []).map((group) => ({ id: group.id, label: group.name }));

  const pending = create.isPending || remove.isPending;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Share project"
      description="A grant adds project-scoped privileges to one user or group. Owner covers membership and deletion; editor covers topology changes."
      width={640}
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}

        {grants.isPending ? (
          <Loading label="Reading grants…" />
        ) : grants.isError ? (
          <Notice tone="error">{messageOf(grants.error)}</Notice>
        ) : grantRows.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
            Only the project owner and administrators can reach this project. Add a grant to invite
            someone else.
          </p>
        ) : (
          <Table label="Project grants">
            <THead>
              <Th>Member</Th>
              <Th>Type</Th>
              <Th>Role</Th>
              <Th align="right">Action</Th>
            </THead>
            <TBody>
              {grantRows.map((grant) => (
                <Tr key={grant.id}>
                  <Td>{grant.subjectName}</Td>
                  <Td>
                    <span className="nb-rule-label">{grant.subjectType}</span>
                  </Td>
                  <Td>{grant.roleName}</Td>
                  <Td align="right">
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      data-variant="ghost"
                      disabled={pending}
                      aria-label={`Remove grant for ${grant.subjectName}`}
                      title={`Remove ${grant.subjectName}`}
                      onClick={() => remove.mutate({ id: grant.id, projectId })}
                    >
                      <Trash2 size={13} aria-hidden /> Remove
                    </button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <form
          className="flex flex-col gap-3 border-t pt-3"
          style={{ borderColor: 'var(--color-rule)' }}
          onSubmit={form.handleSubmit(submit)}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <UserPlus size={13} aria-hidden /> Grant access
          </div>
          {canReadPeople ? null : (
            <Notice tone="info">
              Loading users, groups, and roles requires the user.read privilege.
            </Notice>
          )}
          <div className="grid grid-cols-[120px_1fr_170px] gap-2">
            <Field label="Member type" htmlFor="grant-subject-type">
              <Select
                id="grant-subject-type"
                disabled={pending}
                {...form.register('subjectType')}
              >
                <option value="user">User</option>
                <option value="group">Group</option>
              </Select>
            </Field>
            <Field
              label={subjectType === 'user' ? 'User' : 'Group'}
              htmlFor="grant-subject-id"
              error={form.formState.errors.subjectId?.message}
            >
              <Select
                id="grant-subject-id"
                disabled={!canReadPeople || pending}
                {...form.register('subjectId')}
              >
                <option value="">
                  {subjectType === 'user' ? 'Choose a user' : 'Choose a group'}
                </option>
                {subjectOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Role"
              htmlFor="grant-role"
              error={form.formState.errors.roleId?.message}
            >
              <Select id="grant-role" disabled={!canReadPeople || pending} {...form.register('roleId')}>
                <option value="">Choose a role</option>
                {assignableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </button>
            <button
              type="submit"
              className="nb-button"
              data-size="sm"
              data-variant="primary"
              disabled={!canReadPeople || pending}
            >
              {create.isPending ? 'Granting…' : 'Add grant'}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
