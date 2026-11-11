import type { EventEnvelope } from '@netlabor/contract';
import { EventLog } from '@web/features/workspace/EventLog.tsx';
import type { SseStatus } from '@web/features/workspace/useProjectEvents.ts';
import { useState } from 'react';
import { events as fixtureEvents } from '../fixtures/workspace.ts';

export interface EventFeedProps {
  /** How many fixture envelopes to start with (newest last). */
  count?: number;
  status?: SseStatus;
  height?: number;
}

/** The real event rail, fed fixture envelopes and cleared in local state. */
export default function EventFeed({
  count = fixtureEvents.length,
  status = 'live',
  height = 300,
}: EventFeedProps) {
  const [events, setEvents] = useState<EventEnvelope[]>(() => fixtureEvents.slice(-count));

  return (
    <div className="docs-ui-panel docs-ui-log" style={{ height }}>
      <EventLog events={events} status={status} onClear={() => setEvents([])} />
    </div>
  );
}
