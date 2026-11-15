import type { LinkRow } from '@netlabor/contract';
import { Download, Pause, Pencil, Play, Radio, Square, Trash2, Waves, XCircle } from 'lucide-react';
import { useEffect } from 'react';

export type LinkContextAction =
  | 'edit'
  | 'suspend'
  | 'resume'
  | 'capture-start'
  | 'capture-stop'
  | 'wireshark'
  | 'clear-filters'
  | 'delete';

/** Right-click menu for one link, positioned at the pointer. */
export function LinkContextMenu({
  link,
  x,
  y,
  canControl,
  canUpdate,
  onAction,
  onClose,
}: {
  link: LinkRow;
  x: number;
  y: number;
  canControl: boolean;
  canUpdate: boolean;
  onAction: (action: LinkContextAction) => void;
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 240));
  const top = Math.max(8, Math.min(y, window.innerHeight - 320));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function run(action: LinkContextAction) {
    onClose();
    onAction(action);
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close link menu"
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
        aria-label={`Actions for link ${link.nodeAName} ↔ ${link.nodeBName}`}
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
                link.status === 'active'
                  ? 'var(--color-signal-up)'
                  : link.status === 'error'
                    ? 'var(--color-signal-down)'
                    : link.status === 'suspended'
                      ? 'var(--color-signal-warn)'
                      : 'var(--color-ink-faint)',
            }}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
            {link.nodeAName} ↔ {link.nodeBName}
          </span>
        </div>

        <Item icon={Pencil} label="Edit link" onClick={() => run('edit')} />

        {canControl ? (
          <>
            <Divider />
            {link.suspend ? (
              <Item icon={Play} label="Resume link" onClick={() => run('resume')} />
            ) : (
              <Item icon={Pause} label="Suspend link" onClick={() => run('suspend')} />
            )}
          </>
        ) : null}

        <Divider />
        {link.capture?.active ? (
          <Item
            icon={Square}
            label="Stop capture"
            disabled={!canControl}
            onClick={() => run('capture-stop')}
          />
        ) : (
          <Item
            icon={Radio}
            label="Start capture"
            disabled={!canControl}
            onClick={() => run('capture-start')}
          />
        )}
        <Item icon={Waves} label="Open Wireshark" onClick={() => run('wireshark')} />
        {link.capture ? (
          <Item
            icon={Download}
            label="Download pcap"
            onClick={() => {
              onClose();
              window.location.href = `/api/links/${link.id}/capture.pcap`;
            }}
          />
        ) : null}

        {canUpdate ? (
          <>
            <Divider />
            <Item icon={XCircle} label="Clear filters" onClick={() => run('clear-filters')} />
            <Item icon={Trash2} label="Delete link" danger onClick={() => run('delete')} />
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
  disabled,
  danger,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: danger ? 'var(--color-signal-down)' : 'var(--color-ink)' }}
    >
      <Icon size={14} aria-hidden /> {label}
    </button>
  );
}
