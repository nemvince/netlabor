import { useQuery } from '@tanstack/react-query';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { orpc } from '../../lib/api.ts';
import type { FlowNode, FlowNodeData } from './types.ts';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeOf(filePath: string): string {
  return IMAGE_MIME[filePath.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Image drawing body: the project file fetched once as a data URL. */
function DrawingImage({ projectId, filePath }: { projectId: string; filePath: string }) {
  const file = useQuery(
    orpc.projects.files.read.queryOptions({
      input: { projectId, path: filePath, encoding: 'base64' },
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  if (file.isError) {
    return (
      <div
        className="flex h-full items-center justify-center text-[10px]"
        style={{ color: 'var(--color-signal-down)' }}
      >
        image unavailable
      </div>
    );
  }
  if (!file.data) return null;
  return (
    <img
      src={`data:${mimeOf(filePath)};base64,${file.data.content}`}
      alt="Canvas drawing"
      className="pointer-events-none h-full w-full object-fill"
      draggable={false}
    />
  );
}

function DrawingNodeComponent({ data, selected }: NodeProps<FlowNode>) {
  const payload = data as FlowNodeData;
  if (payload.kind !== 'drawing') return null;
  const { drawing, projectId } = payload;
  const color = drawing.style.stroke ?? 'var(--color-rule-strong)';
  const fill = drawing.style.fill ?? 'transparent';
  const strokeWidth = drawing.style.strokeWidth ?? 1;
  const outline = selected ? '1px dashed var(--color-copper)' : 'none';

  if (drawing.type === 'image') {
    return drawing.filePath && projectId ? (
      <div
        style={{
          width: drawing.width,
          height: drawing.height,
          opacity: drawing.style.opacity ?? 1,
        }}
      >
        <DrawingImage projectId={projectId} filePath={drawing.filePath} />
      </div>
    ) : null;
  }

  if (drawing.type === 'text' || drawing.type === 'note') {
    return (
      <div
        style={{
          width: drawing.width,
          height: drawing.height,
          color: drawing.style.stroke ?? 'var(--color-ink)',
          fontFamily: drawing.type === 'note' ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: drawing.style.fontSize ?? (drawing.type === 'note' ? 12 : 14),
          fontWeight: drawing.style.fontWeight ?? '400',
          textAlign: drawing.style.textAlign ?? 'left',
          padding: drawing.type === 'note' ? 6 : 0,
          background:
            drawing.type === 'note'
              ? 'color-mix(in oklab, var(--color-signal-warn) 10%, var(--color-panel))'
              : 'transparent',
          border: drawing.type === 'note' ? '1px solid var(--color-rule)' : outline,
          outline,
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          opacity: drawing.style.opacity ?? 1,
        }}
      >
        {drawing.text ?? ''}
      </div>
    );
  }

  if (drawing.type === 'ellipse') {
    return (
      <div
        style={{
          width: drawing.width,
          height: drawing.height,
          borderRadius: '50%',
          background: fill,
          border: `${strokeWidth}px ${drawing.style.dash ? 'dashed' : 'solid'} ${color}`,
          outline,
          opacity: drawing.style.opacity ?? 1,
        }}
      />
    );
  }

  if (drawing.type === 'line') {
    return (
      <svg width={drawing.width} height={drawing.height} style={{ overflow: 'visible', outline }}>
        <title>Line</title>
        <line
          x1={0}
          y1={0}
          x2={drawing.width}
          y2={drawing.height}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={drawing.style.dash ?? undefined}
          opacity={drawing.style.opacity ?? 1}
        />
      </svg>
    );
  }

  return (
    <div
      style={{
        width: drawing.width,
        height: drawing.height,
        background: fill,
        border: `${strokeWidth}px ${drawing.style.dash ? 'dashed' : 'solid'} ${color}`,
        outline,
        opacity: drawing.style.opacity ?? 1,
      }}
    />
  );
}

export const DrawingNode = memo(DrawingNodeComponent);
