import type { LinkStatus } from '@netlabor/contract';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from '@xyflow/react';
import { memo } from 'react';
import type { FlowEdge, LinkEdgeData } from './types.ts';

const STATUS_COLOR: Record<LinkStatus, string> = {
  active: 'var(--color-ink-faint)',
  pending: 'var(--color-rule-strong)',
  suspended: 'var(--color-signal-warn)',
  error: 'var(--color-signal-down)',
};

const STATUS_LAMP: Record<LinkStatus, string> = {
  active: 'var(--color-signal-up)',
  pending: 'var(--color-ink-faint)',
  suspended: 'var(--color-signal-warn)',
  error: 'var(--color-signal-down)',
};

function LinkEdgeComponent({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps<FlowEdge>) {
  const payload = data as LinkEdgeData | undefined;
  if (!payload) return null;
  const { link } = payload;
  const pathOptions = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };
  const [path, labelX, labelY] =
    link.style.type === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : link.style.type === 'orthogonal'
        ? getSmoothStepPath({ ...pathOptions, borderRadius: 8, offset: 20 })
        : getBezierPath(pathOptions);

  const color = link.style.color ?? STATUS_COLOR[link.status];
  const width = link.style.width ?? 1.75;
  const dash =
    link.style.dash ??
    (link.status === 'pending' || link.status === 'suspended' ? '5 4' : undefined);

  const filters = link.filters;
  const filterParts: string[] = [];
  if (filters.delayMs !== undefined) filterParts.push(`delay ${filters.delayMs}ms`);
  if (filters.jitterMs !== undefined) filterParts.push(`jitter ${filters.jitterMs}ms`);
  if (filters.lossPct !== undefined) filterParts.push(`loss ${filters.lossPct}%`);
  if (filters.corruptPct !== undefined) filterParts.push(`corrupt ${filters.corruptPct}%`);
  if (filters.frequencyDrop !== undefined) filterParts.push(`freq ${filters.frequencyDrop}`);
  if (filters.rateKbps !== undefined) filterParts.push(`${filters.rateKbps} kbit/s`);
  if (filters.bpf) filterParts.push('bpf');
  const recording = link.capture?.active === true;
  const flash = payload.markerFlash;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={22}
        style={{
          stroke: selected ? 'var(--color-copper)' : color,
          strokeWidth: selected ? width + 1 : width,
          strokeDasharray: dash,
          opacity: link.status === 'pending' ? 0.75 : 1,
        }}
      />
      {flash ? (
        <path
          key={flash.key}
          d={path}
          fill="none"
          stroke={flash.color}
          strokeWidth={width + 5}
          strokeLinecap="round"
          pointerEvents="none"
          className="nb-marker-pulse-path"
          style={{
            animationDuration: `${flash.duration}ms`,
            filter: `drop-shadow(0 0 4px ${flash.color})`,
          }}
        />
      ) : null}
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute flex items-center gap-1.5 rounded-[2px] border px-1.5 py-[1px] text-[9px] whitespace-nowrap"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            color: selected ? 'var(--color-copper)' : 'var(--color-ink-dim)',
            borderColor: selected ? 'var(--color-copper)' : 'var(--color-rule)',
            background: 'var(--color-panel-sunken)',
            fontFamily: 'var(--font-mono)',
          }}
          title={`${link.nodeAName}:${link.adapterA}/${link.portA} ↔ ${link.nodeBName}:${link.adapterB}/${link.portB} · ${link.status}`}
        >
          <span
            aria-hidden
            className="inline-block size-[5px] rounded-full"
            style={{ background: STATUS_LAMP[link.status] }}
          />
          <span>{link.status}</span>
          {link.style.label ? (
            <span
              className="max-w-32 truncate border-l pl-1.5"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              {link.style.label}
            </span>
          ) : null}
          {recording ? (
            <span title="capture active" style={{ color: 'var(--color-signal-down)' }}>
              REC
            </span>
          ) : null}
          {filterParts.length > 0 ? (
            <span
              className="border-l pl-1.5"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              {filterParts.join(' ')}
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const LinkEdge = memo(LinkEdgeComponent);
