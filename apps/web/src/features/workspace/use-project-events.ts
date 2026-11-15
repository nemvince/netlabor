import type { EventEnvelope } from '@netlabor/contract';
import { consumeEventIterator } from '@orpc/client';
import { useEffect, useRef, useState } from 'react';
import { client, orpc } from '../../lib/api.ts';
import { queryClient } from '../../lib/query-client.ts';

export type SseStatus = 'connecting' | 'live' | 'reconnecting';

function invalidateForEvent(event: EventEnvelope) {
  const invalidate = (key: readonly unknown[]) => {
    void queryClient.invalidateQueries({ queryKey: key });
  };
  switch (event.type) {
    case 'project.updated':
    case 'project.deleted':
      invalidate(orpc.projects.get.key());
      invalidate(orpc.projects.list.key());
      invalidate(orpc.projects.stats.key());
      break;
    case 'node.created':
    case 'node.updated':
    case 'node.deleted':
    case 'node.status':
      invalidate(orpc.nodes.list.key());
      invalidate(orpc.projects.get.key());
      break;
    case 'link.created':
    case 'link.updated':
    case 'link.deleted':
    case 'link.status':
    case 'capture.started':
    case 'capture.stopped':
    case 'marker.hit':
      invalidate(orpc.links.list.key());
      invalidate(orpc.projects.get.key());
      break;
    case 'drawing.created':
    case 'drawing.updated':
    case 'drawing.deleted':
      invalidate(orpc.drawings.list.key());
      break;
    case 'snapshot.created':
      invalidate(orpc.snapshots.list.key());
      break;
    case 'compute.status':
      invalidate(orpc.computes.list.key());
      break;
    case 'fault.applied':
    case 'fault.cleared':
      invalidate(orpc.faults.list.key());
      break;
    default:
      break;
  }
}

/**
 * Project SSE stream. Persisted events are replayed from the last seen id,
 * live events patch the smallest affected query, and reconnects resume.
 */
export function useProjectEvents(projectId: string) {
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const lastEventId = useRef<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let stop: (() => Promise<void>) | undefined;
    let retryTimer: number | undefined;
    let openTimer: number | undefined;
    let attempt = 0;

    const schedule = () => {
      if (disposed) return;
      window.clearTimeout(retryTimer);
      const delay = Math.min(1000 * 2 ** attempt, 10_000);
      attempt += 1;
      setStatus('reconnecting');
      retryTimer = window.setTimeout(() => connect(), delay);
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      let settled = false;
      window.clearTimeout(openTimer);
      openTimer = window.setTimeout(() => {
        if (!disposed && !settled) setStatus('live');
      }, 600);

      stop = consumeEventIterator(
        client.projects.events({
          projectId,
          ...(lastEventId.current === undefined ? {} : { lastEventId: lastEventId.current }),
        }),
        {
          onEvent: (event) => {
            if (disposed) return;
            settled = true;
            window.clearTimeout(openTimer);
            attempt = 0;
            setStatus('live');
            lastEventId.current =
              lastEventId.current === undefined
                ? event.id
                : Math.max(lastEventId.current, event.id);
            setEvents((current) => [event, ...current].slice(0, 400));
            invalidateForEvent(event);
          },
          onError: () => {
            if (disposed || settled) return;
            settled = true;
            window.clearTimeout(openTimer);
            schedule();
          },
          onFinish: () => {
            if (disposed || settled) return;
            settled = true;
            window.clearTimeout(openTimer);
            schedule();
          },
        },
      );
      void stop;
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(openTimer);
      void stop?.();
    };
  }, [projectId]);

  return {
    status,
    events,
    clear: () => setEvents([]),
  };
}
