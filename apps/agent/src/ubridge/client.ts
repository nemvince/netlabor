/**
 * ubridge hypervisor client. Protocol: one command per line; responses are
 * `<code>-<text>\r\n` lines; a response ends at code 100 (success) or >= 200
 * (error). Codes 101..199 are intermediate lines.
 */

import { AppError } from '@netlabor/contract';
import type { Socket } from 'bun';

export class UbridgeError extends Error {
  constructor(
    readonly command: string,
    readonly code: number,
    readonly payload: string[],
  ) {
    super(`ubridge ${command} failed (${code}): ${payload.join(' | ')}`);
    this.name = 'UbridgeError';
  }
}

interface ParsedLine {
  code: number;
  text: string;
}

function parseLine(raw: string): ParsedLine | null {
  const match = /^(\d{3})-(.*)$/.exec(raw.replace(/\r$/, ''));
  if (!match) return null;
  return { code: Number(match[1]), text: match[2] ?? '' };
}

interface PendingCommand {
  command: string;
  lines: ParsedLine[];
  resolve: (lines: string[]) => void;
  reject: (error: unknown) => void;
}

export class UbridgeClient {
  private buffer = '';
  private current: PendingCommand | null = null;
  private readonly queue: PendingCommand[] = [];
  private closed = false;
  private static readonly instances = new Map<string, UbridgeClient>();

  private constructor(
    private readonly socket: Socket<unknown>,
    readonly socketPath: string,
  ) {}

  /** Connect to a freshly started ubridge control socket, retrying briefly. */
  static async connect(socketPath: string, timeoutMs = 5_000): Promise<UbridgeClient> {
    const existing = UbridgeClient.instances.get(socketPath);
    if (existing && !existing.closed) return existing;

    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        let client: UbridgeClient | null = null;
        const socket = await Bun.connect({
          unix: socketPath,
          socket: {
            data: (_socket, data) => client?.onData(new TextDecoder().decode(data)),
            close: () => client?.onClose(),
            error: (_socket, error) => client?.onError(error),
          },
        });
        client = new UbridgeClient(socket as unknown as Socket<unknown>, socketPath);
        UbridgeClient.instances.set(socketPath, client);
        return client;
      } catch (error) {
        lastError = error;
        await Bun.sleep(100);
      }
    }
    throw new AppError('AGENT_ERROR', `ubridge socket ${socketPath} did not appear`, {
      details: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }

  static forSocket(socketPath: string): UbridgeClient | null {
    return UbridgeClient.instances.get(socketPath) ?? null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const raw = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const parsed = parseLine(raw);
      if (parsed && this.current) {
        this.current.lines.push(parsed);
        if (parsed.code === 100 || parsed.code >= 200) this.finish(parsed.code);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private finish(code: number): void {
    const pending = this.current;
    if (!pending) return;
    this.current = null;
    if (code >= 200) {
      pending.reject(
        new UbridgeError(
          pending.command,
          code,
          pending.lines.map((line) => line.text),
        ),
      );
    } else {
      pending.resolve(pending.lines.map((line) => line.text));
    }
    this.drain();
  }

  private onClose(): void {
    this.closed = true;
    UbridgeClient.instances.delete(this.socketPath);
    this.current?.reject(new AppError('AGENT_ERROR', 'ubridge connection closed'));
    this.current = null;
  }

  private onError(error: unknown): void {
    this.current?.reject(error);
    this.current = null;
  }

  private drain(): void {
    if (this.current || this.closed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.socket.write(`${next.command}\n`);
  }

  /** Send one command and resolve with its response text lines. */
  send(command: string, timeoutMs = 30_000): Promise<string[]> {
    if (this.closed)
      return Promise.reject(new AppError('AGENT_ERROR', 'ubridge connection closed'));
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const pending: PendingCommand = {
      command,
      lines: [],
      resolve: (lines) => {
        clearTimeout(timer);
        resolve(lines);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      if (this.current === pending) {
        this.current = null;
        pending.reject(new AppError('AGENT_ERROR', `ubridge command timed out: ${command}`));
        this.drain();
      }
    }, timeoutMs);
    this.queue.push(pending);
    this.drain();
    return promise;
  }

  close(): void {
    UbridgeClient.instances.delete(this.socketPath);
    try {
      this.socket.end();
    } catch {
      // already gone
    }
  }
}

export async function ubridgeVersion(client: UbridgeClient): Promise<string> {
  const lines = await client.send('hypervisor version');
  return lines[0] ?? 'unknown';
}

export async function ubridgeBridgeList(client: UbridgeClient): Promise<string[]> {
  return client.send('bridge list');
}

export async function ubridgeCommand(client: UbridgeClient, command: string): Promise<string[]> {
  return client.send(command);
}
