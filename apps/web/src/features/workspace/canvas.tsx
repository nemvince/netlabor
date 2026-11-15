import type { CSSProperties } from 'react';
import type { DrawingRow, LinkRow, NodeRow, ProjectRow } from '@netlabor/contract';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  type EdgeTypes,
  MiniMap,
  type NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DeviceNode } from './device-node.tsx';
import { DrawingNode } from './drawing-node.tsx';
import { LinkEdge } from './link-edge.tsx';
import { NodeHoverCard } from './node-hover-card.tsx';
import { TEMPLATE_MIME } from './palette.tsx';
import type { Selection } from './store.ts';
import {
  edgeSides,
  type FlowEdge,
  type FlowNode,
  type MarkerFlash,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeHandleId,
} from './types.ts';
import type { CollabParticipant, RemoteNodeMove } from './use-project-collab.ts';

const nodeTypes: NodeTypes = { device: DeviceNode, drawing: DrawingNode };
const edgeTypes: EdgeTypes = { link: LinkEdge };

interface CanvasProps {
  project: ProjectRow;
  nodes: NodeRow[];
  links: LinkRow[];
  drawings: DrawingRow[];
  symbols: Map<string, string>;
  selection: Selection;
  markerFlashes: Record<string, MarkerFlash>;
  layerFilter: string;
  gridVisible: boolean;
  snapEnabled: boolean;
  minimapVisible: boolean;
  portLabelsAlways: boolean;
  canvasBackground: string;
  onSelectionChange: (selection: Selection) => void;
  onNodeDragStop: (node: NodeRow, x: number, y: number) => void;
  onNodeDragMove: (nodeId: string, x: number, y: number) => void;
  onCursorMove: (point: { x: number; y: number }) => void;
  collaborators: CollabParticipant[];
  selfCollabId: string | null;
  remoteNodeMoves: Record<string, RemoteNodeMove>;
  connectMode: boolean;
  onConnectNode: (nodeId: string, point: { x: number; y: number }) => void;
  onAddTemplate: (templateId: string, x: number, y: number) => void;
  onNodeContextMenu: (node: NodeRow, x: number, y: number) => void;
  onLinkContextMenu: (link: LinkRow, x: number, y: number) => void;
  onLinkOpen: (linkId: string) => void;
  onZoomChange: (zoom: number) => void;
}

function buildFlowNodes(
  nodes: NodeRow[],
  drawings: DrawingRow[],
  symbols: Map<string, string>,
  projectId: string,
  projectLocked: boolean,
  selection: Selection,
  layerFilter: string,
  collaborators: CollabParticipant[],
  remoteNodeMoves: Record<string, RemoteNodeMove>,
): FlowNode[] {
  const visible = (layer: string) => layerFilter === 'all' || layer === layerFilter;
  const deviceNodes = nodes
    .filter((node) => visible(node.layer))
    .map<FlowNode>((node) => {
      const remoteMove = selection.nodes.includes(node.id) ? undefined : remoteNodeMoves[node.id];
      const remoteColors = collaborators
        .filter((participant) => participant.selection.nodes.includes(node.id))
        .map((participant) => participant.color);
      return {
        id: node.id,
        type: 'device',
        position: remoteMove ? { x: remoteMove.x, y: remoteMove.y } : { x: node.x, y: node.y },
        data: {
          kind: 'device',
          node,
          svg: symbols.get(node.symbol) ?? null,
          projectLocked,
          ...(remoteColors.length > 0 ? { remoteColors } : {}),
        },
        draggable: !projectLocked && !node.locked,
        selected: selection.nodes.includes(node.id),
        zIndex: node.z,
      };
    });
  const drawingNodes = drawings
    .filter((drawing) => visible(drawing.layer))
    .map<FlowNode>((drawing) => ({
      id: drawing.id,
      type: 'drawing',
      position: { x: drawing.x, y: drawing.y },
      style: { width: drawing.width, height: drawing.height },
      data: { kind: 'drawing', drawing, projectId },
      draggable: !projectLocked && !drawing.locked,
      selected: selection.drawings.includes(drawing.id),
      zIndex: drawing.z,
    }));
  return [...deviceNodes, ...drawingNodes];
}

