import type { DrawingRow, LinkRow, NodeCreateInput, NodeRow } from '@netlabor/contract';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DrawingCreateInput, LinkCreateInput, NodeUpdateInput } from './schema-types.ts';

export interface ProjectStatusSnapshot {
  projectId: string;
  selectionLabel: string;
  nodeCount: number;
  linkCount: number;
  drawingCount: number;
  zoom: number;
  status: string;
  locked: boolean;
  events: string;
}

export interface Selection {
  nodes: string[];
  links: string[];
  drawings: string[];
}

export const EMPTY_SELECTION: Selection = { nodes: [], links: [], drawings: [] };

export type DockTabSpec =
  | { id: string; projectId: string; kind: 'console'; nodeId: string; title: string }
  | { id: string; projectId: string; kind: 'vnc'; nodeId: string; title: string }
  | { id: string; projectId: string; kind: 'http'; nodeId: string; title: string }
  | { id: string; projectId: string; kind: 'wireshark'; linkId: string; title: string };

export type DockTabKind = DockTabSpec['kind'];

export function dockTabResource(tab: DockTabSpec): string {
  return tab.kind === 'wireshark' ? tab.linkId : tab.nodeId;
}

export type HistoryAction =
  | { kind: 'node.create'; id: string; input: NodeCreateInput; label: string }
  | {
      kind: 'node.update';
      id: string;
      before: NodeUpdateInput;
      after: NodeUpdateInput;
      label: string;
    }
  | { kind: 'node.delete'; node: NodeRow; label: string }
  | { kind: 'link.create'; id: string; input: LinkCreateInput; label: string }
  | { kind: 'link.delete'; link: LinkRow; label: string }
  | { kind: 'drawing.create'; id: string; input: DrawingCreateInput; label: string }
  | { kind: 'drawing.delete'; drawing: DrawingRow; label: string };

