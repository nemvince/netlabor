import type { ProjectRow } from '@netlabor/contract';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Eye,
  FolderOpen,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Power,
  Share2,
  Square,
  Unlock,
  Zap,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { Badge } from '../../components/Badge.tsx';

const MENU_CLASS = 'z-50 min-w-52 rounded-[3px] border p-1';
const MENU_STYLE = {
  background: 'var(--color-panel)',
  borderColor: 'var(--color-rule-strong)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
} as const;
const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 text-[12px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/[0.06]';

function MenuItem({
  icon,
  children,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item className={ITEM_CLASS} disabled={disabled} onSelect={onSelect}>
      <span aria-hidden style={{ color: 'var(--color-ink-faint)' }}>
        {icon}
      </span>
      {children}
    </DropdownMenu.Item>
  );
}

/** Workspace top bar: project lifecycle, bulk power, and grouped project tools. */
export function ProjectTopBar({
  project,
  nodeCount,
  busy,
  exportProgress,
  canOpen,
  canWrite,
  canExport,
  canFault,
  canShare,
  onToggleOpen,
  onStartAll,
  onStopAll,
  onToggleLock,
  onOpenSnapshots,
  onOpenFaults,
  onOpenShare,
  onOpenFiles,
  onOpenTemplates,
  onExport,
  onDuplicate,
  paletteOpen,
  inspectorOpen,
  dockOpen,
  onTogglePalette,
  onToggleInspector,
  onToggleDock,
  collaborators,
  selfCollabId,
  collabStatus,
}: {
  project: ProjectRow;
  nodeCount: number;
  busy: string | null;
  exportProgress: number | null;
  canOpen: boolean;
  canWrite: boolean;
  canExport: boolean;
  canFault: boolean;
  canShare: boolean;
  onToggleOpen: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onToggleLock: () => void;
  onOpenSnapshots: () => void;
  onOpenFaults: () => void;
  onOpenShare: () => void;
  onOpenFiles: () => void;
  onOpenTemplates: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  dockOpen: boolean;
  onTogglePalette: () => void;
  onToggleInspector: () => void;
  onToggleDock: () => void;
  collaborators: { id: string; name: string; color: string }[];
  selfCollabId: string | null;
  collabStatus: 'connecting' | 'live' | 'offline';
}) {
  const opened = project.status === 'opened';
  return (
    <header
      className="flex h-[42px] shrink-0 items-center gap-2 border-b px-2"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
    >
      <Link
        to="/projects"
        className="nb-button"
        data-size="sm"
        data-variant="ghost"
        aria-label="Back to projects"
        title="Back to projects"
      >
        <ArrowLeft size={14} aria-hidden />
      </Link>
      <span className="min-w-0">
        <span className="block max-w-[240px] truncate text-[13px] leading-[1.2] font-semibold">
          {project.name}
        </span>
        <span
          className="tabular block text-[10px] leading-[1.3]"
          style={{ color: 'var(--color-ink-faint)' }}
          title={`Project ${project.id}`}
        >
          {nodeCount === 1 ? '1 node' : `${nodeCount} nodes`}
        </span>
      </span>
      <Badge tone={opened ? 'up' : 'neutral'}>{opened ? 'opened' : 'closed'}</Badge>
      {project.locked ? <Badge tone="warn">locked</Badge> : null}
      <span aria-hidden className="mx-1 h-4 w-px" style={{ background: 'var(--color-rule)' }} />

      {canOpen ? (
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          data-variant={opened ? undefined : 'primary'}
          disabled={busy !== null}
          onClick={onToggleOpen}
        >
          <Power size={13} aria-hidden />{' '}
          {busy === 'toggle-open' ? 'Working…' : opened ? 'Close' : 'Open'}
        </button>
      ) : null}
      <button
        type="button"
        className="nb-button"
        data-size="sm"
        disabled={!opened || busy !== null || nodeCount === 0}
        onClick={onStartAll}
        title="Start every stopped node"
      >
        <Play size={13} aria-hidden /> {busy === 'start-all' ? 'Starting…' : 'Start all'}
      </button>
      <button
        type="button"
        className="nb-button"
        data-size="sm"
        disabled={!opened || busy !== null || nodeCount === 0}
        onClick={onStopAll}
        title="Stop every running node"
      >
        <Square size={13} aria-hidden /> {busy === 'stop-all' ? 'Stopping…' : 'Stop all'}
      </button>

      <span className="ml-auto flex items-center gap-1">
        {collaborators.length > 0 ? (
          <span
            className="flex items-center gap-1 pr-1"
            title={
              collabStatus === 'live'
                ? `${collaborators.length} live collaborator${collaborators.length === 1 ? '' : 's'}`
                : 'Collaboration reconnecting'
            }
          >
            <span className="flex -space-x-1">
              {collaborators.slice(0, 5).map((participant) => {
                const initials = participant.name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();
                return (
                  <span
                    key={participant.id}
                    className="flex size-5 items-center justify-center rounded-full border text-[8px] font-bold"
                    style={{
                      background: participant.color,
                      borderColor: 'var(--color-panel)',
                      color: '#111417',
                      zIndex: participant.id === selfCollabId ? 2 : 1,
                    }}
                    title={`${participant.name}${participant.id === selfCollabId ? ' (you)' : ''}`}
                  >
                    {initials || '?'}
                  </span>
                );
              })}
              {collaborators.length > 5 ? (
                <span
                  className="flex size-5 items-center justify-center rounded-full border text-[8px]"
                  style={{
                    background: 'var(--color-panel-raised)',
                    borderColor: 'var(--color-panel)',
                    color: 'var(--color-ink-dim)',
                  }}
                  title={collaborators
                    .slice(5)
                    .map((participant) => participant.name)
                    .join(', ')}
                >
                  +{collaborators.length - 5}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden
              className="size-[5px] rounded-full"
              style={{
                background:
                  collabStatus === 'live' ? 'var(--color-signal-up)' : 'var(--color-signal-warn)',
              }}
            />
          </span>
        ) : null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="nb-button" data-size="sm" title="Panel visibility">
              <Eye size={13} aria-hidden /> View
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className={MENU_CLASS}
              style={MENU_STYLE}
            >
              <MenuItem
                icon={paletteOpen ? <Check size={13} /> : <PanelLeft size={13} />}
                onSelect={onTogglePalette}
              >
                Palette
              </MenuItem>
              <MenuItem
                icon={inspectorOpen ? <Check size={13} /> : <PanelRight size={13} />}
                onSelect={onToggleInspector}
              >
                Inspector
              </MenuItem>
              <MenuItem
                icon={dockOpen ? <Check size={13} /> : <PanelBottom size={13} />}
                onSelect={onToggleDock}
              >
                Console dock
              </MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="nb-button" data-size="sm" title="Project tools">
              <MoreHorizontal size={14} aria-hidden /> More
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className={MENU_CLASS}
              style={MENU_STYLE}
            >
              {canWrite ? (
                <MenuItem
                  icon={project.locked ? <Unlock size={13} /> : <Lock size={13} />}
                  onSelect={onToggleLock}
                  disabled={busy !== null}
                >
                  {project.locked ? 'Unlock topology' : 'Lock topology'}
                </MenuItem>
              ) : null}
              {canFault ? (
                <MenuItem icon={<Zap size={13} />} onSelect={onOpenFaults}>
                  Faults…
                </MenuItem>
              ) : null}
              {canShare ? (
                <MenuItem icon={<Share2 size={13} />} onSelect={onOpenShare}>
                  Share…
                </MenuItem>
              ) : null}
              <DropdownMenu.Separator
                className="my-1 h-px"
                style={{ background: 'var(--color-rule)' }}
              />
              <MenuItem icon={<FolderOpen size={13} />} onSelect={onOpenFiles}>
                Files…
              </MenuItem>
              <MenuItem icon={<LayoutTemplate size={13} />} onSelect={onOpenTemplates}>
                Templates…
              </MenuItem>
              <MenuItem icon={<Copy size={13} />} onSelect={onOpenSnapshots}>
                Snapshots…
              </MenuItem>
              {canExport ? (
                <MenuItem
                  icon={<Download size={13} />}
                  onSelect={onExport}
                  disabled={exportProgress !== null}
                >
                  {exportProgress !== null ? `Exporting ${exportProgress}%…` : 'Export project…'}
                </MenuItem>
              ) : null}
              {canWrite ? (
                <MenuItem icon={<Copy size={13} />} onSelect={onDuplicate} disabled={busy !== null}>
                  Duplicate project…
                </MenuItem>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </span>
    </header>
  );
}