function buildFlowEdges(
  links: LinkRow[],
  nodes: NodeRow[],
  drawings: DrawingRow[],
  selection: Selection,
  markerFlashes: Record<string, MarkerFlash>,
  layerFilter: string,
  hoveredEdgeId: string | null,
  portLabelsAlways: boolean,
): FlowEdge[] {
  const visible = (layer: string) => layerFilter === 'all' || layer === layerFilter;
  const visibleIds = new Set([
    ...nodes.filter((node) => visible(node.layer)).map((node) => node.id),
    ...drawings.filter((drawing) => visible(drawing.layer)).map((drawing) => drawing.id),
  ]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Links sharing a node pair (either direction) each get a lateral offset so
  // their straight lines run side by side instead of on top of each other.
  const pairIndex = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const visibleLinks = links.filter(
    (link) => visibleIds.has(link.nodeAId) && visibleIds.has(link.nodeBId),
  );
  for (const link of visibleLinks) {
    const pair = [link.nodeAId, link.nodeBId].sort().join(':');
    pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
  }
  return visibleLinks.map<FlowEdge>((link) => {
    const a = byId.get(link.nodeAId);
    const b = byId.get(link.nodeBId);
    const sides = edgeSides(a ?? { x: 0, y: 0 }, b ?? { x: 0, y: 0 });
    const pair = [link.nodeAId, link.nodeBId].sort().join(':');
    const index = pairIndex.get(pair) ?? 0;
    pairIndex.set(pair, index + 1);
    const offset = pairCount.get(pair) === 1 ? 0 : (index - (pairCount.get(pair)! - 1) / 2) * 12;
    return {
      id: link.id,
      type: 'link',
      source: link.nodeAId,
      target: link.nodeBId,
      sourceHandle: nodeHandleId(sides.source),
      targetHandle: nodeHandleId(sides.target),
      data: {
        link,
        offset,
        ...(portLabelsAlways ? { showPorts: true } : {}),
        ...(hoveredEdgeId === link.id ? { hovered: true } : {}),
        ...(markerFlashes[link.id] ? { markerFlash: markerFlashes[link.id] } : {}),
      },
      selected: selection.links.includes(link.id),
    };
  });
}

/** Topology surface: custom device/drawing nodes and status-carrying link edges. */
export function Canvas({
  project,
  nodes,
  links,
  drawings,
  symbols,
  selection,
  markerFlashes,
  layerFilter,
  gridVisible,
  snapEnabled,
  minimapVisible,
  portLabelsAlways,
  canvasBackground,
  onSelectionChange,
  onNodeDragStop,
  onNodeDragMove,
  onCursorMove,
  collaborators,
  selfCollabId,
  remoteNodeMoves,
  connectMode,
  onConnectNode,
  onAddTemplate,
  onNodeContextMenu,
  onLinkContextMenu,
  onLinkOpen,
  onZoomChange,
}: CanvasProps) {
  const { screenToFlowPosition, flowToScreenPosition, fitView } = useReactFlow();
  const viewport = useViewport();
  const fittedRef = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const collaboratorsRef = useRef(collaborators);
  collaboratorsRef.current = collaborators;
  const remoteMovesRef = useRef(remoteNodeMoves);
  remoteMovesRef.current = remoteNodeMoves;
  const remoteSelectionKey = collaborators
    .map((participant) => `${participant.id}:${participant.selection.nodes.join(',')}`)
    .join('|');
  const remoteMoveKey = JSON.stringify(remoteNodeMoves);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverPendingId = useRef<string | null>(null);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // refs keep cursor updates out of topology rebuilds.
  useEffect(() => {
    setFlowNodes(
      buildFlowNodes(
        nodes,
        drawings,
        symbols,
        project.id,
        project.locked,
        selectionRef.current,
        layerFilter,
        collaboratorsRef.current,
        remoteMovesRef.current,
      ),
    );
  }, [
    nodes,
    drawings,
    symbols,
    project.locked,
    layerFilter,
    remoteSelectionKey,
    remoteMoveKey,
    setFlowNodes,
  ]);

  useEffect(() => {
    setFlowEdges(
      buildFlowEdges(
        links,
        nodes,
        drawings,
        selectionRef.current,
        markerFlashes,
        layerFilter,
        hoveredEdgeId,
        portLabelsAlways,
      ),
    );
  }, [
    links,
    nodes,
    drawings,
    markerFlashes,
    layerFilter,
    hoveredEdgeId,
    portLabelsAlways,
    setFlowEdges,
  ]);

  useEffect(() => {
    if (fittedRef.current || nodes.length === 0) return;
    fittedRef.current = true;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.25, maxZoom: 1.2 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes, fitView]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      onSelectionChange({
        nodes: selectedNodes.filter((node) => node.type === 'device').map((node) => node.id),
        links: selectedEdges.map((edge) => edge.id),
        drawings: selectedNodes.filter((node) => node.type === 'drawing').map((node) => node.id),
      });
    },
    [onSelectionChange],
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const templateId = event.dataTransfer.getData(TEMPLATE_MIME);
      if (!templateId) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const snapped = snapEnabled
        ? { x: Math.round(position.x / 10) * 10, y: Math.round(position.y / 10) * 10 }
        : position;
      onAddTemplate(templateId, snapped.x - NODE_WIDTH / 2, snapped.y - NODE_HEIGHT / 2);
    },
    [screenToFlowPosition, onAddTemplate, snapEnabled],
  );

  return (
    <div
      className="nb-canvas relative h-full w-full"
      role="application"
      aria-label="Topology canvas"
      onPointerMove={(event) => {
        onCursorMove(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
    >
      <ReactFlow<FlowNode, FlowEdge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={handleSelectionChange}
        onNodeDrag={(_, node) => onNodeDragMove(node.id, node.position.x, node.position.y)}
        onNodeDragStart={() => {
          window.clearTimeout(hoverTimer.current);
          hoverPendingId.current = null;
          setHoveredNode(null);
        }}
        onNodeDragStop={(_, node) => {
          const row = nodes.find((candidate) => candidate.id === node.id);
          if (row) onNodeDragStop(row, node.position.x, node.position.y);
        }}
        onNodeClick={(event, node) => {
          if (connectMode && node.type === 'device') {
            onConnectNode(node.id, { x: event.clientX, y: event.clientY });
          }
        }}
        nodesConnectable={false}
        onNodeContextMenu={(event, node) => {
          if (node.type !== 'device') return;
          const row = nodes.find((candidate) => candidate.id === node.id);
          if (!row) return;
          event.preventDefault();
          onNodeContextMenu(row, event.clientX, event.clientY);
        }}
        // The info card follows the device glyph, not the node's layout box,
        // which also covers the caption and padding around it.
        onNodeMouseMove={(event, node) => {
          if (node.type !== 'device') return;
          const target = event.target as Element | null;
          const overGlyph = target?.closest?.('[data-node-hover]') != null;
          if (!overGlyph) {
            if (hoverPendingId.current !== null || hoveredNode !== null) {
              window.clearTimeout(hoverTimer.current);
              hoverPendingId.current = null;
              setHoveredNode(null);
            }
            return;
          }
          if (hoveredNode?.id === node.id || hoverPendingId.current === node.id) return;
          const anchor = flowToScreenPosition({
            x: node.position.x + (node.measured?.width ?? NODE_WIDTH) / 2,
            y: node.position.y + (node.measured?.height ?? NODE_HEIGHT),
          });
          hoverPendingId.current = node.id;
          hoverTimer.current = window.setTimeout(() => {
            hoverPendingId.current = null;
            setHoveredNode({ id: node.id, x: anchor.x, y: anchor.y });
          }, 450);
        }}
        onNodeMouseLeave={() => {
          window.clearTimeout(hoverTimer.current);
          hoverPendingId.current = null;
          setHoveredNode(null);
        }}
        onEdgeClick={(_, edge) => onLinkOpen(edge.id)}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onEdgeContextMenu={(event, edge) => {
          const row = links.find((candidate) => candidate.id === edge.id);
          if (!row) return;
          event.preventDefault();
          onLinkContextMenu(row, event.clientX, event.clientY);
        }}
        onMove={(_, viewport) => onZoomChange(viewport.zoom)}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={null}
        selectionOnDrag
        panOnDrag={[1, 2]}
        onlyRenderVisibleElements
        snapToGrid={snapEnabled}
        snapGrid={[10, 10]}
        style={
          canvasBackground
            ? ({ '--xy-background-color': canvasBackground } as CSSProperties)
            : undefined
        }
        fitViewOptions={{ padding: 0.22, maxZoom: 1.15 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
      >
        {gridVisible ? (
          <>
            <Background
              id="grid-minor"
              variant={BackgroundVariant.Lines}
              gap={20}
              lineWidth={1}
              color="rgba(244, 246, 248, 0.05)"
            />
            <Background
              id="grid-major"
              variant={BackgroundVariant.Lines}
              gap={100}
              lineWidth={1}
              color="rgba(239, 154, 69, 0.1)"
            />
          </>
        ) : null}
        <Controls position="bottom-left" showInteractive={false} />
        {minimapVisible ? (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => {
              const payload = node.data as { kind?: string; node?: NodeRow } | undefined;
              if (payload?.kind !== 'device' || !payload.node) return 'var(--color-rule-strong)';
              if (payload.node.status === 'started') return 'var(--color-signal-up)';
              if (payload.node.status === 'error') return 'var(--color-signal-down)';
              if (payload.node.status === 'suspended') return 'var(--color-signal-warn)';
              return 'var(--color-ink-faint)';
            }}
          />
        ) : null}
      </ReactFlow>
      {hoveredNode
        ? createPortal(
            <NodeHoverCard
              key={hoveredNode.id}
              node={nodes.find((row) => row.id === hoveredNode.id)}
              links={links}
              point={hoveredNode}
            />,
            document.body,
          )
        : null}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
        {collaborators
          .filter((participant) => participant.id !== selfCollabId && participant.cursor)
          .map((participant) => {
            const cursor = participant.cursor;
            if (!cursor) return null;
            return (
              <div
                key={participant.id}
                className="absolute flex items-start gap-1"
                style={{
                  left: cursor.x * viewport.zoom + viewport.x,
                  top: cursor.y * viewport.zoom + viewport.y,
                }}
              >
                <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
                  <path
                    d="M0 0L14 7L7.5 8.5L4.5 16Z"
                    fill={participant.color}
                    stroke="var(--color-panel)"
                    strokeWidth="1"
                  />
                </svg>
                <span
                  className="mt-3 rounded-[2px] px-1 py-[1px] text-[10px] font-semibold whitespace-nowrap"
                  style={{ background: participant.color, color: '#111417' }}
                >
                  {participant.name}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
