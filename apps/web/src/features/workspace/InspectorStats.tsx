import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { Badge } from '../../components/Badge.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { useMe } from '../auth/use-me.ts';

function ComputeUsage({ computeId, computeName }: { computeId: string; computeName: string }) {
  const stats = useQuery({
    ...orpc.computes.stats.queryOptions({ input: { id: computeId } }),
    retry: false,
    refetchInterval: 10_000,
  });

  if (stats.isPending) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
        {computeName} · reading…
      </div>
    );
  }
  if (stats.isError || !stats.data) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--color-signal-down)' }}>
        {computeName} · {stats.isError ? messageOf(stats.error) : 'no statistics'}
      </div>
    );
  }

  const cpuPercent =
    stats.data.cpuCount > 0
      ? Math.min(100, (stats.data.loadAverage[0] / stats.data.cpuCount) * 100)
      : 0;
  const memoryPercent =
    stats.data.memoryTotalBytes > 0
      ? Math.min(100, (stats.data.memoryUsedBytes / stats.data.memoryTotalBytes) * 100)
      : 0;
  const diskPercent =
    stats.data.diskTotalBytes > 0
      ? Math.min(100, (stats.data.diskUsedBytes / stats.data.diskTotalBytes) * 100)
      : 0;

  return (
    <div
      className="rounded-[2px] border px-2 py-1.5"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-raised)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium">{computeName}</span>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {stats.data.cpuCount} CPU · load {stats.data.loadAverage[0].toFixed(2)}
        </span>
      </div>
      <div className="tabular mt-1 grid grid-cols-3 gap-2 text-[10px]">
        <span className="flex items-center gap-1" style={{ color: 'var(--color-copper)' }}>
          <Cpu size={10} aria-hidden /> {cpuPercent.toFixed(0)}%
        </span>
        <span className="flex items-center gap-1" style={{ color: 'var(--color-signal-up)' }}>
          <MemoryStick size={10} aria-hidden /> {memoryPercent.toFixed(0)}%
        </span>
        <span className="flex items-center gap-1" style={{ color: 'var(--color-signal-info)' }}>
          <HardDrive size={10} aria-hidden /> {diskPercent.toFixed(0)}%
        </span>
      </div>
      <div className="tabular mt-0.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        mem {formatBytes(stats.data.memoryUsedBytes)} / {formatBytes(stats.data.memoryTotalBytes)} ·
        disk {formatBytes(stats.data.diskUsedBytes)} / {formatBytes(stats.data.diskTotalBytes)}
      </div>
    </div>
  );
}

/** Project counters plus live per-compute usage for the inspector Stats tab. */
export function ProjectStatsPanel({ projectId }: { projectId: string }) {
  const { can } = useMe();
  const canCompute = can('compute.read');
  const stats = useQuery({
    ...orpc.projects.stats.queryOptions({ input: { id: projectId } }),
    refetchInterval: 15_000,
  });
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    enabled: canCompute,
    retry: false,
  });

  if (stats.isPending) return <Loading label="Reading project counters…" />;
  if (stats.isError) return <Notice tone="error">{messageOf(stats.error)}</Notice>;

  const computeNames = new Map((computes.data ?? []).map((compute) => [compute.id, compute.name]));
  const slotComputeIds = [...new Set(stats.data.slots.map((slot) => slot.computeId))];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1">
        <Counter label="Nodes" value={stats.data.nodeCount} />
        <Counter label="Links" value={stats.data.linkCount} />
        <Counter label="Drawings" value={stats.data.drawingCount} />
      </div>
      <div>
        <div className="nb-rule-label mb-1">Node status</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(stats.data.nodesByStatus).map(([state, count]) => (
            <Badge
              key={state}
              tone={
                state === 'started'
                  ? 'up'
                  : state === 'error'
                    ? 'down'
                    : state === 'suspended'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {state} {count}
            </Badge>
          ))}
          {Object.keys(stats.data.nodesByStatus).length === 0 ? (
            <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              No nodes.
            </span>
          ) : null}
        </div>
      </div>
      <div>
        <div className="nb-rule-label mb-1">Compute usage</div>
        {!canCompute ? (
          <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            Reading compute statistics requires the compute.read privilege.
          </p>
        ) : computes.isError ? (
          <Notice tone="error">{messageOf(computes.error)}</Notice>
        ) : slotComputeIds.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            The project has no slot; creating a node allocates one.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {slotComputeIds.map((computeId) => (
              <ComputeUsage
                key={computeId}
                computeId={computeId}
                computeName={computeNames.get(computeId) ?? computeId.slice(0, 8)}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="nb-rule-label mb-1">Compute slots</div>
        {stats.data.slots.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            The project has no slot yet.
          </p>
        ) : (
          <Table label="Project slots">
            <THead>
              <Th>Slot</Th>
              <Th>Netns</Th>
              <Th>Project IP</Th>
            </THead>
            <TBody>
              {stats.data.slots.map((slot) => (
                <Tr key={`${slot.computeId}-${slot.slot}`}>
                  <Td mono>{slot.slot}</Td>
                  <Td mono>{slot.netns}</Td>
                  <Td mono>{slot.projectIp}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[2px] border px-2 py-1"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-raised)' }}
    >
      <div className="nb-rule-label">{label}</div>
      <div className="tabular text-[14px]">{value}</div>
    </div>
  );
}
