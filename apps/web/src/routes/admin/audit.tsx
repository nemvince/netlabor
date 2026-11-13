import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { SettingsNav } from '../../features/settings/SettingsNav.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp, shortId } from '../../lib/format.ts';

const PAGE_SIZE = 50;

export function AuditAdminPage() {
  const { me, can } = useMe();
  const canRead = can('audit.read');
  const canReadUsers = can('user.read');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [userId, setUserId] = useState('');
  const [filters, setFilters] = useState({ action: '', resourceType: '' });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({ action: action.trim(), resourceType: resourceType.trim() });
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [action, resourceType]);

  const users = useQuery({
    ...orpc.users.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    enabled: canRead && canReadUsers,
  });

  const audit = useQuery({
    ...orpc.audit.list.queryOptions({
      input: {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
        ...(userId ? { userId } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      },
    }),
    enabled: canRead,
  });

  function toggleRow(id: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="audit.read" />;

  const rows = audit.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Audit"
        description="Every mutation lands here with the actor, the resource, the client IP, and the redacted request payload."
        actions={
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            onClick={() => void audit.refetch()}
            disabled={audit.isFetching}
          >
            {audit.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      <SettingsNav />

      <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_220px]">
        <Field label="Action" htmlFor="audit-action">
          <Input
            id="audit-action"
            placeholder="e.g. users.create"
            spellCheck={false}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </Field>
        <Field label="Resource type" htmlFor="audit-resource-type">
          <Input
            id="audit-resource-type"
            placeholder="e.g. users"
            spellCheck={false}
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
          />
        </Field>
        <Field
          label="User"
          htmlFor="audit-user"
          hint={canReadUsers ? undefined : 'Reading the user list requires user.read.'}
        >
          {canReadUsers ? (
            <Select
              id="audit-user"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All users</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="audit-user"
              placeholder="e.g. 01a1d23f-…"
              spellCheck={false}
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value.trim());
                setPage(0);
              }}
            />
          )}
        </Field>
      </div>

      <div className="mt-4">
        {audit.isPending ? (
          <Loading label="Loading audit log…" />
        ) : audit.isError ? (
          <Notice tone="error">{messageOf(audit.error)}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit rows"
            description={
              filters.action || filters.resourceType || userId
                ? 'No entry matches these filters. Widen the action or resource type.'
                : 'Mutations are recorded here as they happen.'
            }
          />
        ) : (
          <>
            <Table label="Audit log">
              <THead>
                <Th> </Th>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
                <Th>IP</Th>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const open = expanded.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <Tr>
                        <Td>
                          <button
                            type="button"
                            className="nb-button"
                            data-variant="ghost"
                            data-size="sm"
                            aria-label={open ? 'Hide payload' : 'Show payload'}
                            aria-expanded={open}
                            onClick={() => toggleRow(row.id)}
                          >
                            {open ? (
                              <ChevronDown size={13} aria-hidden />
                            ) : (
                              <ChevronRight size={13} aria-hidden />
                            )}
                          </button>
                        </Td>
                        <Td mono title={row.createdAt}>
                          {formatStamp(row.createdAt)}
                        </Td>
                        <Td mono>{row.username ?? 'system'}</Td>
                        <Td mono>{row.action}</Td>
                        <Td>
                          <span className="text-[12px]">{row.resourceType}</span>
                          <span
                            className="tabular ml-1 text-[11px]"
                            style={{ color: 'var(--color-ink-faint)' }}
                            title={row.resourceId ?? undefined}
                          >
                            {shortId(row.resourceId)}
                          </span>
                        </Td>
                        <Td mono>{row.ip ?? '—'}</Td>
                      </Tr>
                      {open ? (
                        <tr
                          className="border-b last:border-b-0"
                          style={{
                            borderColor: 'var(--color-rule)',
                            background: 'var(--color-panel-sunken)',
                          }}
                        >
                          <td colSpan={6} className="px-3 py-2.5">
                            <div className="nb-rule-label mb-1">payload · redacted</div>
                            <pre
                              className="tabular max-h-72 overflow-auto rounded-[3px] border p-3 text-[11px] leading-[1.6]"
                              style={{
                                borderColor: 'var(--color-rule)',
                                background: 'var(--color-panel)',
                                color: 'var(--color-ink-dim)',
                              }}
                            >
                              {JSON.stringify(row.data, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
            <div
              className="mt-2 flex items-center justify-between gap-2 text-[11px]"
              style={{ color: 'var(--color-ink-faint)' }}
            >
              <span className="tabular">
                rows {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={rows.length < PAGE_SIZE}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
