/** Console listeners: TCP proxies from external ports into the project namespace. */

import { createLogger } from '@netlabor/shared';
import type { Socket } from 'bun';
import { closeSerialConsole } from './serial.ts';
import { TelnetFilter } from './telnet.ts';

const logger = createLogger({ service: 'agent-console' });

interface StoppableListener {
  stop(force?: boolean): void;
  readonly port?: number;
}

interface ConsoleListener {
  server: StoppableListener;
  internalPort: number;
  projectIp: string;
  clients: Set<Socket<unknown>>;
}

const listeners = new Map<string, ConsoleListener>();

function keyOf(nodeId: string): string {
  return nodeId;
}

/** Pick a free ephemeral TCP port inside the requested range. */
export async function pickFreePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    try {
      const server = Bun.listen({
        hostname: '127.0.0.1',
        port,
        socket: { data() {}, open() {}, close() {} },
      });
      server.stop(true);
      return port;
    } catch {}
  }
  throw new Error(`no free internal port between ${start} and ${end}`);
}

export interface ConsoleTarget {
  nodeId: string;
  externalPort: number;
  projectIp: string;
  internalPort: number;
  /** Upstream speaks telnet negotiation (QEMU/VPCS/Dynamips serial). */
  telnet?: boolean;
}

/** Forward an external TCP console port to an emulator inside the netns. */
export async function openConsole(target: ConsoleTarget): Promise<void> {
  await closeConsole(target.nodeId);
  const clients = new Set<Socket<unknown>>();
  // Bytes that arrive before the upstream connection is ready (HTTP requests,
  // terminal paste) must be buffered, not dropped.
  const buffered = new WeakMap<Socket<unknown>, Uint8Array[]>();
  const server = Bun.listen({
    hostname: '0.0.0.0',
    port: target.externalPort,
    socket: {
      async open(client) {
        clients.add(client);
        try {
          const filter = target.telnet ? new TelnetFilter() : null;
          const upstream = await Bun.connect({
            hostname: target.projectIp,
            port: target.internalPort,
            socket: {
              data(socket, data) {
                if (!filter) {
                  client.write(data);
                  return;
                }
                const parsed = filter.feed(new Uint8Array(data));
                if (parsed.replies.length > 0) socket.write(parsed.replies);
                if (parsed.data.length > 0) client.write(parsed.data);
              },
              close() {
                client.end();
              },
              error(_socket, error) {
                logger.warn('console upstream error', {
                  nodeId: target.nodeId,
                  err: String(error),
                });
                client.end();
              },
            },
          });
          const target2 = upstream as unknown as Socket<unknown>;
          consoleSockets.set(client, target2);
          for (const chunk of buffered.get(client) ?? []) target2.write(chunk);
          buffered.delete(client);
        } catch (error) {
          logger.warn('console upstream connect failed', {
            nodeId: target.nodeId,
            err: String(error),
          });
          client.end();
        }
      },
      data(client, data) {
        const upstream = consoleSockets.get(client);
        if (upstream) {
          upstream.write(data);
          return;
        }
        const chunks = buffered.get(client) ?? [];
        chunks.push(new Uint8Array(data));
        buffered.set(client, chunks);
      },
      close(client) {
        clients.delete(client);
        buffered.delete(client);
        consoleSockets.get(client)?.end();
        consoleSockets.delete(client);
      },
      error(client, error) {
        logger.warn('console client error', { nodeId: target.nodeId, err: String(error) });
        consoleSockets.get(client)?.end();
        consoleSockets.delete(client);
      },
    },
  });
  listeners.set(keyOf(target.nodeId), {
    server,
    internalPort: target.internalPort,
    projectIp: target.projectIp,
    clients,
  });
}

const consoleSockets = new WeakMap<Socket<unknown>, Socket<unknown>>();

export async function closeConsole(nodeId: string): Promise<void> {
  closeSerialConsole(nodeId);
  const listener = listeners.get(keyOf(nodeId));
  if (!listener) return;
  listener.server.stop(true);
  for (const client of listener.clients) {
    client.end();
  }
  listeners.delete(keyOf(nodeId));
}

export function consoleListeners(): { nodeId: string; port: number; internalPort: number }[] {
  return [...listeners.entries()].map(([nodeId, listener]) => ({
    nodeId,
    port: listener.server.port ?? 0,
    internalPort: listener.internalPort,
  }));
}

/** Raw TCP byte bridge used by IOU (stdin/stdout) and Dynamips consoles. */
export async function openRawBridge(options: {
  nodeId: string;
  externalPort: number;
  connect: (
    onData: (data: Uint8Array) => void,
    onClose: () => void,
  ) => { write(data: Uint8Array): void; close(): void };
}): Promise<void> {
  await closeConsole(options.nodeId);
  const clients = new Set<Socket<unknown>>();
  const server = Bun.listen({
    hostname: '0.0.0.0',
    port: options.externalPort,
    socket: {
      open(client) {
        clients.add(client);
        const session = options.connect(
          (data) => client.write(data),
          () => client.end(),
        );
        consoleSockets.set(client, session as unknown as Socket<unknown>);
      },
      data(client, data) {
        consoleSockets.get(client)?.write(data);
      },
      close(client) {
        clients.delete(client);
        consoleSockets.get(client)?.end?.();
        consoleSockets.delete(client);
      },
    },
  });
  listeners.set(keyOf(options.nodeId), {
    server,
    internalPort: 0,
    projectIp: '',
    clients,
  });
}
