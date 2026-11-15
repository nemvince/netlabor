import type { EventEnvelope } from '@netlabor/contract';
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Maximize2,
  Minimize2,
  Monitor,
  ScrollText,
  SquareTerminal,
  Waves,
  Wrench,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { EventLog } from './EventLog.tsx';
import { type DockTabSpec, useWorkspaceStore } from './store.ts';
import type { SseStatus } from './useProjectEvents.ts';

// Terminal, VNC, and packet tabs pull in their own heavy clients only when a
// dock tab of that kind exists.
const ConsoleTab = lazy(() => import('./ConsoleTab.tsx').then((m) => ({ default: m.ConsoleTab })));
const VncTab = lazy(() => import('./VncTab.tsx').then((m) => ({ default: m.VncTab })));
const WiresharkTab = lazy(() =>
  import('./WiresharkTab.tsx').then((m) => ({ default: m.WiresharkTab })),
);
const ToolPanel = lazy(() =>
  import('../tools/ToolsPage.tsx').then((m) => ({ default: m.ToolPanel })),
);

const SPLITS = [1, 2, 4] as const;

function TabIcon({ kind }: { kind: DockTabSpec['kind'] }) {
  if (kind === 'vnc') return <Monitor size={11} aria-hidden />;
  if (kind === 'wireshark') return <Waves size={11} aria-hidden />;
  if (kind === 'http') return <Globe size={11} aria-hidden />;
  if (kind === 'tool') return <Wrench size={11} aria-hidden />;
  return <SquareTerminal size={11} aria-hidden />;
}

