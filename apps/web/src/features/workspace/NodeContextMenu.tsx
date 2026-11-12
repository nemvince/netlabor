import type { NodeRow } from '@netlabor/contract';
import {
  Ban,
  Copy,
  Globe,
  Monitor,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useEffect } from 'react';

export type ContextAction =
  | 'edit'
  | 'start'
  | 'stop'
  | 'suspend'
  | 'reload'
  | 'isolate'
  | 'unisolate'
  | 'console'
  | 'vnc'
  | 'web-console'
  | 'duplicate'
  | 'delete';

/** Right-click menu for one node, positioned at the pointer. */
export function NodeContextMenu({
  node,
  x,
  y,
  canControl,
  canConsole,
  canUpdate,
  onAction,
  onClose,
}: {
  node: NodeRow;
  x: number;
  y: number;
  canControl: boolean;
  canConsole: boolean;
  canUpdate: boolean;
  onAction: (action: ContextAction) => void;
  onClose: () => void;
}) {
  const started = node.status === 'started';
  const suspended = node.status === 'suspended';
  const supportsSuspend = node.nodeType === 'qemu' || node.nodeType === 'dynamips';
  const consoleAvailable =
    node.consoleType !== 'none' && node.consoleType !== 'http' && node.consoleType !== 'https';
  const webConsole = node.consoleType === 'http' || node.consoleType === 'https';
  const left = Math.max(8, Math.min(x, window.innerWidth - 260));
  const top = Math.max(8, Math.min(y, window.innerHeight - 360));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function run(action: ContextAction) {
    onClose();
    onAction(action);
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close node menu"
        className="absolute inset-0 h-full w-full cursor-default"
        style={{ background: 'transparent' }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label={`Actions for ${node.name}`}
        className="absolute w-[220px] rounded-[3px] border py-1"
        style={{
          left,
          top,
          background: 'var(--color-panel)',
          borderColor: 'var(--color-rule-strong)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <span
            aria-hidden
            className="inline-block size-[6px] shrink-0 rounded-full"
            style={{
              background:
                node.status === 'started'
                  ? 'var(--color-signal-up)'
                  : node.status === 'error'
                    ? 'var(--color-signal-down)'
                    : node.status === 'suspended'
                      ? 'var(--color-signal-warn)'
                      : 'var(--color-ink-faint)',
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{node.name}</span>
            <span className="nb-rule-label">
              {node.nodeType} · {node.status}
            </span>
          </span>
        </div>

        <Item
          icon={Pencil}
          label="Edit properties"
          hint="Open the inspector for this node"
          disabled={false}
          onClick={() => run('edit')}
        />

        {canControl ? (
          <>
            <Divider />
            {!started && !suspended ? (
              <Item icon={Play} label="Start" disabled={false} onClick={() => run('start')} />
            ) : (
              <>
                <Item icon={Square} label="Stop" disabled={false} onClick={() => run('stop')} />
                <Item
                  icon={RotateCw}
                  label="Reload"
                  disabled={false}
                  onClick={() => run('reload')}
                />
                {supportsSuspend && started ? (
                  <Item
                    icon={Pause}
                    label="Suspend"
                    disabled={false}
                    onClick={() => run('suspend')}
                  />
                ) : null}
              </>
            )}
          </>
        ) : null}

        {started && canConsole && (consoleAvailable || webConsole) ? (
          <>
            <Divider />
            {node.consoleType === 'vnc' ? (
              <Item icon={Monitor} label="Open VNC" disabled={false} onClick={() => run('vnc')} />
            ) : webConsole ? (
              <Item
                icon={Globe}
                label="Open web console"
                disabled={false}
                onClick={() => run('web-console')}
              />
            ) : (
              <Item
                icon={SquareTerminal}
                label="Open console"
                disabled={false}
                onClick={() => run('console')}
              />
            )}
          </>
        ) : null}

        {canControl ? (
          <>
            <Divider />
            <Item
              icon={node.isolated ? Wifi : Ban}
              label={node.isolated ? 'Unisolate' : 'Isolate'}
              hint={
                node.isolated ? 'Reconnect the node to its links' : 'Detach the node from its links'
              }
              disabled={false}
              onClick={() => run(node.isolated ? 'unisolate' : 'isolate')}
            />
          </>
        ) : null}

        {canUpdate ? (
          <>
            <Divider />
            <Item icon={Copy} label="Duplicate" disabled={false} onClick={() => run('duplicate')} />
            <Item
              icon={Trash2}
              label="Delete node"
              danger
              disabled={false}
              onClick={() => run('delete')}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px" style={{ background: 'var(--color-rule)' }} />;
}

function Item({
  icon: Icon,
  label,
  hint,
  disabled,
  disabledHint,
  danger,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  hint?: string;
  disabled: boolean;
  disabledHint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const title = disabled ? disabledHint : hint;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: danger ? 'var(--color-signal-down)' : 'var(--color-ink)' }}
    >
      <Icon size={14} aria-hidden /> {label}
    </button>
  );
}
