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

function DeviceNodeComponent({ data, selected }: NodeProps<FlowNode>) {
  const payload = data as FlowNodeData;
  if (payload.kind !== 'device') return null;
  const { node, svg, remoteColors } = payload;
  const statusColor = STATUS_COLOR[node.status];
  const ports = node.ports;

  const litPorts = ports.slice(0, 8);
  const hiddenPorts = ports.length - litPorts.length;

  return (
    <div
      className="relative rounded-[2px] border"
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: 'var(--color-panel-raised)',
        borderColor: selected ? 'var(--color-copper)' : 'var(--color-rule-strong)',
        boxShadow: selected
          ? '0 0 0 1px var(--color-copper), 0 8px 20px rgba(0,0,0,0.4)'
          : '0 3px 9px rgba(0,0,0,0.28)',
      }}
      title={`${node.name} · ${node.nodeType} · ${node.status}`}
    >
      <div
        className="absolute inset-x-0 top-0 flex h-[20px] items-center gap-1.5 border-b px-2"
        style={{
          borderColor: 'color-mix(in oklab, var(--color-rule) 70%, transparent)',
          background: 'var(--color-panel)',
        }}
      >
        <span
          aria-hidden
          className="inline-block size-[5px] rounded-full"
          style={{
            background: statusColor,
            boxShadow:
              node.status === 'started'
                ? '0 0 5px color-mix(in oklab, var(--color-signal-up) 60%, transparent)'
                : undefined,
          }}
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[9px] leading-none"
          style={{ color: 'var(--color-ink-faint)' }}
        >
          {node.nodeType}
        </span>
        <span className="flex shrink-0 items-center gap-[2px]" aria-hidden>
          {litPorts.map((port) => (
            <span
              key={`${port.adapter}:${port.port}`}
              className="inline-block h-[5px] w-[4px] rounded-[1px]"
              style={{
                background:
                  node.status === 'started'
                    ? 'color-mix(in oklab, var(--color-signal-up) 60%, var(--color-panel-sunken))'
                    : 'var(--color-rule-strong)',
              }}
            />
          ))}
          {hiddenPorts > 0 ? (
            <span
              className="ml-0.5 font-mono text-[8px] leading-none"
              style={{ color: 'var(--color-ink-faint)' }}
            >
              +{hiddenPorts}
            </span>
          ) : null}
        </span>
      </div>

      <div className="absolute top-[28px] left-2 flex h-7 w-7 items-center justify-center">
        <SymbolGlyph svg={svg} className="size-6" />
      </div>
      <div className="absolute top-[26px] right-2 left-10 min-w-0">
        <div className="truncate text-[12px] leading-[1.2] font-semibold">{node.name}</div>
        <div
          className="mt-0.5 flex items-center gap-1 text-[10px] leading-[1.3]"
          style={{ color: 'var(--color-ink-dim)' }}
        >
          <span
            aria-hidden
            className="inline-block size-[4px] rounded-full"
            style={{ background: statusColor }}
          />
          {node.status}
        </div>
      </div>

      <div
        className="absolute inset-x-2 bottom-1 flex items-center gap-1 font-mono text-[9px] leading-none"
        style={{ color: 'var(--color-ink-faint)' }}
      >
        <span>{ports.length === 1 ? '1 port' : `${ports.length} ports`}</span>
        {node.isolated ? (
          <span
            className="ml-auto rounded-[1px] border px-1 py-[1px]"
            style={{
              color: 'var(--color-signal-warn)',
              borderColor: 'color-mix(in oklab, var(--color-signal-warn) 40%, transparent)',
            }}
          >
            isolated
          </span>
        ) : null}
      </div>

      {remoteColors && remoteColors.length > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 -bottom-[3px] h-[2px] rounded-full"
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
          { side: 'left', position: Position.Left, style: { left: 0, top: '50%' } },
          { side: 'right', position: Position.Right, style: { right: 0, top: '50%' } },
          { side: 'top', position: Position.Top, style: { top: 0, left: '50%' } },
          { side: 'bottom', position: Position.Bottom, style: { bottom: 0, left: '50%' } },
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