/** Bottom dock: project event log plus consoles, VNC, and Wireshark surfaces. */
export function BottomDock({
  projectId,
  events,
  status,
  onClearEvents,
}: {
  projectId: string;
  events: EventEnvelope[];
  status: SseStatus;
  onClearEvents: () => void;
}) {
  const dockTabs = useWorkspaceStore((state) => state.dockTabs).filter(
    (tab) => tab.projectId === projectId,
  );
  const activeDockTab = useWorkspaceStore((state) => state.activeDockTab);
  const setActiveDockTab = useWorkspaceStore((state) => state.setActiveDockTab);
  const closeDockTab = useWorkspaceStore((state) => state.closeDockTab);
  const dockOpen = useWorkspaceStore((state) => state.dockOpen);
  const setDockOpen = useWorkspaceStore((state) => state.setDockOpen);
  const dockHeight = useWorkspaceStore((state) => state.dockHeight);
  const consoleSplit = useWorkspaceStore((state) => state.consoleSplit);
  const setConsoleSplit = useWorkspaceStore((state) => state.setConsoleSplit);
  const [expanded, setExpanded] = useState(false);

  const activeTab = dockTabs.find((tab) => tab.id === activeDockTab);
  const consoleTabs = dockTabs.filter((tab) => tab.kind === 'console');
  // Split view lays out the first N console tabs side by side instead of one.
  const splitView = activeTab?.kind === 'console' && consoleSplit > 1 && consoleTabs.length > 1;
  // Closing the dock must also leave the full-screen surface; otherwise the
  // fixed-position panel keeps covering the workspace while "collapsed".
  useEffect(() => {
    if (!dockOpen) setExpanded(false);
  }, [dockOpen]);
  useEffect(() => {
    if (expanded && activeTab === undefined) setExpanded(false);
  }, [expanded, activeTab]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  const showEvents = activeTab === undefined;
  // Wireshark and split consoles need a tall dock; other surfaces stay compact
  // so the inspector and canvas keep their working height.
  const effectiveHeight = dockOpen
    ? activeTab?.kind === 'wireshark' || activeTab?.kind === 'tool' || splitView
      ? Math.max(dockHeight, 460)
      : Math.min(dockHeight, 240)
    : 29;

  return (
    <section
      className={
        expanded
          ? 'fixed inset-3 z-[60] flex flex-col overflow-hidden rounded-[3px] border shadow-[0_24px_80px_rgba(0,0,0,0.6)]'
          : 'relative flex min-h-0 flex-col border-t'
      }
      style={{
        borderColor: 'var(--color-rule)',
        background: 'var(--color-panel)',
        height: expanded ? undefined : effectiveHeight,
      }}
      aria-label={expanded && activeTab ? `${activeTab.title} expanded` : 'Project dock'}
      role={expanded ? 'dialog' : undefined}
    >
      <div
        className="flex h-[28px] shrink-0 items-stretch border-b"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <button
          type="button"
          className="flex items-center gap-1.5 border-r px-2.5 text-[11px]"
          style={{
            borderColor: 'var(--color-rule)',
            background: showEvents ? 'var(--color-panel-sunken)' : 'transparent',
            color: showEvents ? 'var(--color-ink)' : 'var(--color-ink-dim)',
            borderBottom: showEvents ? '2px solid var(--color-copper)' : '2px solid transparent',
          }}
          onClick={() => {
            setActiveDockTab('events');
            setDockOpen(true);
          }}
        >
          <ScrollText size={12} aria-hidden /> Event log
        </button>
        {dockTabs.map((tab) => {
          const active = activeDockTab === tab.id;
          return (
            <span
              key={tab.id}
              className="flex items-stretch border-r"
              style={{
                borderColor: 'var(--color-rule)',
                borderBottom: active ? '2px solid var(--color-copper)' : '2px solid transparent',
              }}
            >
              <button
                type="button"
                className="flex max-w-[240px] items-center gap-1 px-2 text-[11px]"
                style={{
                  background: active ? 'var(--color-panel-sunken)' : 'transparent',
                  color: active ? 'var(--color-ink)' : 'var(--color-ink-dim)',
                }}
                title={tab.title}
                onClick={() => {
                  setActiveDockTab(tab.id);
                  setDockOpen(true);
                }}
              >
                <TabIcon kind={tab.kind} />
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.kind} ${tab.title}`}
                title={`Close ${tab.title}`}
                className="nb-dock-close flex w-6 items-center justify-center rounded-[1px] transition-colors focus-visible:bg-white/[0.1]"
                data-active={active ? 'true' : undefined}
                onClick={() => closeDockTab(tab.id)}
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          );
        })}
        {activeTab?.kind === 'console' && consoleTabs.length > 1 ? (
          <span className="ml-auto flex items-center gap-px pr-1" title="Console layout">
            {SPLITS.map((split) => (
              <button
                key={split}
                type="button"
                className="nb-dock-close flex h-[22px] w-6 items-center justify-center rounded-[1px] text-[10px]"
                data-active={(splitView ? consoleSplit : 1) === split ? 'true' : undefined}
                aria-label={`Show ${split} console${split === 1 ? '' : 's'} side by side`}
                aria-pressed={(splitView ? consoleSplit : 1) === split}
                title={split === 1 ? 'Single console' : `${split} consoles side by side`}
                onClick={() => {
                  setConsoleSplit(split);
                  setDockOpen(true);
                  if (split > 1 && expanded) setExpanded(false);
                }}
                style={{ color: 'var(--color-ink-dim)' }}
              >
                {split === 1 ? <SquareTerminal size={11} aria-hidden /> : split}
              </button>
            ))}
          </span>
        ) : null}
        {activeTab ? (
          <button
            type="button"
            className={`${
              activeTab.kind === 'console' && consoleTabs.length > 1 ? '' : 'ml-auto '
            }flex w-7 items-center justify-center`}
            aria-label={expanded ? 'Restore tab to dock' : `Expand ${activeTab.kind}`}
            title={expanded ? 'Restore to dock (Esc)' : 'Expand to full screen'}
            onClick={() => setExpanded((value) => !value)}
            style={{ color: expanded ? 'var(--color-copper)' : 'var(--color-ink-faint)' }}
          >
            {expanded ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
          </button>
        ) : null}
        <button
          type="button"
          className={`${activeTab ? '' : 'ml-auto '}flex w-7 items-center justify-center`}
          aria-label={dockOpen ? 'Collapse dock' : 'Expand dock'}
          title={dockOpen ? 'Collapse dock' : 'Expand dock'}
          onClick={() => {
            if (dockOpen) {
              setExpanded(false);
              setDockOpen(false);
            } else {
              setDockOpen(true);
            }
          }}
          style={{ color: 'var(--color-ink-faint)' }}
        >
          {dockOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
        </button>
      </div>
      <div
        className={
          dockOpen
            ? 'relative min-h-0 flex-1'
            : 'invisible pointer-events-none absolute inset-x-0 top-[28px]'
        }
        style={dockOpen ? undefined : { height: dockHeight }}
        aria-hidden={!dockOpen}
        inert={!dockOpen}
      >
        {showEvents ? (
          <div className="absolute inset-0 min-h-0">
            <EventLog events={events} status={status} onClear={onClearEvents} />
          </div>
        ) : null}
        {splitView ? (
          <div
            className="absolute inset-0 grid min-h-0 gap-px"
            style={{
              gridTemplateColumns: `repeat(${Math.min(consoleSplit, 2)}, minmax(0, 1fr))`,
              gridTemplateRows: consoleSplit === 4 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
            }}
          >
            {consoleTabs.slice(0, consoleSplit).map((tab) => (
              <div
                key={tab.id}
                className="relative flex min-h-0 min-w-0 flex-col border-b border-r"
                style={{ borderColor: 'var(--color-rule)' }}
              >
                <span
                  className="shrink-0 truncate px-2 py-0.5 text-[10px]"
                  style={{ color: 'var(--color-ink-faint)' }}
                >
                  {tab.title}
                </span>
                <div className="relative min-h-0 flex-1">
                  <Suspense fallback={null}>
                    <ConsoleTab nodeId={tab.nodeId} label={tab.title} />
                  </Suspense>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {!splitView
          ? dockTabs.map((tab) => {
              const active = activeDockTab === tab.id;
              return (
                <div
                  key={tab.id}
                  className={`absolute inset-0 min-h-0 ${
                    active ? 'visible' : 'invisible pointer-events-none'
                  }`}
                  aria-hidden={!active}
                  inert={!active}
                >
                  {tab.kind === 'vnc' ? (
                    <Suspense fallback={null}>
                      <VncTab nodeId={tab.nodeId} label={tab.title} />
                    </Suspense>
                  ) : tab.kind === 'wireshark' ? (
                    <Suspense fallback={null}>
                      <WiresharkTab linkId={tab.linkId} label={tab.title} />
                    </Suspense>
                  ) : tab.kind === 'http' ? (
                    <iframe
                      title={`Web console for ${tab.title}`}
                      src={`/api/nodes/${tab.nodeId}/console/`}
                      className="h-full w-full border-0"
                      style={{ background: '#ffffff' }}
                      allow="clipboard-read; clipboard-write"
                    />
                  ) : tab.kind === 'tool' ? (
                    <div className="h-full overflow-y-auto px-3 pb-3">
                      <Suspense fallback={null}>
                        <ToolPanel tool={tab.toolId} />
                      </Suspense>
                    </div>
                  ) : (
                    <Suspense fallback={null}>
                      <ConsoleTab nodeId={tab.nodeId} label={tab.title} />
                    </Suspense>
                  )}
                </div>
              );
            })
          : null}
      </div>
    </section>
  );
}
