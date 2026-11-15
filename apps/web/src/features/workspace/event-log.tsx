import type { EventEnvelope } from '@netlabor/contract';
import { Eraser } from 'lucide-react';
import type { SseStatus } from './use-project-events.ts';

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const TYPE_COLOR: Record<string, string> = {
  'project.updated': 'var(--color-signal-info)',
  'project.deleted': 'var(--color-signal-down)',
  'node.created': 'var(--color-signal-up)',
  'node.updated': 'var(--color-ink-dim)',
  'node.deleted': 'var(--color-signal-down)',
  'node.status': 'var(--color-signal-up)',
  'link.created': 'var(--color-signal-up)',
  'link.updated': 'var(--color-ink-dim)',
  'link.deleted': 'var(--color-signal-down)',
  'link.status': 'var(--color-signal-up)',
  'capture.started': 'var(--color-copper)',
  'capture.stopped': 'var(--color-copper)',
  'marker.hit': 'var(--color-signal-warn)',
  'job.updated': 'var(--color-signal-info)',
  'snapshot.created': 'var(--color-signal-info)',
  error: 'var(--color-signal-down)',
};

function summarize(event: EventEnvelope): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(event.payload)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    }
    if (parts.length >= 4) break;
  }
  return parts.join(' ');
}

export function EventLog({
  events,
  status,
  onClear,
}: {
  events: EventEnvelope[];
  status: SseStatus;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex items-center justify-between border-b px-2 py-1"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <span
          className="flex items-center gap-2 text-[11px]"
          style={{ color: 'var(--color-ink-dim)' }}
        >
          <span
            aria-hidden
            className="inline-block size-[6px] rounded-full"
            style={{
              background:
                status === 'live'
                  ? 'var(--color-signal-up)'
                  : status === 'connecting'
                    ? 'var(--color-signal-warn)'
                    : 'var(--color-signal-down)',
            }}
          />
          {status === 'live' ? 'live' : status === 'connecting' ? 'connecting' : 'reconnecting'}
          <span style={{ color: 'var(--color-ink-faint)' }}>· {events.length} events</span>
        </span>
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          data-variant="ghost"
          onClick={onClear}
          disabled={events.length === 0}
        >
          <Eraser size={12} aria-hidden /> Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-3 py-3 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            Waiting for project events. Mutations on this or another browser arrive here.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-rule)' }}>
            {events.map((event) => (
              <li
                key={`${event.id}-${event.ts}`}
                className="flex items-baseline gap-2 px-2 py-1 text-[11px] hover:bg-white/[0.02]"
                style={{ borderColor: 'var(--color-rule)' }}
                title={JSON.stringify(event, null, 2)}
              >
                <span className="tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  {clock.format(new Date(event.ts))}
                </span>
                <span className="tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  #{event.id}
                </span>
                <span
                  className="shrink-0 font-medium"
                  style={{ color: TYPE_COLOR[event.type] ?? 'var(--color-ink)' }}
                >
                  {event.type}
                </span>
                <span
                  className="tabular min-w-0 flex-1 truncate"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  {summarize(event)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
