/** Agent-side event fan-out: status, logs, marker hits, and job progress. */

import type { AgentEvent } from '@netlabor/contract';
import { AsyncQueue } from '@netlabor/shared';

export class AgentEvents {
  private readonly listeners = new Set<(event: AgentEvent) => void>();

  emit(event: Omit<AgentEvent, 'ts'> & { ts?: string }): void {
    const full: AgentEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // a broken subscriber must not break the agent
      }
    }
  }

  async *stream(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>();
    const listener = (event: AgentEvent) => queue.push(event);
    this.listeners.add(listener);
    const cleanup = () => {
      this.listeners.delete(listener);
      queue.close();
    };
    signal?.addEventListener('abort', cleanup, { once: true });
    try {
      while (!signal?.aborted) {
        const next = await queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      cleanup();
    }
  }
}
