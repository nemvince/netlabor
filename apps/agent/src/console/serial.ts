/** Persistent serial bridge with scrollback for QEMU/raw serial consoles. */

import { AppError } from '@netlabor/contract';
import type { Socket } from 'bun';

interface SerialHub {
  server: { stop(force?: boolean): void };
  upstream: Socket<unknown> | null;
  clients: Set<Socket<unknown>>;
  chunks: Uint8Array[];
  bytes: number;
  transcript: string;
  closed: boolean;
}

const hubs = new Map<string, SerialHub>();
const BUFFER_LIMIT = 256 * 1024;
const TRANSCRIPT_LIMIT = 200_000;

export async function openSerialConsole(target: {
  nodeId: string;
  externalPort: number;
  projectIp: string;
  internalPort: number;
}): Promise<void> {
  await closeSerialConsole(target.nodeId);
  const clients = new Set<Socket<unknown>>();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let transcript = '';
  const hub: SerialHub = {
    server: { stop: () => undefined },
    upstream: null,
    clients,
    chunks,
    bytes,
    transcript,
    closed: false,
  };

  const broadcast = (data: Uint8Array) => {
    if (data.length === 0) return;
    const copy = data.slice();
    chunks.push(copy);
    bytes += copy.length;
    while (bytes > BUFFER_LIMIT && chunks.length > 1) {
      bytes -= chunks.shift()?.length ?? 0;
    }
    transcript = (transcript + new TextDecoder().decode(copy)).slice(-TRANSCRIPT_LIMIT);
    hub.transcript = transcript;
    for (const client of clients) {
      try {
        client.write(data);
      } catch {
        clients.delete(client);
      }
    }
  };

  const connect = async (): Promise<void> => {
    if (hub.closed) return;
    try {
      hub.upstream = (await Bun.connect({
        hostname: target.projectIp,
        port: target.internalPort,
        socket: {
          data(_socket, data) {
            broadcast(new Uint8Array(data));
          },
          close() {
            hub.upstream = null;
            if (!hub.closed) setTimeout(() => void connect(), 500);
          },
          error() {
            hub.upstream = null;
          },
        },
      })) as unknown as Socket<unknown>;
    } catch {
      if (!hub.closed) setTimeout(() => void connect(), 500);
    }
  };
  await connect();

  const server = Bun.listen({
    hostname: '0.0.0.0',
    port: target.externalPort,
    socket: {
      open(client) {
        clients.add(client);
        for (const chunk of chunks) {
          try {
            client.write(chunk);
          } catch {
            break;
          }
        }
      },
      data(client, data) {
        const upstream = hub.upstream;
        if (upstream) {
          try {
            upstream.write(data);
          } catch {
            clients.delete(client);
          }
        }
      },
      close(client) {
        clients.delete(client);
      },
      error(client) {
        clients.delete(client);
      },
    },
  });
  hub.server = server;
  hubs.set(target.nodeId, hub);
}

export function closeSerialConsole(nodeId: string): void {
  const hub = hubs.get(nodeId);
  if (!hub) return;
  hubs.delete(nodeId);
  hub.closed = true;
  hub.server.stop(true);
  for (const client of hub.clients) {
    try {
      client.end();
    } catch {
      // already closed
    }
  }
  hub.clients.clear();
  try {
    hub.upstream?.end();
  } catch {
    // already closed
  }
}

/** Execute commands through the buffered serial console (faults, MCP). */
export async function serialExec(
  nodeId: string,
  commands: string[],
  timeoutMs: number,
  prompt: RegExp,
): Promise<{ transcript: string; ok: boolean; timedOut: boolean }> {
  const hub = hubs.get(nodeId);
  if (!hub) throw new AppError('BAD_REQUEST', 'node has no serial console');
  const start = hub.transcript.length;
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  for (const command of commands) {
    const encoded = new TextEncoder().encode(`${command}\r\n`);
    try {
      hub.upstream?.write(encoded);
    } catch {
      break;
    }
  }
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (prompt.test(hub.transcript.slice(start)) || Date.now() > deadline) {
        clearInterval(timer);
        resolve();
      }
    }, 120);
  });
  const transcript = hub.transcript.slice(start);
  return { transcript, ok: prompt.test(transcript), timedOut: !prompt.test(transcript) };
}
