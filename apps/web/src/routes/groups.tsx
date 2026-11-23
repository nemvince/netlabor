import type { GroupRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash,
  UsersThreeIcon as UsersThree,
  XIcon as X,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../components/dialog.tsx';
import { Field, Input, Textarea } from '../components/field.tsx';
import { Notice } from '../components/notice.tsx';
import { Loading, Page, PageHeader, Section } from '../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../components/table.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { queryClient } from '../lib/query-client.ts';
import { Button } from '@netlabor/ui/components/button';

function invalidateGroups() {
  void queryClient.invalidateQueries({ queryKey: orpc.groups.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.grants.list.key() });
}

/** Self-service groups: create one, invite classmates, and share projects to it. */
export function GroupsPage() {
  const { me, can } = useMe();
  const groups = useQuery(orpc.groups.list.queryOptions({ input: {} }));
  const [editing, setEditing] = useState<GroupRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const remove = useMutation({
    ...orpc.groups.delete.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      setDeleting(null);
    },
  });

  const canEdit = (group: GroupRow) =>
    can('user.write') || (me !== null && group.ownerId === me.id);
  const rows = groups.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Create a group for a course or team, add classmates, then grant it access from a project's settings."
        actions={
          <Button type="button" size="sm" onClick={() => setEditing('new')}>
            <Plus size={12} aria-hidden /> New group
          </Button>
        }
      />
      <p className="mt-3 text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
        Groups carry no privileges by themselves. They only take effect when a project owner grants
        the group a project role.
      </p>

      <Section title="Your groups">
        {groups.isPending ? (
          <Loading label="Reading groups…" />
        ) : groups.isError ? (
          <Notice tone="error">{messageOf(groups.error)}</Notice>
        ) : rows.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
            No groups yet. Create one to invite people.
          </p>
        ) : (
          <Table label="Groups">
            <THead>
              <Th>Name</Th>
              <Th>Owner</Th>
              <Th align="right">Members</Th>
              <Th align="right">Action</Th>
            </THead>
            <TBody>
              {rows.map((group) => (
                <Tr key={group.id}>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <UsersThree size={13} aria-hidden />
                      <span className="font-medium">{group.name}</span>
                    </span>
                    {group.description ? (
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
                        {group.description}
                      </p>
                    ) : null}
                  </Td>
                  <Td>{group.ownerName ?? 'single sign-on'}</Td>
                  <Td align="right">{group.memberCount}</Td>
                  <Td align="right">
                    {canEdit(group) ? (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditing(group)}
                        >
                          <Pencil size={12} aria-hidden /> Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setDeleting(group)}
                        >
                          <Trash size={12} aria-hidden /> Delete
                        </Button>
                      </span>
                    ) : (
                      <span className="nb-rule-label">read-only</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {editing ? (
        <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete group?'}
        description="Project grants to this group stop applying immediately."
        confirmLabel="Delete group"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleting) remove.mutate({ id: deleting.id });
        }}
      />
    </Page>
  );
}

function GroupDialog({ group, onClose }: { group: GroupRow | null; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [search, setSearch] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({
    ...orpc.groups.members.queryOptions({ input: { id: group?.id ?? '' } }),
    enabled: group !== null,
    retry: false,
  });
  const directory = useQuery({
    ...orpc.users.lookup.queryOptions({
      input: { limit: 50, ...(search.trim() ? { search: search.trim() } : {}) },
    }),
    retry: false,
  });

  useEffect(() => {
    if (group && members.data) setMemberIds(members.data.map((member) => member.id));
  }, [group, members.data]);

  const create = useMutation({
    ...orpc.groups.create.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      onClose();
    },
    onError: (mutationError) => setError(messageOf(mutationError)),
  });
  const update = useMutation({
    ...orpc.groups.update.mutationOptions(),
    onSuccess: () => {
      invalidateGroups();
      onClose();
    },
    onError: (mutationError) => setError(messageOf(mutationError)),
  });

  const known = new Map(
    [...(members.data ?? []), ...(directory.data ?? [])].map((user) => [user.id, user]),
  );
  const candidates = (directory.data ?? []).filter((user) => !memberIds.includes(user.id));
  const pending = create.isPending || update.isPending;

  function save() {
    setError(null);
    if (name.trim() === '') {
      setError('A group name is required.');
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      memberIds,
    };
    if (group) update.mutate({ id: group.id, ...payload });
    else create.mutate(payload);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={group ? `Edit ${group.name}` : 'New group'}
      description="Add people by name or username. You become the owner and can change members later."
      width={620}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Name" htmlFor="group-name">
          <Input
            id="group-name"
            value={name}
            maxLength={64}
            placeholder="Networking 101"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="group-description">
          <Textarea
            id="group-description"
            value={description}
            rows={2}
            maxLength={512}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        {group ? (
          <div
            className="flex flex-col gap-2 border-t pt-3"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <div className="nb-rule-label">members</div>
            {members.isPending ? (
              <Loading label="Reading members…" />
            ) : memberIds.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
                No members yet.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {memberIds.map((id) => {
                  const user = known.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px]"
                      style={{ borderColor: 'var(--color-rule)' }}
                    >
                      {user?.displayName ?? user?.username ?? id}
                      <button
                        type="button"
                        aria-label={`Remove ${user?.username ?? id}`}
                        onClick={() =>
                          setMemberIds((current) => current.filter((entry) => entry !== id))
                        }
                      >
                        <X size={10} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Field label="Find people" htmlFor="group-member-search">
              <Input
                id="group-member-search"
                value={search}
                placeholder="name or username"
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            {candidates.length > 0 ? (
              <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                {candidates.map((user) => (
                  <li key={user.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 truncate">
                      {user.displayName ? `${user.displayName} (${user.username})` : user.username}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="ml-auto"
                      onClick={() => setMemberIds((current) => [...current, user.id])}
                    >
                      <Plus size={11} aria-hidden /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                No matching people.
              </p>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : group ? 'Save group' : 'Create group'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
