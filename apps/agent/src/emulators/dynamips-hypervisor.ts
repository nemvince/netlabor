/** Dynamips hypervisor client: line-based commands over TCP. */

import { AppError } from '@netlabor/contract';
import type { Socket } from 'bun';

export class HypervisorClient {
  private buffer = '';
  private pending: { resolve: (lines: string[]) => void; reject: (error: unknown) => void } | null =
    null;
  private closed = false;

  private constructor(private readonly socket: Socket<unknown>) {}

  static async connect(host: string, port: number, timeoutMs = 5_000): Promise<HypervisorClient> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        let client: HypervisorClient | null = null;
        const socket = await Bun.connect({
          hostname: host,
          port,
          socket: {
            data: (_socket, data) => client?.onData(new TextDecoder().decode(data)),
            close: () => client?.onClose(),
            error: (_socket, error) => client?.onError(error),
            open() {},
          },
        });
        client = new HypervisorClient(socket as unknown as Socket<unknown>);
        return client;
      } catch (error) {
        lastError = error;
        await Bun.sleep(100);
      }
    }
    throw new AppError(
      'AGENT_ERROR',
      `dynamips hypervisor did not accept connections on ${host}:${port}`,
      {
        details: lastError instanceof Error ? lastError.message : String(lastError),
      },
    );
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      const pending = this.pending;
      if (!pending) continue;
      if (/^100-/.test(line) || /^2\d\d-/.test(line)) {
        this.pending = null;
        if (/^2\d\d-/.test(line)) pending.reject(new AppError('AGENT_ERROR', `dynamips: ${line}`));
        else pending.resolve([line]);
      }
    }
  }

  private onClose(): void {
    this.closed = true;
    this.pending?.reject(new AppError('AGENT_ERROR', 'dynamips hypervisor closed the connection'));
    this.pending = null;
  }

  private onError(error: unknown): void {
    this.pending?.reject(error);
    this.pending = null;
  }

  async send(command: string, timeoutMs = 30_000): Promise<string[]> {
    if (this.closed) throw new AppError('AGENT_ERROR', 'dynamips hypervisor is closed');
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    this.pending = { resolve, reject };
    this.socket.write(`${command}\n`);
    const timer = setTimeout(() => {
      if (this.pending) {
        this.pending = null;
        reject(new AppError('AGENT_ERROR', `dynamips command timed out: ${command}`));
      }
    }, timeoutMs);
    try {
      return await promise;
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