interface WorkspaceState {
  projectStatus: ProjectStatusSnapshot | null;
  setProjectStatus: (status: ProjectStatusSnapshot | null) => void;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  clipboard: NodeRow[] | null;
  setClipboard: (nodes: NodeRow[] | null) => void;
  dockTabs: DockTabSpec[];
  openConsoleTab: (projectId: string, nodeId: string, title: string) => void;
  openVncTab: (projectId: string, nodeId: string, title: string) => void;
  openHttpConsoleTab: (projectId: string, nodeId: string, title: string) => void;
  openWiresharkTab: (projectId: string, linkId: string, title: string) => void;
  closeDockTab: (id: string) => void;
  activeDockTab: string;
  setActiveDockTab: (id: string) => void;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  /** How many console tabs render side by side in the dock. */
  consoleSplit: 1 | 2 | 4;
  setConsoleSplit: (split: 1 | 2 | 4) => void;
  minimapVisible: boolean;
  setMinimapVisible: (visible: boolean) => void;
  /** Always render link port labels at line ends, not just on hover. */
  portLabelsAlways: boolean;
  setPortLabelsAlways: (visible: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  dockHeight: number;
  setDockHeight: (height: number) => void;
  paletteWidth: number;
  setPaletteWidth: (width: number) => void;
  inspectorWidth: number;
  setInspectorWidth: (width: number) => void;
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
  pushHistory: (action: HistoryAction) => void;
  pushUndo: (action: HistoryAction) => void;
  popUndo: () => HistoryAction | undefined;
  pushRedo: (action: HistoryAction) => void;
  popRedo: () => HistoryAction | undefined;
  clearHistory: () => void;
}

// A narrow first visit starts with the canvas, not a 208px palette beside it.
const startsNarrow =
  typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const openTab = (spec: DockTabSpec) =>
        set((state) => {
          const resource = dockTabResource(spec);
          const existing = state.dockTabs.find(
            (tab) =>
              tab.kind === spec.kind &&
              tab.projectId === spec.projectId &&
              dockTabResource(tab) === resource,
          );
          if (existing) return { activeDockTab: existing.id, dockOpen: true };
          return {
            dockTabs: [...state.dockTabs, spec],
            activeDockTab: spec.id,
            dockOpen: true,
          };
        });
      return {
        projectStatus: null,
        setProjectStatus: (projectStatus) => set({ projectStatus }),
        selection: EMPTY_SELECTION,
        setSelection: (selection) => set({ selection }),
        clipboard: null,
        setClipboard: (nodes) => set({ clipboard: nodes }),
        dockTabs: [],
        openConsoleTab: (projectId, nodeId, title) =>
          openTab({
            id: `console:${projectId}:${nodeId}`,
            projectId,
            kind: 'console',
            nodeId,
            title,
          }),
        openVncTab: (projectId, nodeId, title) =>
          openTab({ id: `vnc:${projectId}:${nodeId}`, projectId, kind: 'vnc', nodeId, title }),
        openHttpConsoleTab: (projectId, nodeId, title) =>
          openTab({
            id: `http:${projectId}:${nodeId}`,
            projectId,
            kind: 'http',
            nodeId,
            title,
          }),
        openWiresharkTab: (projectId, linkId, title) =>
          openTab({
            id: `wireshark:${projectId}:${linkId}`,
            projectId,
            kind: 'wireshark',
            linkId,
            title,
          }),
        closeDockTab: (id) =>
          set((state) => {
            const dockTabs = state.dockTabs.filter((tab) => tab.id !== id);
            return {
              dockTabs,
              activeDockTab: state.activeDockTab === id ? 'events' : state.activeDockTab,
            };
          }),
        activeDockTab: 'events',
        setActiveDockTab: (id) => set({ activeDockTab: id }),
        dockOpen: false,
        setDockOpen: (open) => set({ dockOpen: open }),
        consoleSplit: 1,
        setConsoleSplit: (consoleSplit) => set({ consoleSplit }),
        minimapVisible: !startsNarrow,
        setMinimapVisible: (minimapVisible) => set({ minimapVisible }),
        portLabelsAlways: false,
        setPortLabelsAlways: (portLabelsAlways) => set({ portLabelsAlways }),
        paletteOpen: !startsNarrow,
        setPaletteOpen: (open) => set({ paletteOpen: open }),
        inspectorOpen: false,
        setInspectorOpen: (open) => set({ inspectorOpen: open }),
        dockHeight: 220,
        setDockHeight: (height) => set({ dockHeight: Math.min(520, Math.max(140, height)) }),
        paletteWidth: 208,
        setPaletteWidth: (width) => set({ paletteWidth: Math.min(340, Math.max(168, width)) }),
        inspectorWidth: 280,
        setInspectorWidth: (width) => set({ inspectorWidth: Math.min(460, Math.max(240, width)) }),
        undoStack: [],
        redoStack: [],
        pushHistory: (action) =>
          set((state) => ({ undoStack: [...state.undoStack.slice(-99), action], redoStack: [] })),
        pushUndo: (action) =>
          set((state) => ({ undoStack: [...state.undoStack.slice(-99), action] })),
        popUndo: () => {
          const { undoStack } = get();
          const action = undoStack[undoStack.length - 1];
          if (!action) return undefined;
          set({ undoStack: undoStack.slice(0, -1) });
          return action;
        },
        pushRedo: (action) =>
          set((state) => ({ redoStack: [...state.redoStack.slice(-99), action] })),
        popRedo: () => {
          const { redoStack } = get();
          const action = redoStack[redoStack.length - 1];
          if (!action) return undefined;
          set({ redoStack: redoStack.slice(0, -1) });
          return action;
        },
        clearHistory: () => set({ undoStack: [], redoStack: [] }),
      };
    },
    {
      name: 'netlabor-workspace',
      version: 2,
      partialize: (state) => ({
        dockTabs: state.dockTabs,
        activeDockTab: state.activeDockTab,
        dockOpen: state.dockOpen,
        consoleSplit: state.consoleSplit,
        paletteOpen: state.paletteOpen,
        minimapVisible: state.minimapVisible,
        portLabelsAlways: state.portLabelsAlways,
        inspectorOpen: state.inspectorOpen,
        dockHeight: state.dockHeight,
        paletteWidth: state.paletteWidth,
        inspectorWidth: state.inspectorWidth,
      }),
    },
  ),
);
