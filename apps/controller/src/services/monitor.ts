/**
 * Compute monitor: heartbeat polling, offline detection, and reconciliation of
 * node/link status against each agent's reported state.
 */

import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import { setComputeStatus } from './computes.ts';

const HEARTBEAT_INTERVAL_MS = 10_000;
const OFFLINE_AFTER_MS = 30_000;

interface MonitorState {
  timer: ReturnType<typeof setInterval> | undefined;
  lastSuccess: Map<string, number>;
}

export class ComputeMonitor {
  private readonly state: MonitorState = { timer: undefined, lastSuccess: new Map() };

  constructor(private readonly deps: AppDeps) {}

  /** Probe every compute, then start the heartbeat loop. */
  async start(): Promise<void> {
    await this.reconcileAll();
    this.state.timer = setInterval(() => void this.tick(), HEARTBEAT_INTERVAL_MS);
    this.state.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.state.timer);
    this.state.timer = undefined;
  }

  private async tick(): Promise<void> {
    const computes = await this.deps.db.unsafe<{ id: string; name: string; status: string }[]>(
      'SELECT id, name, status FROM computes',
    );
    for (const compute of computes) {
      try {
        await this.deps.agents.call(compute.id, (agent) => agent.heartbeat({}));
        this.state.lastSuccess.set(compute.id, Date.now());
        if (compute.status !== 'online') {
          const capabilities = await this.deps.agents.call(compute.id, (agent) =>
            agent.capabilities({}),
          );
          const info = await this.deps.agents.call(compute.id, (agent) => agent.info({}));
          if (info.apiVersion !== '1') {
            this.deps.logger.warn('agent API version is incompatible', {
              computeId: compute.id,
              agentVersion: info.version,
              agentApiVersion: info.apiVersion,
              controllerApiVersion: '1',
            });
            if (compute.status !== 'error') await this.markStatus(compute.id, compute.name, 'error');
            continue;
          }
          await setComputeStatus(this.deps.db, compute.id, 'online', {
            version: info.version,
            capabilities,
          });
          await this.markStatus(compute.id, compute.name, 'online');
        }
      } catch {
        const last = this.state.lastSuccess.get(compute.id) ?? 0;
        if (Date.now() - last > OFFLINE_AFTER_MS && compute.status !== 'offline') {
          await this.markStatus(compute.id, compute.name, 'offline');
        }
      }
    }
  }

  private async markStatus(
    computeId: string,
    name: string,
    status: 'online' | 'offline' | 'error',
  ): Promise<void> {
    await setComputeStatus(this.deps.db, computeId, status);
    await this.deps.events.publish({
      type: 'compute.status',
      payload: { computeId, name, status },
    });
    this.deps.logger.info('compute status changed', { computeId, name, status });
  }

  /** Reconcile every compute from its reported state; runs at controller start. */
  async reconcileAll(): Promise<void> {
    const computes = await this.deps.db.unsafe<{ id: string; name: string }[]>(
      'SELECT id, name FROM computes',
    );
    for (const compute of computes) {
      try {
        const info = await this.deps.agents.call(compute.id, (agent) => agent.info({}));
        const capabilities = await this.deps.agents.call(compute.id, (agent) =>
          agent.capabilities({}),
        );
        await setComputeStatus(this.deps.db, compute.id, 'online', {
          version: info.version,
          capabilities,
        });
        this.state.lastSuccess.set(compute.id, Date.now());
        const snapshot = await this.deps.agents.call(compute.id, (agent) => agent.state({}));
        await reconcileState(this.deps.db, compute.id, snapshot.nodes, snapshot.links);
      } catch (error) {
        await setComputeStatus(this.deps.db, compute.id, 'offline');
        this.deps.logger.warn('compute unreachable at startup', {
          computeId: compute.id,
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** Mark nodes/links missing from the agent as stopped/pending. */
export async function reconcileState(
  db: SQL,
  computeId: string,
  nodes: { nodeId: string; status: string; pid: number | null }[],
  links: { linkId: string; status: string }[],
): Promise<void> {
  const liveNodes = new Map(nodes.map((node) => [node.nodeId, node.status]));
  const liveLinks = new Map(links.map((link) => [link.linkId, link.status]));

  const dbNodes = await db.unsafe<{ id: string; status: string }[]>(
    'SELECT id, status FROM nodes WHERE compute_id = $1',
    [computeId],
  );
  for (const node of dbNodes) {
    const live = liveNodes.get(node.id);
    if (live === undefined && node.status !== 'stopped') {
      await db.unsafe(`UPDATE nodes SET status = 'stopped', updated_at = now() WHERE id = $1`, [
        node.id,
      ]);
    } else if (live !== undefined && live !== node.status) {
      await db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        node.id,
        live,
      ]);
    }
  }

  const dbLinks = await db.unsafe<{ id: string; status: string }[]>(
    `SELECT l.id, l.status FROM links l
       JOIN nodes n ON n.id = l.node_a_id
      WHERE n.compute_id = $1`,
    [computeId],
  );
  for (const link of dbLinks) {
    const live = liveLinks.get(link.id);
    if (live === undefined && link.status !== 'pending') {
      await db.unsafe(`UPDATE links SET status = 'pending', updated_at = now() WHERE id = $1`, [
        link.id,
      ]);
    } else if (live !== undefined && live !== link.status) {
      await db.unsafe('UPDATE links SET status = $2, updated_at = now() WHERE id = $1', [
        link.id,
        live,
      ]);
    }
  }
}
