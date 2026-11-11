/** Controller consumption of agent event streams (status, logs, marker hits). */

import { type MarkerHit, makeEvent } from '@netlabor/contract';
import type { AppDeps } from '../implementer.ts';
import { setComputeStatus } from './computes.ts';

const RETRY_MS = 5_000;

export class AgentEventSubscriptions {
  private readonly running = new Set<string>();
  private stopped = false;

  constructor(private readonly deps: AppDeps) {}

  /** Subscribe to every registered compute. */
  async start(): Promise<void> {
    const computes = await this.deps.db.unsafe<{ id: string }[]>('SELECT id FROM computes');
    for (const compute of computes) void this.subscribe(compute.id);
  }

  stop(): void {
    this.stopped = true;
  }

  private async subscribe(computeId: string): Promise<void> {
    if (this.running.has(computeId) || this.stopped) return;
    this.running.add(computeId);
    try {
      while (!this.stopped) {
        try {
          const iterator = await this.deps.agents.call(computeId, (agent) => agent.events({}));
          for await (const event of iterator) {
            await this.handle(computeId, event).catch((error: unknown) => {
              this.deps.logger.warn('agent event handling failed', {
                computeId,
                type: event.type,
                err: error instanceof Error ? error.message : String(error),
              });
            });
            if (this.stopped) break;
          }
        } catch (error) {
          if (this.stopped) break;
          this.deps.logger.debug('agent event stream disconnected', {
            computeId,
            err: error instanceof Error ? error.message : String(error),
          });
        }
        if (this.stopped) break;
        await Bun.sleep(RETRY_MS);
        if (this.stopped) break;
        await setComputeStatus(this.deps.db, computeId, 'offline').catch(() => undefined);
      }
    } finally {
      this.running.delete(computeId);
    }
  }

  private async handle(
    computeId: string,
    event: {
      type: string;
      projectId?: string | null;
      nodeId?: string | null;
      linkId?: string | null;
      ts: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    if (event.type === 'agent.marker.hit' || event.type === 'marker.hit') {
      const payload = event.payload as unknown as MarkerHit & { name?: string };
      if (!payload?.projectId || !payload?.linkId) return;
      let markerId: string | null = payload.markerId ?? null;
      if (!markerId && payload.name) {
        const rows = await this.deps.db.unsafe<{ id: string }[]>(
          'SELECT id FROM markers WHERE link_id = $1 AND name = $2',
          [payload.linkId, payload.name],
        );
        markerId = rows[0]?.id ?? null;
      }
      this.deps.events.recordMarkerHit(
        payload.projectId,
        makeEvent({
          id: 0,
          type: 'marker.hit',
          projectId: payload.projectId,
          payload: {
            projectId: payload.projectId,
            linkId: payload.linkId,
            markerId,
            name: payload.name ?? '',
            tag: payload.tag ?? 0,
            direction: payload.direction ?? 'tx',
            length: payload.length ?? 0,
            ts: event.ts,
          },
          ts: event.ts,
        }),
      );
      return;
    }

    if (event.type === 'agent.capture.started' || event.type === 'agent.capture.stopped') {
      if (!event.linkId || !event.projectId) return;
      await this.deps.events.publish({
        type: event.type === 'agent.capture.started' ? 'capture.started' : 'capture.stopped',
        projectId: event.projectId,
        payload: { linkId: event.linkId, ...event.payload },
      });
      return;
    }

    if (event.type === 'agent.node.status') {
      if (!event.nodeId || !event.projectId) return;
      const status = typeof event.payload.status === 'string' ? event.payload.status : null;
      if (!status) return;
      await this.deps.db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        event.nodeId,
        status,
      ]);
      await this.deps.events.publish({
        type: 'node.status',
        projectId: event.projectId,
        payload: { nodeId: event.nodeId, status },
      });
      return;
    }

    if (event.type === 'agent.link.status') {
      if (!event.linkId || !event.projectId) return;
      const status = typeof event.payload.status === 'string' ? event.payload.status : null;
      if (!status) return;
      await this.deps.db.unsafe('UPDATE links SET status = $2, updated_at = now() WHERE id = $1', [
        event.linkId,
        status,
      ]);
      await this.deps.events.publish({
        type: 'link.status',
        projectId: event.projectId,
        payload: { linkId: event.linkId, status },
      });
      return;
    }

    if (event.type === 'agent.image.ensured' || event.type === 'agent.image.removed') {
      await this.deps.events.publish({
        type: 'image.updated',
        payload: { computeId, ...event.payload },
      });
      return;
    }

    if (event.type.startsWith('agent.log')) {
      this.deps.logger.debug('agent log', { computeId, payload: event.payload });
    }
  }
}
