import { ConnectionMode, type EdgeTypes, type NodeTypes, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DeviceNode } from '@web/features/workspace/device-node.tsx';
import { DrawingNode } from '@web/features/workspace/drawing-node.tsx';
import { LinkEdge } from '@web/features/workspace/link-edge.tsx';
import {
  edgeSides,
  type FlowEdge,
  type FlowNode,
  nodeHandleId,
} from '@web/features/workspace/types.ts';
import {
  drawings as fixtureDrawings,
  links as fixtureLinks,
  nodes as fixtureNodes,
  nodeByName,
  PROJECT_ID,
  symbols,
} from '../fixtures/workspace.ts';

const nodeTypes: NodeTypes = { device: DeviceNode, drawing: DrawingNode };
const edgeTypes: EdgeTypes = { link: LinkEdge };

export interface MiniCanvasProps {
  /** Fixture node names to place, in canvas order. */
  nodeNames?: string[];
  /** Fixture link ids to draw. */
  linkIds?: string[];
  /** Fixture drawing ids to place. */
  drawingIds?: string[];
  selectedNodes?: string[];
  selectedDrawings?: string[];
  /** Always show port labels on the edges instead of only on hover. */
  showPorts?: boolean;
  height?: number;
  label: string;
}

/**
 * The real `DeviceNode`, `LinkEdge`, and `DrawingNode` on a static canvas. The
 * subset and the selection come from fixture names, so a page can show one
 * card, a two-node link, or a drawing without duplicating the workspace.
 */
export default function MiniCanvas({
  nodeNames = fixtureNodes.map((row) => row.name),
  linkIds = [],
  drawingIds = [],
  selectedNodes = [],
  selectedDrawings = [],
  showPorts = false,
  height = 360,
  label,
}: MiniCanvasProps) {
  const wanted = new Set(nodeNames);
  const flowNodes: FlowNode[] = fixtureNodes
    .filter((row) => wanted.has(row.name))
    .map<FlowNode>((row) => ({
      id: row.id,
      type: 'device',
      position: { x: row.x, y: row.y },
      data: {
        kind: 'device',
        node: row,
        svg: symbols.get(row.symbol) ?? null,
        projectLocked: false,
      },
      draggable: false,
      selected: selectedNodes.includes(row.name),
      zIndex: row.z,
    }));

  const wantedDrawings = new Set(drawingIds);
  for (const drawing of fixtureDrawings) {
    if (!wantedDrawings.has(drawing.id)) continue;
    flowNodes.push({
      id: drawing.id,
      type: 'drawing',
      position: { x: drawing.x, y: drawing.y },
      style: { width: drawing.width, height: drawing.height },
      data: { kind: 'drawing', drawing, projectId: PROJECT_ID },
      draggable: false,
      selected: selectedDrawings.includes(drawing.id),
      zIndex: drawing.z,
    });
  }

  const wantedLinks = new Set(linkIds);
  const flowEdges: FlowEdge[] = fixtureLinks
    .filter((link) => wantedLinks.has(link.id))
    .map<FlowEdge>((link) => {
      const a = nodeByName.get(link.nodeAName);
      const b = nodeByName.get(link.nodeBName);
      const sides = edgeSides(a ?? { x: 0, y: 0 }, b ?? { x: 0, y: 0 });
      return {
        id: link.id,
        type: 'link',
        source: link.nodeAId,
        target: link.nodeBId,
        sourceHandle: nodeHandleId(sides.source),
        targetHandle: nodeHandleId(sides.target),
        data: { link, showPorts },
      };
    });

  return (
    <div
      className="nb-canvas docs-ui-canvas relative"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <ReactFlow<FlowNode, FlowEdge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        preventScrolling={false}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.4}
        maxZoom={1.4}
        proOptions={{ hideAttribution: false }}
      />
    </div>
  );
}
