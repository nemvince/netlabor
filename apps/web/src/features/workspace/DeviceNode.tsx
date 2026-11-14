import type { NodeStatus } from '@netlabor/contract';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { SymbolGlyph } from '../../components/SymbolGlyph.tsx';
import {
  type FlowNode,
  type FlowNodeData,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeHandleId,
} from './types.ts';

const STATUS_COLOR: Record<NodeStatus, string> = {
  started: 'var(--color-signal-up)',
  stopped: 'var(--color-ink-faint)',
  suspended: 'var(--color-signal-warn)',
  error: 'var(--color-signal-down)',
};

/** Colored device artwork is never recolored; status lives in the dot and opacity. */
const STATUS_OPACITY: Record<NodeStatus, number> = {
  started: 1,
  stopped: 0.72,
  suspended: 0.9,
  error: 1,
};

/** Bare device symbol: icon, name caption, status dot, and invisible handles. */
function DeviceNodeComponent({ data, selected }: NodeProps<FlowNode>) {
  const payload = data as FlowNodeData;
  if (payload.kind !== 'device') return null;
  const { node, svg, remoteColors } = payload;
  const statusColor = STATUS_COLOR[node.status];

  return (
    <div
      className="relative flex flex-col items-center justify-center"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      aria-label={`${node.name} · ${node.nodeType} · ${node.status}${node.isolated ? ' · isolated' : ''}`}
    >
      <div
        className="relative flex items-center justify-center rounded-[6px] transition-colors"
        style={{
          width: 60,
          height: 60,
          opacity: STATUS_OPACITY[node.status],
          background: selected
            ? 'color-mix(in oklab, var(--color-copper) 14%, transparent)'
            : 'transparent',
          boxShadow: selected ? 'inset 0 0 0 2px var(--color-copper)' : undefined,
          outline: node.isolated ? '1px dashed var(--color-signal-warn)' : undefined,
        }}
      >
        <SymbolGlyph svg={svg} className="size-[52px]" />
        <span
          aria-hidden
          className="absolute right-0.5 bottom-0.5 inline-block size-[6px] rounded-full"
          style={{
            background: statusColor,
            border: '1.5px solid var(--color-canvas, var(--color-panel))',
            boxShadow:
              node.status === 'started'
                ? '0 0 5px color-mix(in oklab, var(--color-signal-up) 60%, transparent)'
                : undefined,
          }}
        />
      </div>

      <div
        className="mt-0.5 max-w-full truncate px-1 text-center text-[10px] leading-[1.3]"
        style={{ color: selected ? 'var(--color-ink)' : 'var(--color-ink-dim)' }}
      >
        {node.name}
      </div>

      {remoteColors && remoteColors.length > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 -bottom-[2px] h-[2px] rounded-full"
          style={{
            background:
              remoteColors.length === 1
                ? remoteColors[0]
                : `linear-gradient(90deg, ${remoteColors.join(', ')})`,
          }}
        />
      ) : null}

      {(
        [
          // Handles sit on the icon's edge, not the caption's, so links meet the device.
          { side: 'left', position: Position.Left, style: { left: 22, top: 37 } },
          { side: 'right', position: Position.Right, style: { right: 22, top: 37 } },
          { side: 'top', position: Position.Top, style: { top: 4, left: '50%' } },
          { side: 'bottom', position: Position.Bottom, style: { bottom: 4, left: '50%' } },
        ] as const
      ).map(({ side, position, style }) => (
        <Handle
          key={side}
          id={nodeHandleId(side)}
          type="source"
          position={position}
          isConnectable={false}
          aria-hidden
          style={{
            ...style,
            width: 1,
            height: 1,
            minWidth: 0,
            minHeight: 0,
            border: 0,
            background: 'transparent',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
