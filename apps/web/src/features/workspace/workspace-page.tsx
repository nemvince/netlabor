import type {
  DrawingRow,
  LinkRow,
  MarkerRow,
  NodeCreateInput,
  NodeRow,
  ProjectRow,
  TemplateRow,
} from '@netlabor/contract';
import { MarkerHit } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { toast } from '../../components/toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { useMe } from '../auth/use-me.ts';
import { DuplicateProjectDialog } from '../projects/project-dialogs.tsx';
import { useProjectExport } from '../projects/use-project-export.ts';
import { BottomDock } from './bottom-dock.tsx';
import { Canvas } from './canvas.tsx';
import { type AlignMode, CanvasToolbar, type DistributeAxis } from './canvas-toolbar.tsx';
import { CloudInitCreateDialog, type CloudInitCredentials } from './cloud-init-create-dialog.tsx';
import { ConnectPortMenu } from './connect-port-menu.tsx';
import { FaultsDialog } from './faults-dialog.tsx';
import { applyHistory } from './history.ts';
import { Inspector } from './inspector.tsx';
import { type LinkContextAction, LinkContextMenu } from './link-context-menu.tsx';
import { LinkDialog } from './link-dialog.tsx';
import { type ContextAction, NodeContextMenu } from './node-context-menu.tsx';
import { Palette } from './palette.tsx';
import { ProjectFilesDialog } from './project-files-dialog.tsx';
import { ProjectTemplatesDialog } from './project-templates-dialog.tsx';
import { TOOL_TABS } from '../tools/tool-tabs.ts';
import { ProjectTopBar } from './project-top-bar.tsx';
import { ProjectSettingsDialog } from '../projects/project-settings-dialog.tsx';
import { SnapshotsDialog } from './snapshots-dialog.tsx';
import type { LinkCreateInput, NodeUpdateInput } from './schema-types.ts';
import { useWorkspaceStore } from './store.ts';
import { type MarkerFlash, NODE_HEIGHT, NODE_WIDTH } from './types.ts';
import { useProjectCollab } from './use-project-collab.ts';
import { useProjectEvents } from './use-project-events.ts';

function nodeInputFromRow(row: NodeRow): NodeCreateInput {
  return {
    projectId: row.projectId,
    ...(row.templateId ? { templateId: row.templateId } : {}),
    nodeType: row.nodeType,
    computeId: row.computeId,
    name: row.name,
    x: row.x,
    y: row.y,
    z: row.z,
    layer: row.layer,
    symbol: row.symbol,
    properties: row.properties,
  };
}

function previousPatch(row: NodeRow): NodeUpdateInput {
  return {
    name: row.name,
    symbol: row.symbol,
    locked: row.locked,
    consoleAutoStart: row.consoleAutoStart,
    x: row.x,
    y: row.y,
    properties: row.properties,
  };
}

function invalidateTopology() {
  void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.drawings.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.stats.key() });
}

function invalidateNodes() {
  void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.stats.key() });
}

function invalidateLinks() {
  void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
}

function invalidateDrawings() {
  void queryClient.invalidateQueries({ queryKey: orpc.drawings.list.key() });
}

/** Run an async op per item with bounded concurrency, first-failure independent. */
async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (!item) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}

/** Route shell: resolves the project, then mounts the React Flow workspace. */
export function WorkspacePage({ projectId }: { projectId: string }) {
  const { me } = useMe();
  const project = useQuery({
    ...orpc.projects.get.queryOptions({ input: { id: projectId } }),
    retry: false,
  });

  if (!me) return <Loading label="Loading account…" />;
  if (project.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading label="Reading project…" />
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <Notice tone="error">
          {project.isError ? messageOf(project.error) : 'The project was not returned.'}
        </Notice>
        <Link to="/projects" className="nb-button mt-3">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <WorkspaceBody key={projectId} projectId={projectId} project={project.data} />
    </ReactFlowProvider>
  );
}

type DeleteTarget = { nodes: NodeRow[]; links: LinkRow[]; drawings: DrawingRow[] };

