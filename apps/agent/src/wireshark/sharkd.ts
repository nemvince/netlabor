/** sharkd sessions: JSON-RPC over stdin/stdout, one process per viewer. */

import { AppError } from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';

export interface SharkdSessionOptions {
  binary: string;
  maxSessions: number;
  logger: Logger;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class SharkdSession {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  private readonly stdout: ReadableStream<Uint8Array>;
  private readonly stdin: { write(data: string): unknown };

  private constructor(
    proc: ReturnType<typeof Bun.spawn>,
    private readonly logger: Logger,
  ) {
    this.stdout = proc.stdout as unknown as ReadableStream<Uint8Array>;
    this.stdin = proc.stdin as unknown as { write(data: string): unknown };
    this.proc = proc;
    void this.readLoop();
  }

  private readonly proc: ReturnType<typeof Bun.spawn>;

  static async start(binary: string, logger: Logger): Promise<SharkdSession> {
    const proc = Bun.spawn([binary, '-'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const session = new SharkdSession(proc, logger);
    // sharkd expects an initial handshake request; ignore its payload.
    await session.request('load', { file: '' }).catch(() => undefined);
    return session;
  }

  private async readLoop(): Promise<void> {
    const reader = this.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf('\n');
        if (!line) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
          if (typeof message.id === 'number') {
            const pending = this.pending.get(message.id);
            if (pending) {
              this.pending.delete(message.id);
              if (message.error) {
                pending.reject(
                  new AppError('BAD_REQUEST', 'sharkd request failed', { details: message.error }),
                );
              } else {
                pending.resolve(message.result);
              }
            }
          }
        } catch {
          this.logger.debug('sharkd emitted non-JSON output', { line });
        }
      }
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new AppError('AGENT_ERROR', 'sharkd exited'));
    }
    this.pending.clear();
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) throw new AppError('AGENT_ERROR', 'sharkd session is closed');
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
      if (this.pending.delete(id))
        reject(new AppError('AGENT_ERROR', `sharkd ${method} timed out`));
    }, 30_000);
    try {
      this.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return await promise;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'bye', params: {} })}\n`,
      );
    } catch {
      // ignore
    }
    this.proc.kill('SIGTERM');
  }
}

export class SharkdPool {
  private readonly sessions = new Map<string, Set<SharkdSession>>();
  readonly binary: string | null;

  constructor(private readonly options: SharkdSessionOptions) {
    this.binary = Bun.which(options.binary) ?? Bun.which('sharkd');
  }

  available(): boolean {
    return this.binary !== null;
  }

  count(): number {
    let total = 0;
    for (const set of this.sessions.values()) total += set.size;
    return total;
  }

  private key(projectId: string, linkId: string): string {
    return `${projectId}:${linkId}`;
  }

  private projectCount(projectId: string): number {
    let total = 0;
    for (const [key, set] of this.sessions) {
      if (key.startsWith(`${projectId}:`)) total += set.size;
    }
    return total;
  }

  async open(projectId: string, linkId: string): Promise<SharkdSession> {
    if (!this.binary) throw new AppError('CAPABILITY_UNSUPPORTED', 'sharkd is not installed');
    if (this.count() >= this.options.maxSessions) {
      throw new AppError('TOO_MANY_REQUESTS', 'sharkd session limit reached');
    }
    if (this.projectCount(projectId) >= 4) {
      throw new AppError('TOO_MANY_REQUESTS', 'project Wireshark limit reached (4 viewers)');
    }
    const session = await SharkdSession.start(this.binary, this.options.logger);
    const key = this.key(projectId, linkId);
    const set = this.sessions.get(key) ?? new Set();
    set.add(session);
    this.sessions.set(key, set);
    return session;
  }

  closeSession(projectId: string, linkId: string, session: SharkdSession): void {
    session.close();
    const key = this.key(projectId, linkId);
    const set = this.sessions.get(key);
    set?.delete(session);
    if (set && set.size === 0) this.sessions.delete(key);
  }

  closeLink(projectId: string, linkId: string): void {
    const key = this.key(projectId, linkId);
    const set = this.sessions.get(key);
    if (!set) return;
    for (const session of set) session.close();
    this.sessions.delete(key);
  }
}
