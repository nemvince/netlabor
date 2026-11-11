import type { DrawingRow, LinkRow, NodeRow } from '@netlabor/contract';
import type { Edge, Node } from '@xyflow/react';

export type DeviceNodeData = Record<string, unknown> & {
  kind: 'device';
  node: NodeRow;
  svg: string | null;
  projectLocked: boolean;
  remoteColors?: string[];
};

export type DrawingNodeData = Record<string, unknown> & {
  kind: 'drawing';
  drawing: DrawingRow;
  projectId: string;
};

export type FlowNodeData = DeviceNodeData | DrawingNodeData;
export type FlowNode = Node<FlowNodeData, 'device' | 'drawing'>;

export type LinkEdgeData = Record<string, unknown> & {
  link: LinkRow;
  markerFlash?: MarkerFlash;
};
export type FlowEdge = Edge<LinkEdgeData, 'link'>;

export interface MarkerFlash {
  /** Unique per hit so the same marker can restart its animation. */
  key: string;
  color: string;
  name: string;
  duration: number;
}

export const NODE_HANDLE_PREFIX = 'node';

export type HandleSide = 'left' | 'right' | 'top' | 'bottom';

export function nodeHandleId(side: HandleSide): string {
  return `${NODE_HANDLE_PREFIX}:${side}`;
}

/**
 * Pick the pair of sides that faces the peer. Links leave the closest edge of
 * each device, so orthogonal routing never loops around a node.
 */
export function edgeSides(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { source: HandleSide; target: HandleSide } {
  const dx = b.x + NODE_WIDTH / 2 - (a.x + NODE_WIDTH / 2);
  const dy = b.y + NODE_HEIGHT / 2 - (a.y + NODE_HEIGHT / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
  }
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
}

export const NODE_WIDTH = 128;
export const NODE_HEIGHT = 86;
