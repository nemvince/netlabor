/** QEMU Machine Protocol client over a UNIX socket (one command per call). */

import { AppError } from '@netlabor/contract';
import type { Socket } from 'bun';

interface QmpMessage {
  QMP?: Record<string, unknown>;
  event?: string;
  return?: unknown;
  error?: { class?: string; desc?: string };
}

export class QmpClient {
  private buffer = '';
  private greeting: QmpMessage | null = null;
  private pending: {
    resolve: (value: QmpMessage) => void;
    reject: (error: unknown) => void;
  } | null = null;

  private constructor(private readonly socket: Socket<unknown>) {}

  static async connect(socketPath: string, timeoutMs = 5_000): Promise<QmpClient> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        let client: QmpClient | null = null;
        const socket = await Bun.connect({
          unix: socketPath,
          socket: {
            data: (_socket, data) => client?.onData(new TextDecoder().decode(data)),
            open() {},
            close() {},
            error: (_socket, error) => client?.onError(error),
          },
        });
        client = new QmpClient(socket as unknown as Socket<unknown>);
        await client.waitGreeting(timeoutMs);
        // QMP requires capabilities negotiation before any command.
        await client.execute('qmp_capabilities');
        return client;
      } catch (error) {
        lastError = error;
        await Bun.sleep(100);
      }
    }
    throw new AppError('AGENT_ERROR', `QMP socket ${socketPath} did not become ready`, {
      details: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }

  private async waitGreeting(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.greeting) return;
      await Bun.sleep(25);
    }
    throw new AppError('AGENT_ERROR', 'QEMU did not send a QMP greeting');
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (!line) continue;
      let message: QmpMessage;
      try {
        message = JSON.parse(line) as QmpMessage;
      } catch {
        continue;
      }
      if (message.QMP) {
        this.greeting = message;
        continue;
      }
      if (this.pending && (message.return !== undefined || message.error)) {
        const pending = this.pending;
        this.pending = null;
        pending.resolve(message);
      }
    }
  }

  private onError(error: unknown): void {
    this.pending?.reject(error);
    this.pending = null;
  }

  /** Run one QMP command and return its `return` payload. */
  async execute(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers<QmpMessage>();
    this.pending = { resolve, reject };
    this.socket.write(
      `${JSON.stringify({ execute: command, ...(args ? { arguments: args } : {}) })}\n`,
    );
    const timer = setTimeout(() => {
      if (this.pending) {
        this.pending = null;
        reject(new AppError('AGENT_ERROR', `QMP command timed out: ${command}`));
      }
    }, 10_000);
    try {
      const message = await promise;
      if (message.error) {
        throw new AppError('AGENT_ERROR', `QMP ${command} failed`, {
          details: message.error.desc ?? message.error.class ?? 'unknown',
        });
      }
      return message.return;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    try {
      this.socket.end();
    } catch {
      // already closed
    }
  }
}
