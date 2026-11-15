import { zodResolver } from '@hookform/resolvers/zod';
import { PROJECT_ROLE_NAMES } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CopyIcon as Copy, LinkIcon as Link2, TrashIcon as Trash2, UserPlusIcon as UserPlus   } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
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

/** Project access: grants, revocable share links, and the grant form. */
export function ProjectAccessPanel({ projectId }: { projectId: string }) {
  const { can } = useMe();
  const canReadPeople = can('user.read');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ttlHours, setTtlHours] = useState(24);
  const [createdLink, setCreatedLink] = useState<{ path: string; expiresAt: string } | null>(null);

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

  // reset subject when type changes.
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

  const shareLinks = useQuery({
    ...orpc.shares.list.queryOptions({ input: { projectId } }),
    retry: false,
  });
  const createLink = useMutation({
    mutationFn: () => client.shares.create({ projectId, ttlHours }),
    onSuccess: (link) => {
      setError(null);
      setCreatedLink({ path: link.path, expiresAt: link.expiresAt });
      setNotice('Share link created. Copy it now; it is only shown once.');
      void queryClient.invalidateQueries({ queryKey: orpc.shares.list.key() });
    },
    onError: (linkError) => setError(messageOf(linkError)),
  });
  const revokeLink = useMutation({
    mutationFn: (id: string) => client.shares.revoke({ id, projectId }),
    onSuccess: () => {
      setError(null);
      setNotice('Share link revoked.');
      void queryClient.invalidateQueries({ queryKey: orpc.shares.list.key() });
    },
    onError: (revokeError) => setError(messageOf(revokeError)),
  });

  async function copyShareLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${createdLink.path}`);
      setNotice('Share link copied to the clipboard.');
    } catch {
      setNotice('Copy failed; select the link and copy it manually.');
    }
  }

  const changeRole = useMutation({
    ...orpc.grants.create.mutationOptions(),
    onSuccess: (grant) => {
      setError(null);
      setNotice(`${grant.subjectName} now holds the ${grant.roleName} role on this project.`);
      invalidateGrants();
    },
    onError: (changeError) => setError(messageOf(changeError)),
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

  const pending = create.isPending || remove.isPending || changeRole.isPending;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div
        className="flex flex-col gap-2 border-b pb-4"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <div className="flex items-center gap-1.5 text-[12px] font-medium">
          <Link2 size={13} aria-hidden /> Read-only link
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
          Anyone with the link opens this project as a guest with the viewer role. The link expires
          on its own, and redeeming it replaces whatever session that browser had.
        </p>
        <div className="flex items-end gap-2">
          <Field label="Expires after" htmlFor="share-ttl">
            <Select
              id="share-ttl"
              value={ttlHours}
              onChange={(event) => setTtlHours(Number(event.target.value))}
            >
              <option value={1}>1 hour</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </Select>
          </Field>
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            data-variant="primary"
            disabled={createLink.isPending}
            onClick={() => createLink.mutate()}
          >
            {createLink.isPending ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {createdLink ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label="Share link"
              value={`${window.location.origin}${createdLink.path}`}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="nb-button" data-size="sm" onClick={copyShareLink}>
              <Copy size={12} aria-hidden /> Copy
            </button>
          </div>
        ) : null}
        {shareLinks.isError ? (
          <Notice tone="error">{messageOf(shareLinks.error)}</Notice>
        ) : (shareLinks.data ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1">
            {(shareLinks.data ?? []).map((link) => (
              <li key={link.id} className="flex items-center gap-2 text-[11px]">
                <span className="tabular" style={{ color: 'var(--color-ink-faint)' }}>
                  expires {new Date(link.expiresAt).toLocaleString()}
                </span>
                <span style={{ color: 'var(--color-ink-faint)' }}>
                  · {link.createdByName ?? 'unknown'}
                </span>
                <button
                  type="button"
                  className="nb-button ml-auto"
                  data-size="sm"
                  data-variant="ghost"
                  disabled={revokeLink.isPending}
                  onClick={() => revokeLink.mutate(link.id)}
                >
                  <Trash2 size={12} aria-hidden /> Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

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
                <Td>
                  {canReadPeople ? (
                    <Select
                      aria-label={`Role for ${grant.subjectName}`}
                      value={grant.roleId}
                      disabled={pending}
                      onChange={(event) =>
                        changeRole.mutate({
                          projectId,
                          subjectType: grant.subjectType,
                          subjectId: grant.subjectId,
                          roleId: event.target.value,
                        })
                      }
                    >
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    grant.roleName
                  )}
                </Td>
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
            <Select id="grant-subject-type" disabled={pending} {...form.register('subjectType')}>
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
          <Field label="Role" htmlFor="grant-role" error={form.formState.errors.roleId?.message}>
            <Select
              id="grant-role"
              disabled={!canReadPeople || pending}
              {...form.register('roleId')}
            >
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
  );
}