function WorkspaceBody({ projectId, project }: { projectId: string; project: ProjectRow }) {
  const { can } = useMe();
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();
  const canvasHostRef = useRef<HTMLDivElement>(null);

  const nodes = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { projectId } }),
    refetchInterval: 30_000,
  });
  const links = useQuery({
    ...orpc.links.list.queryOptions({ input: { projectId } }),
    refetchInterval: 30_000,
  });
  const drawings = useQuery({
    ...orpc.drawings.list.queryOptions({ input: { projectId } }),
    refetchInterval: 30_000,
  });
  const templates = useQuery(
    orpc.templates.list.queryOptions({ input: { limit: 200, offset: 0 } }),
  );
  const symbols = useQuery(orpc.symbols.list.queryOptions({ input: {} }));
  const images = useQuery({
    ...orpc.images.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    enabled: can('image.read'),
    retry: false,
  });
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    enabled: can('compute.read'),
    retry: false,
  });

  const symbolData = useMemo(
    () => new Map((symbols.data ?? []).map((symbol) => [symbol.id, symbol.svg])),
    [symbols.data],
  );

  const selection = useWorkspaceStore((state) => state.selection);
  const setSelection = useWorkspaceStore((state) => state.setSelection);
  const clipboard = useWorkspaceStore((state) => state.clipboard);
  const setClipboard = useWorkspaceStore((state) => state.setClipboard);
  const undoStack = useWorkspaceStore((state) => state.undoStack);
  const redoStack = useWorkspaceStore((state) => state.redoStack);
  const pushHistory = useWorkspaceStore((state) => state.pushHistory);
  const pushUndo = useWorkspaceStore((state) => state.pushUndo);
  const popUndo = useWorkspaceStore((state) => state.popUndo);
  const pushRedo = useWorkspaceStore((state) => state.pushRedo);
  const popRedo = useWorkspaceStore((state) => state.popRedo);
  const openConsoleTab = useWorkspaceStore((state) => state.openConsoleTab);
  const openVncTab = useWorkspaceStore((state) => state.openVncTab);
  const openHttpConsoleTab = useWorkspaceStore((state) => state.openHttpConsoleTab);
  const openWiresharkTab = useWorkspaceStore((state) => state.openWiresharkTab);
  const openToolTab = useWorkspaceStore((state) => state.openToolTab);
  const closeDockTab = useWorkspaceStore((state) => state.closeDockTab);
  const allDockTabs = useWorkspaceStore((state) => state.dockTabs);
  const paletteWidth = useWorkspaceStore((state) => state.paletteWidth);
  const inspectorWidth = useWorkspaceStore((state) => state.inspectorWidth);
  const paletteOpen = useWorkspaceStore((state) => state.paletteOpen);
  const minimapVisible = useWorkspaceStore((state) => state.minimapVisible);
  const portLabelsAlways = useWorkspaceStore((state) => state.portLabelsAlways);
  const canvasBackground =
    typeof project.scene.background === 'string' ? project.scene.background : '';
  const saveScene = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
    },
  });
  function setCanvasBackground(color: string) {
    const scene = { ...project.scene };
    if (color) scene.background = color;
    else delete scene.background;
    saveScene.mutate({ id: projectId, scene });
  }
  const setPortLabelsAlways = useWorkspaceStore((state) => state.setPortLabelsAlways);
  const setMinimapVisible = useWorkspaceStore((state) => state.setMinimapVisible);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const inspectorOpen = useWorkspaceStore((state) => state.inspectorOpen);
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen);
  const dockOpen = useWorkspaceStore((state) => state.dockOpen);
  const setDockOpen = useWorkspaceStore((state) => state.setDockOpen);
  const dockHeight = useWorkspaceStore((state) => state.dockHeight);
  const setDockHeight = useWorkspaceStore((state) => state.setDockHeight);

  // Selecting anything opens the inspector; closing it stays closed until the
  // next selection so the canvas can breathe.
  useEffect(() => {
    const hasSelection =
      selection.nodes.length > 0 || selection.links.length > 0 || selection.drawings.length > 0;
    if (hasSelection && !useWorkspaceStore.getState().inspectorOpen) setInspectorOpen(true);
  }, [selection, setInspectorOpen]);

  const [layerFilter, setLayerFilter] = useState('all');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [linkDialogId, setLinkDialogId] = useState<string | null>(null);
  const [faultsOpen, setFaultsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [markerFlashes, setMarkerFlashes] = useState<Record<string, MarkerFlash>>({});
  const [contextMenu, setContextMenu] = useState<{
    node: NodeRow;
    x: number;
    y: number;
  } | null>(null);
  const [linkContextMenu, setLinkContextMenu] = useState<{
    link: LinkRow;
    x: number;
    y: number;
  } | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<{
    nodeId: string;
    adapter: number;
    port: number;
  } | null>(null);
  const [portMenu, setPortMenu] = useState<{
    nodeId: string;
    role: 'source' | 'target';
    x: number;
    y: number;
  } | null>(null);
  const [cloudInitRequest, setCloudInitRequest] = useState<{
    template: TemplateRow;
    x: number;
    y: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const { status: sseStatus, events, clear: clearEvents } = useProjectEvents(projectId);
  const collab = useProjectCollab(projectId);
  const { state: exportState, run: runExport } = useProjectExport();
  const markerCache = useRef(new Map<string, { rows: MarkerRow[]; at: number }>());
  const processedMarkerHits = useRef(new Set<string>());
  const markerTimers = useRef(new Map<string, number>());

  useEffect(() => {
    for (const event of events) {
      if (event.type !== 'marker.hit') continue;
      const parsed = MarkerHit.safeParse(event.payload);
      if (!parsed.success) continue;
      const hit = parsed.data;
      const key = `${hit.markerId}:${hit.ts}:${hit.direction}:${hit.length}`;
      if (processedMarkerHits.current.has(key)) continue;
      processedMarkerHits.current.add(key);
      if (processedMarkerHits.current.size > 800) {
        const oldest = processedMarkerHits.current.values().next().value;
        if (oldest) processedMarkerHits.current.delete(oldest);
      }
      void (async () => {
        let color = '#ef9a45';
        let duration = 1000;
        try {
          const cached = markerCache.current.get(hit.linkId);
          const rows =
            cached && Date.now() - cached.at < 30_000
              ? cached.rows
              : await client.links.markers.list({ linkId: hit.linkId });
          markerCache.current.set(hit.linkId, { rows, at: Date.now() });
          const marker = rows.find((candidate) => candidate.id === hit.markerId);
          if (marker) {
            color = marker.color;
            duration = marker.highlightDuration;
          }
        } catch {
          // A missing marker still flashes with the default instrument colour.
        }
        const flashKey = `${hit.markerId}:${hit.ts}`;
        setMarkerFlashes((current) => ({
          ...current,
          [hit.linkId]: { key: flashKey, color, name: hit.name, duration },
        }));
        const prior = markerTimers.current.get(hit.linkId);
        if (prior) window.clearTimeout(prior);
        const timer = window.setTimeout(() => {
          setMarkerFlashes((current) => {
            if (current[hit.linkId]?.key !== flashKey) return current;
            const next = { ...current };
            delete next[hit.linkId];
            return next;
          });
          markerTimers.current.delete(hit.linkId);
        }, duration);
        markerTimers.current.set(hit.linkId, timer);
      })();
    }
  }, [events]);

  useEffect(
    () => () => {
      for (const timer of markerTimers.current.values()) window.clearTimeout(timer);
      markerTimers.current.clear();
    },
    [],
  );

  const nodeRows = nodes.data ?? [];
  const linkRows = links.data ?? [];
  const drawingRows = drawings.data ?? [];
  const nodeStatusSeen = useRef(new Map<string, string>());
  // Console panes belong to a live node: drop them when the node is deleted or
  // transitions out of a running state.
  useEffect(() => {
    if (!nodes.data) return;
    const state = useWorkspaceStore.getState();
    const byId = new Map(nodeRows.map((node) => [node.id, node]));
    const closeFor = (nodeId: string) => {
      for (const tab of state.dockTabs) {
        if ('nodeId' in tab && tab.nodeId === nodeId) state.closeDockTab(tab.id);
      }
    };
    const next = new Map<string, string>();
    for (const node of nodeRows) {
      next.set(node.id, node.status);
      const previous = nodeStatusSeen.current.get(node.id);
      const wasRunning = previous === 'started' || previous === 'suspended';
      const nowRunning = node.status === 'started' || node.status === 'suspended';
      // previous === undefined: a restored tab from before this page load.
      if (!nowRunning && (wasRunning || previous === undefined)) closeFor(node.id);
    }
    for (const tab of state.dockTabs) {
      if ('nodeId' in tab && !byId.has(tab.nodeId)) closeFor(tab.nodeId);
    }
    nodeStatusSeen.current = next;
  }, [nodes.data, nodeRows]);
  const selectedNode = nodeRows.find((node) => selection.nodes[0] === node.id) ?? null;
  const selectedLink = linkRows.find((link) => selection.links[0] === link.id) ?? null;
  const selectedDrawing =
    drawingRows.find((drawing) => selection.drawings[0] === drawing.id) ?? null;
  const totalSelected = selection.nodes.length + selection.links.length + selection.drawings.length;

  const layers = useMemo(
    () =>
      [...new Set([...nodeRows, ...drawingRows].map((row) => row.layer))]
        .filter((layer) => layer !== '')
        .sort(),
    [nodeRows, drawingRows],
  );

  useEffect(() => {
    setClipboard(null);
  }, [setClipboard]);

  useEffect(() => {
    if (
      selection.links.length === 1 &&
      selection.nodes.length === 0 &&
      selection.drawings.length === 0
    ) {
      const linkId = selection.links[0];
      if (linkId) setLinkDialogId(linkId);
    }
  }, [selection]);

  useEffect(() => {
    if (!exportState) return;
    if (exportState.error) toast.error(exportState.error);
    else if (!exportState.busy) toast.success('Export archive is ready; the download has started.');
  }, [exportState]);

  function fail(error: unknown) {
    toast.error(messageOf(error));
  }

  function succeed(message: string) {
    toast.success(message);
  }

  function centerPoint(): { x: number; y: number } {
    const rect = canvasHostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  async function createTemplateNode(
    templateId: string,
    x: number,
    y: number,
    properties?: Record<string, unknown>,
  ) {
    if (project.locked) {
      fail('The project is locked; adding nodes is disabled.');
      return;
    }
    try {
      const input: NodeCreateInput = {
        projectId,
        templateId,
        x,
        y,
        z: 0,
        layer: 'default',
        ...(properties ? { properties } : {}),
      };
      const created = await client.nodes.create(input);
      pushHistory({ kind: 'node.create', id: created.id, input, label: `add ${created.name}` });
      invalidateNodes();
      setSelection({ nodes: [created.id], links: [], drawings: [] });
      succeed(`${created.name} added.`);
    } catch (error) {
      fail(error);
    }
  }

  function addTemplateNode(templateId: string, x: number, y: number) {
    const template = templates.data?.find((row) => row.id === templateId);
    if (template?.properties.cloudInitEnabled === true) {
      setCloudInitRequest({ template, x, y });
      return;
    }
    void createTemplateNode(templateId, x, y);
  }

  function addTemplateAtCenter(templateId: string) {
    const point = centerPoint();
    addTemplateNode(
      templateId,
      Math.round(point.x - NODE_WIDTH / 2),
      Math.round(point.y - NODE_HEIGHT / 2),
    );
  }

  function createCloudInitNode(credentials: CloudInitCredentials) {
    const request = cloudInitRequest;
    if (!request) return;
    setCloudInitRequest(null);
    void createTemplateNode(request.template.id, request.x, request.y, {
      ...credentials,
    });
  }

  function toggleConnectMode() {
    setConnectMode((active) => {
      if (active) {
        setConnectSource(null);
        setPortMenu(null);
      }
      return !active;
    });
  }

  function handleConnectNode(nodeId: string, point: { x: number; y: number }) {
    if (project.locked) {
      fail('The project is locked; links cannot be created.');
      return;
    }
    if (!connectSource || connectSource.nodeId === nodeId) {
      setPortMenu({ nodeId, role: 'source', ...point });
      return;
    }
    setPortMenu({ nodeId, role: 'target', ...point });
  }

  async function chooseConnectionPort(port: { adapter: number; port: number }) {
    const menu = portMenu;
    if (!menu) return;
    setPortMenu(null);
    if (menu.role === 'source') {
      setConnectSource({ nodeId: menu.nodeId, adapter: port.adapter, port: port.port });
      return;
    }
    if (!connectSource) return;
    try {
      await createConnection({
        projectId,
        nodeAId: connectSource.nodeId,
        adapterA: connectSource.adapter,
        portA: connectSource.port,
        nodeBId: menu.nodeId,
        adapterB: port.adapter,
        portB: port.port,
      });
      setConnectMode(false);
      setConnectSource(null);
    } catch {
      setPortMenu(menu);
    }
  }

  useEffect(() => {
    if (!connectMode || portMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectMode(false);
        setConnectSource(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectMode, portMenu]);

  async function createConnection(input: LinkCreateInput) {
    try {
      const created = await client.links.create(input);
      pushHistory({ kind: 'link.create', id: created.id, input, label: 'add link' });
      invalidateLinks();
      succeed('Link created.');
    } catch (error) {
      fail(error);
      throw new Error(messageOf(error));
    }
  }

  async function updateNode(id: string, patch: NodeUpdateInput, label: string) {
    const row = nodeRows.find((node) => node.id === id);
    if (!row) return;
    try {
      await client.nodes.update({ ...patch, id });
      pushHistory({
        kind: 'node.update',
        id,
        before: previousPatch(row),
        after: patch,
        label,
      });
      invalidateNodes();
      succeed('Node updated.');
    } catch (error) {
      fail(error);
    }
  }

  async function updateDrawing(drawing: DrawingRow, text: string) {
    try {
      await client.drawings.update({ id: drawing.id, text });
      invalidateDrawings();
      succeed('Drawing text saved.');
    } catch (error) {
      fail(error);
    }
  }

  function handleNodeDragStop(node: NodeRow, x: number, y: number) {
    collab.sendNodeMoveEnd(node.id);
    if (Math.abs(node.x - x) < 0.5 && Math.abs(node.y - y) < 0.5) return;
    void updateNode(node.id, { x, y }, 'move');
  }

  async function ensureProjectOpen() {
    if (project.status !== 'opened') {
      await client.projects.open({ id: projectId });
      invalidateTopology();
    }
  }

  function consoleFor(node: NodeRow, starting = false) {
    if (node.consoleType === 'none' || !can('node.console')) {
      fail('A console is not available for this node.');
      return;
    }
    if (!starting && node.status !== 'started' && node.status !== 'suspended') {
      fail(`Start ${node.name} before opening its console.`);
      return;
    }
    if (node.consoleType === 'vnc') {
      openVncTab(projectId, node.id, node.name);
      return;
    }
    if (node.consoleType === 'http' || node.consoleType === 'https') {
      openHttpConsoleTab(projectId, node.id, `${node.name} web console`);
      return;
    }
    openConsoleTab(projectId, node.id, node.name);
  }

  function vncFor(node: NodeRow) {
    if (node.consoleType !== 'vnc' || !can('node.console')) {
      fail('This node does not expose a VNC console.');
      return;
    }
    if (node.status !== 'started' && node.status !== 'suspended') {
      fail(`Start ${node.name} before opening its console.`);
      return;
    }
    openVncTab(projectId, node.id, node.name);
  }

  function openWireshark(linkId: string, title: string) {
    // Wireshark needs room for the packet list, protocol tree, and bytes.
    setDockHeight(Math.max(dockHeight, 460));
    openWiresharkTab(projectId, linkId, title);
  }

  async function nodeAction(node: NodeRow, action: 'start' | 'stop' | 'suspend' | 'reload') {
    try {
      if (action === 'start' || action === 'reload') await ensureProjectOpen();
      if (action === 'start') await client.nodes.start({ id: node.id });
      else if (action === 'stop') await client.nodes.stop({ id: node.id });
      else if (action === 'suspend') await client.nodes.suspend({ id: node.id });
      else await client.nodes.reload({ id: node.id });
      invalidateNodes();
      invalidateLinks();
      if (action === 'start' && node.consoleAutoStart) consoleFor(node, true);
      succeed(`${node.name} ${action} requested.`);
    } catch (error) {
      fail(error);
    }
  }

  async function setIsolated(node: NodeRow, isolated: boolean) {
    try {
      if (isolated) await client.nodes.unisolate({ id: node.id });
      else await client.nodes.isolate({ id: node.id });
      invalidateNodes();
      invalidateLinks();
      succeed(`${node.name} ${isolated ? 'unisolated' : 'isolated'}.`);
    } catch (error) {
      fail(error);
    }
  }

  async function duplicateNode(node: NodeRow) {
    try {
      const created = await client.nodes.duplicate({
        id: node.id,
        x: node.x + 32,
        y: node.y + 32,
      });
      pushHistory({
        kind: 'node.create',
        id: created.id,
        input: nodeInputFromRow(created),
        label: `duplicate ${node.name}`,
      });
      invalidateNodes();
      setSelection({ nodes: [created.id], links: [], drawings: [] });
      succeed(`${node.name} duplicated as ${created.name}.`);
    } catch (error) {
      fail(error);
    }
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const deletedNodeIds = new Set(deleteTarget.nodes.map((node) => node.id));
    try {
      for (const node of deleteTarget.nodes) {
        await client.nodes.delete({ id: node.id });
        pushHistory({ kind: 'node.delete', node, label: `delete ${node.name}` });
      }
      for (const link of deleteTarget.links) {
        if (deletedNodeIds.has(link.nodeAId) || deletedNodeIds.has(link.nodeBId)) continue;
        await client.links.delete({ id: link.id });
        pushHistory({ kind: 'link.delete', link, label: 'delete link' });
      }
      for (const drawing of deleteTarget.drawings) {
        await client.drawings.delete({ id: drawing.id });
        pushHistory({ kind: 'drawing.delete', drawing, label: `delete ${drawing.type}` });
      }
      setDeleteTarget(null);
      setSelection({ nodes: [], links: [], drawings: [] });
      invalidateTopology();
      succeed('Selection deleted.');
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  }

  function requestDelete() {
    const selectedNodes = nodeRows.filter((node) => selection.nodes.includes(node.id));
    const selectedLinks = linkRows.filter((link) => selection.links.includes(link.id));
    const selectedDrawings = drawingRows.filter((drawing) =>
      selection.drawings.includes(drawing.id),
    );
    if (selectedNodes.length + selectedLinks.length + selectedDrawings.length === 0) return;
    setDeleteError(null);
    setDeleteTarget({ nodes: selectedNodes, links: selectedLinks, drawings: selectedDrawings });
  }

  function requestDeleteNode(node: NodeRow) {
    setDeleteError(null);
    setDeleteTarget({ nodes: [node], links: [], drawings: [] });
  }

  function copySelection() {
    const selectedNodes = nodeRows.filter((node) => selection.nodes.includes(node.id));
    if (selectedNodes.length === 0) return;
    setClipboard(selectedNodes);
    succeed(`Copied ${selectedNodes.length} ${selectedNodes.length === 1 ? 'node' : 'nodes'}.`);
  }

  async function pasteClipboard() {
    if (!clipboard || clipboard.length === 0 || project.locked) return;
    try {
      const pasted: string[] = [];
      for (const [index, source] of clipboard.entries()) {
        const created = await client.nodes.duplicate({
          id: source.id,
          x: source.x + 28 * (index + 1),
          y: source.y + 28 * (index + 1),
        });
        pushHistory({
          kind: 'node.create',
          id: created.id,
          input: nodeInputFromRow(created),
          label: `paste ${created.name}`,
        });
        pasted.push(created.id);
      }
      invalidateNodes();
      setSelection({ nodes: pasted, links: [], drawings: [] });
      succeed(`Pasted ${pasted.length} ${pasted.length === 1 ? 'node' : 'nodes'}.`);
    } catch (error) {
      fail(error);
    }
  }

  async function alignNodes(mode: AlignMode) {
    const selected = nodeRows.filter((node) => selection.nodes.includes(node.id));
    if (selected.length < 2) return;
    const xs = selected.map((node) => node.x);
    const ys = selected.map((node) => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    try {
      for (const node of selected) {
        const x =
          mode === 'left' ? minX : mode === 'right' ? maxX : mode === 'center-h' ? centerX : node.x;
        const y =
          mode === 'top' ? minY : mode === 'bottom' ? maxY : mode === 'middle' ? centerY : node.y;
        await client.nodes.update({ id: node.id, x, y });
        pushHistory({
          kind: 'node.update',
          id: node.id,
          before: previousPatch(node),
          after: { x, y },
          label: `align ${node.name}`,
        });
      }
      invalidateNodes();
      succeed('Selection aligned.');
    } catch (error) {
      fail(error);
    }
  }

  async function distributeNodes(axis: DistributeAxis) {
    const selected = nodeRows.filter((node) => selection.nodes.includes(node.id));
    if (selected.length < 3) return;
    const sorted = [...selected].sort((left, right) =>
      axis === 'horizontal' ? left.x - right.x : left.y - right.y,
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) return;
    try {
      for (let index = 1; index < sorted.length - 1; index += 1) {
        const node = sorted[index];
        if (!node) continue;
        const fraction = index / (sorted.length - 1);
        const x = axis === 'horizontal' ? first.x + (last.x - first.x) * fraction : node.x;
        const y = axis === 'vertical' ? first.y + (last.y - first.y) * fraction : node.y;
        await client.nodes.update({ id: node.id, x, y });
        pushHistory({
          kind: 'node.update',
          id: node.id,
          before: previousPatch(node),
          after: { x, y },
          label: `distribute ${node.name}`,
        });
      }
      invalidateNodes();
      succeed('Selection distributed.');
    } catch (error) {
      fail(error);
    }
  }

  const DRAWING_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

  async function addDrawingImage(file: File) {
    if (project.locked) {
      fail('The project is locked; drawings cannot be added.');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!DRAWING_IMAGE_EXTENSIONS.includes(extension)) {
      fail('Use a png, jpg, gif, webp, or svg image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      fail('Images up to 2 MB are supported.');
      return;
    }
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let index = 0; index < buffer.length; index += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      }
      const path = `drawings/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      await client.projects.files.write({
        projectId,
        path,
        content: btoa(binary),
        encoding: 'base64',
      });
      const point = centerPoint();
      const input = {
        projectId,
        type: 'image' as const,
        x: Math.round(point.x - 80),
        y: Math.round(point.y - 60),
        width: 160,
        height: 120,
        rotation: 0,
        z: 0,
        layer: layerFilter === 'all' ? 'default' : layerFilter,
        filePath: path,
        style: {},
      };
      const created = await client.drawings.create(input);
      pushHistory({ kind: 'drawing.create', id: created.id, input, label: 'add image' });
      invalidateDrawings();
      setSelection({ nodes: [], links: [], drawings: [created.id] });
      succeed('Image drawing added.');
    } catch (error) {
      fail(error);
    }
  }

  async function addDrawing(type: 'rect' | 'text' | 'note') {
    if (project.locked) {
      fail('The project is locked; drawings cannot be added.');
      return;
    }
    const point = centerPoint();
    const width = type === 'rect' ? 180 : type === 'note' ? 180 : 140;
    const height = type === 'rect' ? 100 : type === 'note' ? 80 : 32;
    const input = {
      projectId,
      type,
      x: Math.round(point.x - width / 2),
      y: Math.round(point.y - height / 2),
      width,
      height,
      rotation: 0,
      z: 0,
      layer: layerFilter === 'all' ? 'default' : layerFilter,
      text: type === 'rect' ? null : type === 'note' ? 'Note' : 'Text',
      style:
        type === 'note'
          ? { stroke: '#f2c94c', fill: 'transparent', fontSize: 12, textAlign: 'left' as const }
          : { stroke: '#8b959d', fill: 'transparent', fontSize: 14, textAlign: 'left' as const },
    };
    try {
      const created = await client.drawings.create(input);
      pushHistory({
        kind: 'drawing.create',
        id: created.id,
        input,
        label: `add ${type}`,
      });
      invalidateDrawings();
      setSelection({ nodes: [], links: [], drawings: [created.id] });
      succeed(`${type} drawing added.`);
    } catch (error) {
      fail(error);
    }
  }

  async function undo() {
    const action = popUndo();
    if (!action) return;
    try {
      const inverse = await applyHistory(action, 'undo');
      pushRedo(inverse);
      invalidateTopology();
      succeed(`Undid: ${action.label}.`);
    } catch (error) {
      pushUndo(action);
      fail(error);
    }
  }

  async function redo() {
    const action = popRedo();
    if (!action) return;
    try {
      const inverse = await applyHistory(action, 'redo');
      pushUndo(inverse);
      invalidateTopology();
      succeed(`Redid: ${action.label}.`);
    } catch (error) {
      pushRedo(action);
      fail(error);
    }
  }

  async function toggleOpen() {
    setBusy('toggle-open');
    try {
      if (project.status === 'opened') {
        await client.projects.close({ id: projectId });
        for (const tab of allDockTabs.filter((candidate) => candidate.projectId === projectId)) {
          closeDockTab(tab.id);
        }
        succeed('Project closed.');
      } else {
        await client.projects.open({ id: projectId });
        succeed('Project opened.');
      }
      invalidateTopology();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function toggleLock() {
    setBusy('lock');
    try {
      if (project.locked) await client.projects.unlock({ id: projectId });
      else await client.projects.lock({ id: projectId });
      void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
      succeed(project.locked ? 'Project unlocked.' : 'Project locked.');
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function powerNodes(targets: NodeRow[], action: 'start' | 'stop', busyKey: string) {
    setBusy(busyKey);
    try {
      if (action === 'start') await ensureProjectOpen();
      let done = 0;
      const failures: string[] = [];
      await forEachWithConcurrency(targets, 4, async (node) => {
        try {
          if (action === 'start') await client.nodes.start({ id: node.id });
          else await client.nodes.stop({ id: node.id });
          done += 1;
          if (action === 'start' && node.consoleAutoStart) consoleFor(node, true);
        } catch (error) {
          failures.push(`${node.name}: ${messageOf(error)}`);
        }
      });
      invalidateTopology();
      const verb = action === 'start' ? 'Started' : 'Stopped';
      if (failures.length > 0) {
        fail(
          failures.length === targets.length
            ? `${verb === 'Started' ? 'Start' : 'Stop'} failed:\n${failures.join('\n')}`
            : `${verb} ${done} ${done === 1 ? 'node' : 'nodes'}; ${failures.length} failed:\n${failures.join('\n')}`,
        );
      } else {
        succeed(`${verb} ${done} ${done === 1 ? 'node' : 'nodes'}.`);
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function startAll() {
    await powerNodes(
      nodeRows.filter((node) => node.status !== 'started'),
      'start',
      'start-all',
    );
  }

  async function stopAll() {
    await powerNodes(
      nodeRows.filter((node) => node.status === 'started' || node.status === 'suspended'),
      'stop',
      'stop-all',
    );
  }

  async function startSelected() {
    await powerNodes(
      nodeRows.filter((node) => selection.nodes.includes(node.id) && node.status !== 'started'),
      'start',
      'start-all',
    );
  }

  async function stopSelected() {
    await powerNodes(
      nodeRows.filter((node) => selection.nodes.includes(node.id) && node.status === 'started'),
      'stop',
      'stop-all',
    );
  }

  function handleContextAction(action: ContextAction) {
    const node = contextMenu?.node;
    if (!node) return;
    switch (action) {
      case 'edit':
        setSelection({ nodes: [node.id], links: [], drawings: [] });
        useWorkspaceStore.getState().setInspectorOpen(true);
        break;
      case 'start':
      case 'stop':
      case 'suspend':
      case 'reload':
        void nodeAction(node, action);
        break;
      case 'isolate':
        void setIsolated(node, false);
        break;
      case 'unisolate':
        void setIsolated(node, true);
        break;
      case 'console':
        consoleFor(node);
        break;
      case 'vnc':
        vncFor(node);
        break;
      case 'web-console':
        if (node.consoleType !== 'http' && node.consoleType !== 'https') {
          fail('This node does not expose a web console.');
          break;
        }
        openHttpConsoleTab(projectId, node.id, `${node.name} web console`);
        break;
      case 'duplicate':
        void duplicateNode(node);
        break;
      case 'delete':
        requestDeleteNode(node);
        break;
    }
  }

  function handleLinkContextAction(action: LinkContextAction) {
    const link = linkContextMenu?.link;
    if (!link) return;
    const run = async (op: () => Promise<unknown>, message: string) => {
      try {
        await op();
        invalidateLinks();
        succeed(message);
      } catch (error) {
        fail(error);
      }
    };
    switch (action) {
      case 'edit':
        setLinkDialogId(link.id);
        break;
      case 'suspend':
        void run(() => client.links.update({ id: link.id, suspend: true }), 'Link suspended.');
        break;
      case 'resume':
        void run(() => client.links.update({ id: link.id, suspend: false }), 'Link resumed.');
        break;
      case 'capture-start':
        void run(async () => {
          await client.links.capture.start({ linkId: link.id });
          openWireshark(link.id, `Wireshark ${link.nodeAName} ↔ ${link.nodeBName}`);
        }, 'Capture started.');
        break;
      case 'capture-stop':
        void run(() => client.links.capture.stop({ linkId: link.id }), 'Capture stopped.');
        break;
      case 'wireshark':
        openWireshark(link.id, `Wireshark ${link.nodeAName} ↔ ${link.nodeBName}`);
        break;
      case 'clear-filters':
        void run(() => client.links.filters.clear({ linkId: link.id }), 'Link filters cleared.');
        break;
      case 'delete':
        setDeleteTarget({ nodes: [], links: [link], drawings: [] });
        break;
    }
  }

  useEffect(() => {
    function typing(target: EventTarget | null): boolean {
      return (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      if (typing(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if ((event.key === 'Delete' || event.key === 'Backspace') && totalSelected > 0) {
        event.preventDefault();
        requestDelete();
        return;
      }
      if (!mod) {
        const plain = event.key.toLowerCase();
        if (plain === 'l') {
          event.preventDefault();
          toggleConnectMode();
        } else if (plain === 'p') {
          event.preventDefault();
          setPaletteOpen(!paletteOpen);
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'c' && selection.nodes.length > 0) {
        event.preventDefault();
        copySelection();
      } else if (key === 'v' && clipboard && clipboard.length > 0) {
        event.preventDefault();
        void pasteClipboard();
      } else if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectionLabel =
    selectedNode?.name ??
    (selectedLink ? `${selectedLink.nodeAName} ↔ ${selectedLink.nodeBName}` : null) ??
    (selectedDrawing ? `${selectedDrawing.type} drawing` : null) ??
    (totalSelected > 0 ? `${totalSelected} selected` : '—');

  const setProjectStatus = useWorkspaceStore((state) => state.setProjectStatus);
  useEffect(() => {
    setProjectStatus({
      projectId,
      selectionLabel,
      nodeCount: nodeRows.length,
      linkCount: linkRows.length,
      drawingCount: drawingRows.length,
      zoom,
      status: project.status,
      locked: project.locked,
      events: sseStatus,
    });
  }, [
    setProjectStatus,
    projectId,
    selectionLabel,
    nodeRows.length,
    linkRows.length,
    drawingRows.length,
    zoom,
    project.status,
    project.locked,
    sseStatus,
  ]);
  useEffect(() => {
    if (collab.status === 'live') collab.sendSelection(selection);
  }, [collab.status, selection, collab.sendSelection]);

  useEffect(() => () => setProjectStatus(null), [setProjectStatus]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: 'var(--color-panel-sunken)' }}
    >
      <ProjectTopBar
        project={project}
        nodeCount={nodeRows.length}
        busy={busy}
        exportProgress={exportState?.busy ? exportState.progress : null}
        canOpen={can('project.open')}
        canWrite={can('project.write')}
        canExport={can('project.export')}
        canFault={can('fault.write')}
        canSettings={can('project.members') || can('project.write')}
        onToggleOpen={() => void toggleOpen()}
        onStartAll={() => void startAll()}
        onStopAll={() => void stopAll()}
        onToggleLock={() => void toggleLock()}
        onOpenSnapshots={() => setSnapshotsOpen(true)}
        onOpenFaults={() => setFaultsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFiles={() => setFilesOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenNetworkTool={(tool) =>
          openToolTab(
            projectId,
            tool,
            TOOL_TABS.find((entry) => entry.id === tool)?.label ?? 'Network tools',
          )
        }
        onExport={() => void runExport(projectId)}
        onDuplicate={() => setDuplicateOpen(true)}
        paletteOpen={paletteOpen}
        inspectorOpen={inspectorOpen}
        dockOpen={dockOpen}
        onTogglePalette={() => setPaletteOpen(!paletteOpen)}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
        onToggleDock={() => setDockOpen(!dockOpen)}
        collaborators={collab.participants.map((participant) => ({
          id: participant.id,
          name: participant.name,
          color: participant.color,
        }))}
        selfCollabId={collab.selfId}
        collabStatus={collab.status}
      />

      <div className="flex min-h-0 flex-1">
        {paletteOpen ? (
          <div style={{ width: paletteWidth }} className="min-h-0 shrink-0">
            <Palette
              templates={templates.data ?? []}
              images={images.data}
              computes={computes.data}
              symbols={symbolData}
              isLoading={templates.isPending}
              error={templates.error}
              disabled={project.locked}
              onAddAtCenter={addTemplateAtCenter}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div ref={canvasHostRef} className="relative min-h-0 min-w-0 flex-1">
              <Canvas
                project={project}
                nodes={nodeRows}
                links={linkRows}
                drawings={drawingRows}
                symbols={symbolData}
                selection={selection}
                markerFlashes={markerFlashes}
                layerFilter={layerFilter}
                gridVisible={gridVisible}
                snapEnabled={snapEnabled}
                minimapVisible={minimapVisible}
                portLabelsAlways={portLabelsAlways}
                canvasBackground={canvasBackground}
                onSelectionChange={setSelection}
                onNodeDragStop={handleNodeDragStop}
                connectMode={connectMode}
                onConnectNode={handleConnectNode}
                collaborators={collab.participants}
                selfCollabId={collab.selfId}
                remoteNodeMoves={collab.remoteNodeMoves}
                onCursorMove={collab.sendCursor}
                onNodeDragMove={collab.sendNodeMove}
                onAddTemplate={(templateId, x, y) => void addTemplateNode(templateId, x, y)}
                onNodeContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
                onLinkContextMenu={(link, x, y) => setLinkContextMenu({ link, x, y })}
                onLinkOpen={(linkId) => setLinkDialogId(linkId)}
                onZoomChange={setZoom}
              />
              {connectMode ? (
                <div
                  className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[3px] border px-2 py-1 text-[11px]"
                  style={{
                    borderColor: 'var(--color-copper)',
                    background: 'var(--color-panel)',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                    color: 'var(--color-ink-dim)',
                  }}
                >
                  <span>
                    {connectSource
                      ? `${nodeRows.find((node) => node.id === connectSource.nodeId)?.name ?? 'node'}:${connectSource.adapter}/${connectSource.port} · click the second node`
                      : 'Connect · click the first node'}
                  </span>
                  <button
                    type="button"
                    className="nb-button"
                    data-size="sm"
                    data-variant="ghost"
                    onClick={() => {
                      setConnectMode(false);
                      setConnectSource(null);
                      setPortMenu(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <CanvasToolbar
                selectionCount={totalSelected}
                nodeSelectionCount={selection.nodes.length}
                canControl={project.status === 'opened' && can('node.control')}
                canEdit={!project.locked && can('node.update')}
                canDraw={!project.locked && can('drawing.write')}
                canPaste={clipboard !== null && clipboard.length > 0}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                layers={layers}
                layerFilter={layerFilter}
                gridVisible={gridVisible}
                snapEnabled={snapEnabled}
                minimapVisible={minimapVisible}
                portLabelsAlways={portLabelsAlways}
                onToggleMinimap={() => setMinimapVisible(!minimapVisible)}
                onTogglePortLabels={() => setPortLabelsAlways(!portLabelsAlways)}
                canvasBackground={canvasBackground}
                onChangeCanvasBackground={setCanvasBackground}
                onUndo={() => void undo()}
                onRedo={() => void redo()}
                onCopy={copySelection}
                onPaste={() => void pasteClipboard()}
                onAlign={(mode) => void alignNodes(mode)}
                onDistribute={(axis) => void distributeNodes(axis)}
                onAddDrawing={(type) => void addDrawing(type)}
                onAddImage={(file) => void addDrawingImage(file)}
                onLayerFilter={setLayerFilter}
                onToggleGrid={() => setGridVisible((visible) => !visible)}
                onToggleSnap={() => setSnapEnabled((enabled) => !enabled)}
                onDelete={requestDelete}
                onStartSelected={() => void startSelected()}
                onStopSelected={() => void stopSelected()}
                connectMode={connectMode}
                onToggleConnect={toggleConnectMode}
              />
              {nodes.isPending ? (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    background: 'color-mix(in oklab, var(--color-panel-sunken) 70%, transparent)',
                  }}
                >
                  <Loading label="Reading topology…" />
                </div>
              ) : nodes.isError ? (
                <div className="absolute top-12 left-1/2 w-80 -translate-x-1/2">
                  <Notice tone="error">{messageOf(nodes.error)}</Notice>
                </div>
              ) : nodeRows.length === 0 ? (
                <div
                  className="pointer-events-none absolute bottom-12 left-1/2 w-72 -translate-x-1/2 rounded-[3px] border px-3 py-2 text-center text-[12px]"
                  style={{
                    borderColor: 'var(--color-rule)',
                    background: 'var(--color-panel)',
                    color: 'var(--color-ink-dim)',
                  }}
                >
                  Drag a device from the palette, or double-click one to place it at the viewport
                  center.
                </div>
              ) : null}
            </div>
            {inspectorOpen ? (
              <div style={{ width: inspectorWidth }} className="min-h-0 shrink-0">
                <Inspector
                  project={project}
                  node={selectedNode}
                  link={selectedLink}
                  drawing={selectedDrawing}
                  symbols={symbols.data ?? []}
                  onUpdateNode={(id, patch, label) => void updateNode(id, patch, label)}
                  onNodeAction={(node, action) => void nodeAction(node, action)}
                  onOpenConsole={consoleFor}
                  onOpenLink={(linkId) => setLinkDialogId(linkId)}
                  onDeleteLink={(link) =>
                    setDeleteTarget({ nodes: [], links: [link], drawings: [] })
                  }
                  onDeleteDrawing={(drawing) =>
                    setDeleteTarget({ nodes: [], links: [], drawings: [drawing] })
                  }
                  onUpdateDrawing={(drawing, text) => void updateDrawing(drawing, text)}
                />
              </div>
            ) : null}
          </div>
          <BottomDock
            projectId={projectId}
            events={events}
            status={sseStatus}
            onClearEvents={clearEvents}
          />
        </div>
      </div>

      {portMenu
        ? (() => {
            const node = nodeRows.find((row) => row.id === portMenu.nodeId);
            if (!node) return null;
            return (
              <ConnectPortMenu
                node={node}
                links={linkRows}
                role={portMenu.role}
                point={{ x: portMenu.x, y: portMenu.y }}
                onChoose={(port) => void chooseConnectionPort(port)}
                onClose={() => setPortMenu(null)}
              />
            );
          })()
        : null}

      {cloudInitRequest ? (
        <CloudInitCreateDialog
          template={cloudInitRequest.template}
          onClose={() => setCloudInitRequest(null)}
          onCreate={createCloudInitNode}
        />
      ) : null}

      {contextMenu ? (
        <NodeContextMenu
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          canControl={can('node.control') && !project.locked}
          canConsole={can('node.console')}
          canUpdate={can('node.update') && !project.locked}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {linkContextMenu ? (
        <LinkContextMenu
          link={linkContextMenu.link}
          x={linkContextMenu.x}
          y={linkContextMenu.y}
          canControl={can('link.write') && !project.locked}
          canUpdate={can('link.write') && !project.locked}
          onAction={handleLinkContextAction}
          onClose={() => setLinkContextMenu(null)}
        />
      ) : null}

      {linkDialogId ? (
        <LinkDialog
          linkId={linkDialogId}
          events={events}
          onClose={() => setLinkDialogId(null)}
          onOpenWireshark={openWireshark}
          onMarkersChanged={() => markerCache.current.clear()}
        />
      ) : null}

      {faultsOpen ? <FaultsDialog projectId={projectId} onOpenChange={setFaultsOpen} /> : null}

      {snapshotsOpen ? (
        <SnapshotsDialog projectId={projectId} onOpenChange={setSnapshotsOpen} />
      ) : null}

      {settingsOpen ? (
        <ProjectSettingsDialog
          project={project}
          initialTab="access"
          onOpenChange={setSettingsOpen}
        />
      ) : null}

      {filesOpen ? <ProjectFilesDialog projectId={projectId} onOpenChange={setFilesOpen} /> : null}

      {templatesOpen ? (
        <ProjectTemplatesDialog project={project} onOpenChange={setTemplatesOpen} />
      ) : null}

      {duplicateOpen ? (
        <DuplicateProjectDialog
          project={project}
          onOpenChange={setDuplicateOpen}
          onCompleted={(newProjectId) => {
            setDuplicateOpen(false);
            void navigate({
              to: '/projects/$projectId',
              params: { projectId: newProjectId },
            });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title="Delete selection?"
        description={`${(deleteTarget?.nodes.length ?? 0) + (deleteTarget?.links.length ?? 0) + (deleteTarget?.drawings.length ?? 0)} element(s) will be removed. Deleting a node stops it, removes its attached links, and deletes its working directory.`}
        confirmLabel="Delete"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}
