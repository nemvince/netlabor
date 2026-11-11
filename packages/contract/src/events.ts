/** Event envelope and persisted event types. */

import { z } from 'zod';
import { Id } from './schemas/common.ts';

export const EVENT_TYPES = [
  'project.updated',
  'project.deleted',
  'node.created',
  'node.updated',
  'node.deleted',
  'node.status',
  'link.created',
  'link.updated',
  'link.deleted',
  'link.status',
  'drawing.created',
  'drawing.updated',
  'drawing.deleted',
  'capture.started',
  'capture.stopped',
  'marker.hit',
  'fault.applied',
  'fault.cleared',
  'job.updated',
  'compute.status',
  'image.updated',
  'appliance.updated',
  'snapshot.created',
  'log',
] as const;

export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** Streaming-only events are never persisted to the `events` table. */
export const STREAM_ONLY_EVENTS: readonly EventType[] = ['marker.hit'];

export const EventEnvelope = z.object({
  id: z.number().int(),
  type: EventType,
  projectId: Id.nullable().optional(),
  userId: Id.nullable().optional(),
  ts: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Marker hit payload; bounded ring buffer, not persisted. */
export const MarkerHit = z.object({
  projectId: Id,
  linkId: Id,
  markerId: Id,
  name: z.string(),
  tag: z.number().int(),
  direction: z.enum(['tx', 'rx']),
  length: z.number().int(),
  ts: z.string(),
});
export type MarkerHit = z.infer<typeof MarkerHit>;

export function makeEvent(input: {
  id: number;
  type: EventType;
  projectId?: string | null;
  userId?: string | null;
  payload?: Record<string, unknown>;
  ts?: string;
}): EventEnvelope {
  return {
    id: input.id,
    type: input.type,
    projectId: input.projectId ?? null,
    userId: input.userId ?? null,
    ts: input.ts ?? new Date().toISOString(),
    payload: input.payload ?? {},
  };
}
