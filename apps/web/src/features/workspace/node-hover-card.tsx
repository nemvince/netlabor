import type { LinkRow, LinkStatus, NodeRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { HardDriveIcon as HardDrive } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { useMe } from '../auth/use-me.ts';

const CARD_WIDTH = 296;
const CARD_HEIGHT = 380;
const CARD_GAP = 10;
const MAX_SAMPLES = 24;
const DISKS = ['hda', 'hdb', 'hdc', 'hdd'] as const;

const PORT_STATUS: Record<LinkStatus, { color: string; label: string }> = {
  active: { color: 'var(--color-signal-up)', label: 'up' },
  pending: { color: 'var(--color-ink-faint)', label: 'pending' },
  suspended: { color: 'var(--color-signal-warn)', label: 'suspended' },
  error: { color: 'var(--color-signal-down)', label: 'error' },
};
const UNLINKED = { color: 'var(--color-rule-strong)', label: 'unlinked' };

/** Full-bleed trend behind a metric; the value stays legible on top of it. */
function ActivityChart({ values, color }: { values: number[]; color: string }) {
  const gradientId = useId();
  const series = values.length === 1 ? [values[0] ?? 0, values[0] ?? 0] : values;
  const points = series.map((value, index) => {
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 100;
    const y = 100 - Math.min(1, Math.max(0, value / 100)) * 94;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.join(' ');
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 ? (
        <polygon points={`0,100 ${line} 100,100`} fill={`url(#${gradientId})`} stroke="none" />
      ) : null}
      {points.length > 0 ? (
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function Metric({
  label,
  value,
  detail,
  values,
  color,
  divider,
}: {
  label: string;
  value: string;
  detail: string;
  values: number[];
  color: string;
  divider?: boolean;
}) {
  return (
    <section
      className={`relative min-w-0 overflow-hidden px-2 py-1.5${divider ? ' border-l' : ''}`}
      style={divider ? { borderColor: 'var(--color-rule)' } : undefined}
      aria-label={`${label} ${value}`}
    >
      <ActivityChart values={values} color={color} />
      <div className="relative flex flex-col gap-0.5">
        <span className="nb-rule-label flex items-center gap-1">
          <span
            aria-hidden
            className="size-[5px] shrink-0 rounded-full"
            style={{ background: color }}
          />
          {label}
        </span>
        <span className="tabular text-[18px] leading-none" style={{ color: 'var(--color-ink)' }}>
          {value}
          {value === '—' ? null : <span className="text-[10px]">%</span>}
        </span>
        <span className="tabular truncate text-[9.5px]" style={{ color: 'var(--color-ink-faint)' }}>
          {detail}
        </span>
      </div>
    </section>
  );
}

interface Sample {
  at: string;
  cpu: number;
  memory: number;
}

/** Outside React so a node's trend survives the card closing between hovers. */
const history = new Map<string, Sample[]>();

function numberProperty(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function diskSizes(properties: Record<string, unknown>): { disk: string; size: number }[] {
  const disks = properties.disks;
  if (typeof disks !== 'object' || disks === null) return [];
  return DISKS.flatMap((disk) => {
    const entry = (disks as Record<string, unknown>)[disk];
    if (typeof entry !== 'object' || entry === null) return [];
    const size = numberProperty((entry as Record<string, unknown>).sizeBytes);
    return size === null ? [] : [{ disk, size }];
  });
}

/** Read-only summary of a device, shown while the cursor rests on it. */
export function NodeHoverCard({
  node,
  links,
  point,
}: {
  node: NodeRow | undefined;
  links: LinkRow[];
  point: { x: number; y: number };
}) {
  const { can } = useMe();
  const [samples, setSamples] = useState<Sample[]>(() =>
    node ? (history.get(node.id) ?? []) : [],
  );

  const canCompute = can('compute.read');
  const stats = useQuery({
    ...orpc.computes.stats.queryOptions({ input: { id: node?.computeId ?? '' } }),
    enabled: Boolean(node && node.status === 'started' && canCompute),
    retry: false,
    refetchInterval: 5_000,
  });

  const live = stats.data;
  useEffect(() => {
    if (!node || !live) return;
    const own = live.processes.filter((process) => process.nodeId === node.id);
    const cpu = Math.min(
      100,
      own.reduce((sum, process) => sum + process.cpuPercent, 0),
    );
    const ram = numberProperty(node.properties.ram);
    const memoryBytes = own.reduce((sum, process) => sum + process.memoryBytes, 0);
    const memory = ram && ram > 0 ? Math.min(100, (memoryBytes / (ram * 1024 * 1024)) * 100) : 0;
    setSamples((current) => {
      if (current.at(-1)?.at === live.collectedAt) return current;
      const next = [...current, { at: live.collectedAt, cpu, memory }].slice(-MAX_SAMPLES);
      history.set(node.id, next);
      return next;
    });
  }, [live, node]);

  if (!node) return null;

  const centered = point.x - CARD_WIDTH / 2;
  const left = Math.max(8, Math.min(centered, window.innerWidth - CARD_WIDTH - 8));
  const fitsBelow = point.y + CARD_GAP + CARD_HEIGHT <= window.innerHeight - 8;
  const top = fitsBelow ? point.y + CARD_GAP : Math.max(8, point.y - CARD_HEIGHT - CARD_GAP);
  const cpus = numberProperty(node.properties.cpus);
  const ram = numberProperty(node.properties.ram);
  const disks = diskSizes(node.properties);
  const diskTotal = disks.reduce((sum, entry) => sum + entry.size, 0);
  const liveSamples = node.status === 'started' ? samples : [];
  const latest = liveSamples.at(-1);
  const liveState = stats.isError ? 'unavailable' : latest ? 'live' : 'waiting';
  const linksByPort = new Map<string, LinkRow>();
  for (const link of links) {
    if (link.nodeAId === node.id) {
      linksByPort.set(`${link.adapterA}:${link.portA}`, link);
    } else if (link.nodeBId === node.id) {
      linksByPort.set(`${link.adapterB}:${link.portB}`, link);
    }
  }
  const portsUp = node.ports.filter(
    (port) => linksByPort.get(`${port.adapter}:${port.port}`)?.status === 'active',
  ).length;

  return (
    <div
      className="pointer-events-none fixed z-[65] flex flex-col overflow-hidden rounded-[3px] border text-[11px] shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
      style={{
        left,
        top,
        width: CARD_WIDTH,
        maxHeight: CARD_HEIGHT,
        background: 'var(--color-panel)',
        borderColor: 'var(--color-rule-strong)',
        color: 'var(--color-ink-dim)',
      }}
      role="tooltip"
      aria-label={`${node.name} · ${node.nodeType} · ${node.status}`}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="truncate text-[12px] font-semibold" style={{ color: 'var(--color-ink)' }}>
          {node.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span style={{ color: 'var(--color-ink-faint)' }}>{node.nodeType}</span>
          <Badge
            tone={
              node.status === 'started'
                ? 'up'
                : node.status === 'error'
                  ? 'down'
                  : node.status === 'suspended'
                    ? 'warn'
                    : 'neutral'
            }
          >
            {node.status}
          </Badge>
        </span>
      </div>

      {cpus !== null || ram !== null || node.status === 'started' ? (
        <div
          className={`grid border-t ${ram === null ? 'grid-cols-1' : 'grid-cols-2'}`}
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <Metric
            label="CPU"
            value={latest ? latest.cpu.toFixed(0) : '—'}
            detail={cpus === null ? liveState : `${cpus} vCPU`}
            values={liveSamples.map((sample) => sample.cpu)}
            color="var(--color-copper)"
          />
          {ram === null ? null : (
            <Metric
              label="Memory"
              value={latest ? latest.memory.toFixed(0) : '—'}
              detail={`${ram} MB`}
              values={liveSamples.map((sample) => sample.memory)}
              color="var(--color-signal-info)"
              divider
            />
          )}
        </div>
      ) : null}

      {disks.length > 0 ? (
        <section
          className="border-t px-2.5 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
          aria-label={`Disk ${formatBytes(diskTotal)}`}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="nb-rule-label flex items-center gap-1">
              <HardDrive size={10} aria-hidden /> Storage
            </span>
            <span className="tabular" style={{ color: 'var(--color-ink)' }}>
              {formatBytes(diskTotal)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {disks.map((entry) => (
              <div
                key={entry.disk}
                className="flex items-baseline justify-between gap-2 text-[10px]"
              >
                <span className="tabular">{entry.disk}</span>
                <span className="tabular" style={{ color: 'var(--color-ink-faint)' }}>
                  {formatBytes(entry.size)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="border-t px-2.5 py-1.5"
        style={{ borderColor: 'var(--color-rule)' }}
        aria-label="Interfaces"
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="nb-rule-label">Interfaces</span>
          <span className="tabular" style={{ color: 'var(--color-ink)' }}>
            {portsUp}/{node.ports.length} up
          </span>
        </div>
        {node.ports.length === 0 ? (
          <p style={{ color: 'var(--color-ink-faint)' }}>No linkable ports.</p>
        ) : (
          <div className="flex flex-col gap-0.5 text-[10px]">
            {node.ports.slice(0, 6).map((port) => {
              const link = linksByPort.get(`${port.adapter}:${port.port}`);
              const status = link ? PORT_STATUS[link.status] : UNLINKED;
              const peer = link
                ? link.nodeAId === node.id
                  ? link.nodeBName
                  : link.nodeAName
                : 'unlinked';
              return (
                <div
                  key={`${port.adapter}:${port.port}`}
                  className="flex items-center justify-between gap-2"
                  title={`${port.name} · ${status.label}${link ? ` · ${peer}` : ''}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-[5px] shrink-0 rounded-full"
                      style={{ background: status.color }}
                    />
                    <span className="truncate">{port.name}</span>
                  </span>
                  <span
                    className="flex min-w-0 shrink-0 items-center gap-1.5"
                    style={{ color: 'var(--color-ink-faint)' }}
                  >
                    <span className="max-w-[92px] truncate">{peer}</span>
                    <span className="tabular shrink-0" style={{ color: status.color }}>
                      {status.label}
                    </span>
                  </span>
                </div>
              );
            })}
            {node.ports.length > 6 ? (
              <span style={{ color: 'var(--color-ink-faint)' }}>+{node.ports.length - 6} more</span>
            ) : null}
          </div>
        )}
      </section>

      <div
        className="flex items-center justify-between gap-2 border-t px-2.5 py-1.5 text-[10px]"
        style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-faint)' }}
      >
        <span className="truncate">{node.computeName}</span>
        <span className="tabular shrink-0">
          {node.isolated ? 'isolated · ' : ''}
          {node.consolePort === null ? 'no console' : `console ${node.consolePort}`}
        </span>
      </div>
    </div>
  );
}
