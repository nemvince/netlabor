/** In-process event bus with persistence and replayable SSE subscriptions. */

import { type EventEnvelope, type EventType, STREAM_ONLY_EVENTS } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { AsyncQueue, type Logger } from '@netlabor/shared';
import type { SQL } from 'bun';
import { sseClientClosed, sseClientOpened } from '../metrics.ts';
import { enterProject, leaveProject, touchProject } from '../services/activity.ts';

export interface PublishInput {
  type: EventType;
  projectId?: string | null;
  userId?: string | null;
  payload?: Record<string, unknown>;
}

type Listener = (event: EventEnvelope) => void;

/** Ring buffer of marker hits per project (never persisted). */
const MARKER_HIT_LIMIT = 1000;

export class EventBus {
  private readonly listeners = new Set<{
    projectId: string | null;
    userId: string | null;
    fn: Listener;
  }>();
  private readonly markerHits = new Map<string, EventEnvelope[]>();

  constructor(
    private readonly db: SQL,
    private readonly logger: Logger,
  ) {}

  /** Persist and broadcast. Streaming-only types are broadcast but not stored. */
  async publish(input: PublishInput): Promise<EventEnvelope> {
    touchProject(input.projectId);
    const payload = input.payload ?? {};
    if (STREAM_ONLY_EVENTS.includes(input.type)) {
      const event: EventEnvelope = {
        id: 0,
        type: input.type,
        projectId: input.projectId ?? null,
        userId: input.userId ?? null,
        ts: new Date().toISOString(),
        payload,
      };
      this.broadcast(event);
      return event;
    }
    const rows = await this.db.unsafe<{ id: string | number; created_at: Date }[]>(
      `INSERT INTO events (project_id, user_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id, created_at`,
      [input.projectId ?? null, input.userId ?? null, input.type, payload],
    );
    const event: EventEnvelope = {
      id: Number(rows[0]?.id ?? 0),
      type: input.type,
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      ts: (rows[0]?.created_at ?? new Date()).toISOString(),
      payload,
    };
    this.broadcast(event);
    return event;
  }

  /** Record a marker hit in the bounded ring and broadcast it live. */
  recordMarkerHit(projectId: string, event: EventEnvelope): void {
    const ring = this.markerHits.get(projectId) ?? [];
    ring.push(event);
    if (ring.length > MARKER_HIT_LIMIT) ring.splice(0, ring.length - MARKER_HIT_LIMIT);
    this.markerHits.set(projectId, ring);
    this.broadcast(event);
  }

  recentMarkerHits(projectId: string, limit = 200): EventEnvelope[] {
    return (this.markerHits.get(projectId) ?? []).slice(-limit);
  }

  private broadcast(event: EventEnvelope): void {
    for (const listener of this.listeners) {
      if (listener.projectId && listener.projectId !== event.projectId) continue;
      if (listener.userId && listener.userId !== event.userId) continue;
      try {
        listener.fn(event);
      } catch (err) {
        this.logger.warn('event listener failed', { err });
      }
    }
  }

  /**
   * Replay persisted events after `lastEventId` then stream live ones.
   * `projectId === null` streams global (non-project) events.
   */
  async *stream(options: {
    projectId?: string | null;
    userId?: string | null;
    lastEventId?: number;
    filter?: (event: EventEnvelope) => boolean;
    signal?: AbortSignal;
  }): AsyncGenerator<EventEnvelope> {
    const queue = new AsyncQueue<EventEnvelope>();
    const listener = {
      projectId: options.projectId ?? null,
      userId: options.userId ?? null,
      fn: (event: EventEnvelope) => {
        if (options.filter && !options.filter(event)) return;
        if (event.type === 'marker.hit' && options.projectId !== event.projectId) return;
        queue.push(event);
      },
    };
    this.listeners.add(listener);
    if (options.projectId) enterProject(options.projectId);
    sseClientOpened();

    const cleanup = () => {
      this.listeners.delete(listener);
      if (options.projectId) leaveProject(options.projectId);
      sseClientClosed();
      queue.close();
    };
    options.signal?.addEventListener('abort', cleanup, { once: true });

    try {
      if (options.lastEventId !== undefined) {
        const replay = await this.db.unsafe<
          {
            id: string | number;
            project_id: string | null;
            user_id: string | null;
            type: string;
            payload: Record<string, unknown>;
            created_at: Date;
          }[]
        >(
          `SELECT id, project_id, user_id, type, payload, created_at
             FROM events
            WHERE id > $2
              AND ($1::uuid IS NULL OR project_id = $1::uuid)
            ORDER BY id ASC
            LIMIT 1000`,
          [options.projectId ?? null, options.lastEventId],
        );
        for (const row of replay) {
          const event: EventEnvelope = {
            id: Number(row.id),
            type: row.type as EventType,
            projectId: row.project_id,
            userId: row.user_id,
            ts: row.created_at.toISOString(),
            payload: parseJsonColumn(row.payload, {}),
          };
          if (options.filter && !options.filter(event)) continue;
          yield event;
        }
      }
      while (!options.signal?.aborted) {
        const next = await queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      cleanup();
    }
  }
}
