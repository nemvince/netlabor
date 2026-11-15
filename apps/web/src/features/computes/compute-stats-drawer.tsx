import type { ComputeRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, MemoryStick, X } from 'lucide-react';
import { Badge } from '../../components/badge.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { shortId } from '../../lib/format.ts';

function percent(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
}

function Meter({
  label,
  used,
  total,
  tone = 'var(--color-signal-info)',
}: {
  label: string;
  used: number;
  total: number;
  tone?: string;
}) {
  const value = percent(used, total);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="nb-rule-label">{label}</span>
        <span className="tabular" style={{ color: 'var(--color-ink-dim)' }}>
          {formatBytes(used)} / {formatBytes(total)} · {value.toFixed(1)}%
        </span>
      </div>
      <meter
        className="h-1.5 w-full"
        min={0}
        max={100}
        value={value}
        aria-label={label}
        style={{ accentColor: tone }}
      />
    </div>
  );
}

/**
 * Compute statistics pane. CPU, memory, and disk are polled while open so the
 * values are live rather than a snapshot from page load.
 */
export function ComputeStatsDrawer({
  compute,
  onClose,
}: {
  compute: ComputeRow;
  onClose: () => void;
}) {
  const stats = useQuery({
    ...orpc.computes.stats.queryOptions({ input: { id: compute.id } }),
    refetchInterval: 5000,
  });

  return (
    <aside
      aria-label={`Statistics for ${compute.name}`}
      className="fixed inset-y-0 right-0 z-30 flex w-[440px] max-w-[92vw] flex-col border-l"
      style={{ borderColor: 'var(--color-rule-strong)', background: 'var(--color-panel)' }}
    >
      <header
        className="flex items-start justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{compute.name}</h2>
            <Badge
              tone={
                compute.status === 'online' ? 'up' : compute.status === 'error' ? 'down' : 'warn'
              }
            >
              {compute.status}
            </Badge>
          </div>
          <p className="tabular mt-0.5 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            {compute.url} · underlay {compute.underlayIndex} · {compute.underlayHost}
          </p>
        </div>
        <button
          type="button"
          className="nb-button"
          data-variant="ghost"
          data-size="sm"
          aria-label="Close statistics"
          onClick={onClose}
        >
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {stats.isPending ? (
          <Loading label="Reading compute statistics…" />
        ) : stats.isError ? (
          <Notice tone="error">{messageOf(stats.error)}</Notice>
        ) : (
          <div className="flex flex-col gap-4">
            <section className="grid grid-cols-3 gap-2">
              <Fact icon={Cpu} label="CPUs" value={String(stats.data.cpuCount)} />
              <Fact
                icon={Cpu}
                label="Load"
                value={stats.data.loadAverage.map((value) => value.toFixed(2)).join(' / ')}
              />
              <Fact icon={MemoryStick} label="Processes" value={String(stats.data.processCount)} />
            </section>
            <Meter
              label="Memory"
              used={stats.data.memoryUsedBytes}
              total={stats.data.memoryTotalBytes}
              tone="var(--color-signal-info)"
            />
            <Meter
              label="Disk"
              used={stats.data.diskUsedBytes}
              total={stats.data.diskTotalBytes}
              tone="var(--color-copper)"
            />
            <div className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              <span className="tabular">uptime {formatUptime(stats.data.uptimeSeconds)}</span>
              <span aria-hidden> · </span>
              <span className="tabular">
                sampled {new Date(stats.data.collectedAt).toLocaleTimeString()}
              </span>
            </div>

            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">Processes</h3>
                <HardDrive size={14} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
              </div>
              {stats.data.processes.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
                  No attributable emulator processes are running on this compute.
                </p>
              ) : (
                <Table label="Compute processes">
                  <THead>
                    <Th>Process</Th>
                    <Th>Node</Th>
                    <Th align="right">CPU</Th>
                    <Th align="right">Memory</Th>
                  </THead>
                  <TBody>
                    {stats.data.processes.map((process) => (
                      <Tr key={`${process.pid}-${process.name}`}>
                        <Td mono>
                          {process.name}
                          <span style={{ color: 'var(--color-ink-faint)' }}> · {process.pid}</span>
                        </Td>
                        <Td mono>{process.nodeId ? shortId(process.nodeId) : '—'}</Td>
                        <Td mono align="right">
                          {process.cpuPercent.toFixed(1)}%
                        </Td>
                        <Td mono align="right">
                          {formatBytes(process.memoryBytes)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div
      className="rounded-[3px] border px-2 py-1.5"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-raised)' }}
    >
      <div className="flex items-center gap-1">
        <Icon size={11} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
        <span className="nb-rule-label">{label}</span>
      </div>
      <div className="tabular mt-0.5 text-[13px]">{value}</div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
