import type { ComputeRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ActivityIcon as Activity, GaugeIcon as Gauge, KeyIcon as KeyRound, PencilIcon as Pencil, PlusIcon as Plus, HardDrivesIcon as Server, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useState } from 'react';
import { Badge } from '../components/badge.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { EmptyState } from '../components/empty-state.tsx';
import { Loading, Page, PageHeader } from '../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../components/table.tsx';
import { PoolsSection } from '../features/admin/pool-section.tsx';
import { NotAllowed } from '../features/auth/require-auth.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { ComputeDialog, RotateTokenDialog } from '../features/computes/compute-dialog.tsx';
import { ComputeStatsDrawer } from '../features/computes/compute-stats-drawer.tsx';
import { ComputeTrend } from '../features/computes/compute-trend.tsx';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { formatStamp } from '../lib/format.ts';
import { queryClient } from '../lib/query-client.ts';

type DialogState = { mode: 'create' } | { mode: 'edit'; compute: ComputeRow } | null;

function statusTone(status: ComputeRow['status']): 'up' | 'warn' | 'down' {
  if (status === 'online') return 'up';
  if (status === 'error') return 'down';
  return 'warn';
}

export function ComputesPage() {
  const { me, can } = useMe();
  const canRead = can('compute.read');
  const canWrite = can('compute.write');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rotate, setRotate] = useState<ComputeRow | null>(null);
  const [stats, setStats] = useState<ComputeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ComputeRow | null>(null);
  const [pings, setPings] = useState<
    Record<string, { latencyMs: number; version: string | null } | { error: string }>
  >({});

  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    enabled: canRead,
    refetchInterval: 20_000,
  });

  const ping = useMutation({
    ...orpc.computes.ping.mutationOptions(),
    onSuccess: (result, variables) => {
      setPings((current) => ({
        ...current,
        [variables.id]: { latencyMs: result.latencyMs, version: result.version },
      }));
      void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
    },
    onError: (error, variables) => {
      setPings((current) => ({ ...current, [variables.id]: { error: messageOf(error) } }));
    },
  });

  const remove = useMutation({
    ...orpc.computes.delete.mutationOptions(),
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: orpc.computes.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.pools.list.key() });
    },
  });

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="compute.read" />;

  return (
    <Page>
      <PageHeader
        title="Computes"
        description="Every compute runs one agent that owns the local dataplane and emulators. Pools place nodes across a chosen set of computes."
        actions={
          canWrite ? (
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              onClick={() => setDialog({ mode: 'create' })}
            >
              <Plus size={14} aria-hidden /> Add compute
            </button>
          ) : null
        }
      />

      <div className="mt-5">
        {computes.isPending ? (
          <Loading label="Reading computes…" />
        ) : computes.isError ? (
          <EmptyState
            icon={Server}
            title="Computes could not be read"
            description={messageOf(computes.error)}
          />
        ) : computes.data.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No compute registered"
            description="Register a compute agent to place project namespaces, switches, and emulators on a host."
            action={
              canWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setDialog({ mode: 'create' })}
                >
                  <Plus size={14} aria-hidden /> Add compute
                </button>
              ) : null
            }
          />
        ) : (
          <Table label="Compute servers">
            <THead>
              <Th>Compute</Th>
              <Th>Agent URL</Th>
              <Th>Underlay</Th>
              <Th>Status</Th>
              <Th>Trend</Th>
              <Th>Version</Th>
              <Th>Last seen</Th>
              <Th>Pools</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {computes.data.map((compute) => {
                const pingState = pings[compute.id];
                const pinging = ping.isPending && ping.variables?.id === compute.id;
                return (
                  <Tr key={compute.id}>
                    <Td>
                      <span className="font-medium">{compute.name}</span>
                      <span
                        className="tabular block text-[10px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                      >
                        {compute.id.slice(0, 8)}
                      </span>
                    </Td>
                    <Td mono>{compute.url}</Td>
                    <Td mono>
                      {compute.underlayIndex}
                      <span style={{ color: 'var(--color-ink-faint)' }}> · </span>
                      {compute.underlayHost}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(compute.status)}>{compute.status}</Badge>
                      {pingState && 'latencyMs' in pingState ? (
                        <span
                          className="tabular ml-1.5 text-[10px]"
                          style={{ color: 'var(--color-signal-up)' }}
                        >
                          {pingState.latencyMs.toFixed(0)} ms
                        </span>
                      ) : pingState && 'error' in pingState ? (
                        <span
                          className="ml-1.5 text-[10px]"
                          title={pingState.error}
                          style={{ color: 'var(--color-signal-down)' }}
                        >
                          ping failed
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <ComputeTrend key={compute.id} compute={compute} />
                    </Td>
                    <Td mono>{compute.version ?? '—'}</Td>
                    <Td mono>{formatStamp(compute.lastSeenAt)}</Td>
                    <Td>
                      {compute.pools.length === 0 ? (
                        <span style={{ color: 'var(--color-ink-faint)' }}>—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {compute.pools.map((pool) => (
                            <Badge key={pool.id} tone="copper">
                              {pool.name}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          title={`Ping ${compute.name}`}
                          aria-label={`Ping ${compute.name}`}
                          disabled={pinging}
                          onClick={() => ping.mutate({ id: compute.id })}
                        >
                          <Activity size={13} aria-hidden />
                          {pinging ? '…' : null}
                        </button>
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          title={`Statistics for ${compute.name}`}
                          aria-label={`Statistics for ${compute.name}`}
                          onClick={() => setStats(compute)}
                        >
                          <Gauge size={13} aria-hidden />
                        </button>
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              data-variant="ghost"
                              title={`Edit ${compute.name}`}
                              aria-label={`Edit ${compute.name}`}
                              onClick={() => setDialog({ mode: 'edit', compute })}
                            >
                              <Pencil size={13} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              data-variant="ghost"
                              title={`Rotate token for ${compute.name}`}
                              aria-label={`Rotate token for ${compute.name}`}
                              onClick={() => setRotate(compute)}
                            >
                              <KeyRound size={13} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              data-variant="ghost"
                              title={`Delete ${compute.name}`}
                              aria-label={`Delete ${compute.name}`}
                              onClick={() => {
                                remove.reset();
                                setDeleteTarget(compute);
                              }}
                            >
                              <Trash2 size={13} aria-hidden />
                            </button>
                          </>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      <PoolsSection canWrite={canWrite} computes={computes.data ?? []} />

      {dialog ? (
        <ComputeDialog
          {...(dialog.mode === 'edit' ? { compute: dialog.compute } : {})}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      {rotate ? (
        <RotateTokenDialog
          compute={rotate}
          onOpenChange={(open) => {
            if (!open) setRotate(null);
          }}
        />
      ) : null}

      {stats ? <ComputeStatsDrawer compute={stats} onClose={() => setStats(null)} /> : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            remove.reset();
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'compute'}?`}
        description="The compute must not host any nodes. Its project namespaces and dataplane objects are removed from the host."
        confirmLabel="Delete compute"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id });
        }}
      />
    </Page>
  );
}
