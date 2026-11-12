/**
 * WebSocket upgrades: console, VNC, and Wireshark proxying to the compute
 * agent. Browsers never connect to agents directly.
 */

import { AppError } from '@netlabor/contract';
import {
  TicketError,
  type TicketPayload,
  type TicketPurpose,
  type TicketStore,
} from '@netlabor/shared';
import type { Server, ServerWebSocket } from 'bun';
import { hasPrivilege } from '../auth/principal.ts';
import type { ControllerConfig } from '../config.ts';
import { createRequestContext } from '../context.ts';
import type { AppDeps } from '../implementer.ts';
import { wsSessionClosed, wsSessionOpened } from '../metrics.ts';
import { enterProject, leaveProject, touchProject } from '../services/activity.ts';
import { joinCollab, leaveCollab, updateCollab } from '../services/collab.ts';
import { getLink } from '../services/links.ts';
import { getNode } from '../services/nodes.ts';

export interface WsData {
  kind: 'console' | 'vnc' | 'wireshark' | 'collab';
  resourceId: string;
  projectId: string | null;
  telnet: boolean;
  upstream: UpstreamState;
  collabUser?: { id: string; username: string; displayName: string | null };
}

interface UpstreamState {
  socket: { write(data: string | Uint8Array): number; end(): void; flush?(): void } | null;
  closed: boolean;
}

export interface WsHandlers {
  tickets: TicketStore;
  config: ControllerConfig;
  deps: AppDeps;
}

const PURPOSES: Record<string, TicketPurpose> = {
  console: 'console',
  vnc: 'vnc',
  wireshark: 'wireshark',
};

async function upstreamSocket(
  computeUrl: string,
  port: number,
  handlers: { data: (data: Uint8Array) => void; close: () => void },
) {
  const hostname = new URL(computeUrl).hostname;
  return Bun.connect({
    hostname,
    port,
    socket: {
      data(_socket, data) {
        handlers.data(data);
      },
      close() {
        handlers.close();
      },
      error() {
        handlers.close();
      },
      open() {},
    },
  });
}

/** Validate the upgrade request and attach the WS data payload. */
export async function handleWebSocketUpgrade(
  request: Request,
  server: Server<WsData>,
  handlers: WsHandlers,
): Promise<boolean> {
  const url = new URL(request.url);
  const collabMatch = /^\/ws\/collab\/([0-9a-fA-F-]{36})$/.exec(url.pathname);
  if (collabMatch?.[1]) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return false;
    const origin = request.headers.get('origin');
    const expected = new URL(handlers.config.publicUrl).origin;
    if (!origin || origin !== expected) return false;
    const context = await createRequestContext(handlers.deps, request);
    const user = context.auth.user;
    if (!user || !hasPrivilege(context.auth, 'project.read', collabMatch[1])) return false;
    const upgraded = server.upgrade(request, {
      data: {
        kind: 'collab',
        resourceId: collabMatch[1],
        projectId: collabMatch[1],
        telnet: false,
        upstream: { socket: null, closed: false },
        collabUser: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
        },
      },
    });
    return upgraded;
  }
  const match = /^\/ws\/(console|vnc|wireshark)\/([0-9a-fA-F-]{36})$/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return false;
  const kind = match[1] as 'console' | 'vnc' | 'wireshark';
  const resourceId = match[2];
  const ticketParam = url.searchParams.get('ticket');
  if (!ticketParam) return false;

  const cookies = request.headers.get('cookie') ?? '';
  if (!cookies.includes('nb_session=')) return false;

  let payload: TicketPayload;
  try {
    payload = handlers.tickets.verify(ticketParam);
  } catch (error) {
    handlers.deps.logger.warn('websocket ticket rejected', {
      reason: error instanceof TicketError ? error.reason : 'unknown',
    });
    return false;
  }
  if (payload.resourceId !== resourceId) {
    return false;
  }
  if (payload.purpose !== PURPOSES[kind]) {
    return false;
  }

  const upgraded = server.upgrade(request, {
    data: {
      kind,
      resourceId,
      projectId: payload.projectId ?? null,
      telnet: false,
      upstream: { socket: null, closed: false },
    },
  });
  return upgraded;
}

export interface WebsocketRuntime {
  tickets: TicketStore;
  deps: AppDeps;
}

export function websocketHandlers(runtime: WebsocketRuntime) {
  const open = async (ws: ServerWebSocket<WsData>) => {
    const { kind, resourceId } = ws.data;
    wsSessionOpened();
    enterProject(ws.data.projectId);
    try {
      if (kind === 'collab') {
        if (!ws.data.collabUser) throw new AppError('UNAUTHORIZED', 'presence requires a user');
        joinCollab(ws, resourceId, ws.data.collabUser);
        return;
      }
      if (kind === 'console' || kind === 'vnc') {
        const node = await getNode(runtime.deps.db, resourceId);
        if (node.consolePort === null) throw new AppError('BAD_REQUEST', 'node has no console');
        // Only VPCS and Dynamips expose a telnet server upstream. QEMU serial
        // is a raw TCP chardev; IOU is piped; Docker uses exec streams.
        ws.data.telnet =
          kind === 'console' &&
          (node.nodeType === 'vpcs' || node.nodeType === 'dynamips') &&
          node.consoleType === 'telnet';
        const compute = await runtime.deps.db.unsafe<{ url: string }[]>(
          'SELECT url FROM computes WHERE id = $1',
          [node.computeId],
        );
        const computeUrl = compute[0]?.url;
        if (!computeUrl) throw new AppError('NOT_FOUND', 'compute not found');
        const socket = await upstreamSocket(computeUrl, node.consolePort, {
          data: (data) => ws.send(data),
          close: () => ws.close(),
        });
        ws.data.upstream.socket = socket as unknown as UpstreamState['socket'];
        return;
      }

      const link = await getLink(runtime.deps.db, resourceId);
      const node = await getNode(runtime.deps.db, link.nodeAId);
      const compute = await runtime.deps.db.unsafe<{ url: string }[]>(
        'SELECT url FROM computes WHERE id = $1',
        [node.computeId],
      );
      const computeUrl = compute[0]?.url;
      const token = await runtime.deps.agents.agentToken(node.computeId);
      if (!computeUrl || !token) throw new AppError('NOT_FOUND', 'compute not ready');
      const wsUrl = `${computeUrl.replace(/^http/, 'ws')}/agent/ws/wireshark?projectId=${link.projectId}&linkId=${link.id}`;
      const upstream = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${token}` },
      } as never);
      upstream.binaryType = 'arraybuffer';
      upstream.addEventListener('message', (event) => {
        ws.send(event.data as string | ArrayBuffer);
      });
      upstream.addEventListener('close', () => ws.close());
      upstream.addEventListener('error', () => ws.close());
      upstreamSockets.set(ws, upstream);
      await new Promise<void>((resolve) => {
        upstream.addEventListener('open', () => resolve(), { once: true });
        upstream.addEventListener('error', () => resolve(), { once: true });
      });
      ws.data.upstream.socket = null;
    } catch (error) {
      runtime.deps.logger.warn('websocket upstream failed', {
        kind,
        resourceId,
        err: error instanceof Error ? error.message : String(error),
      });
      ws.close(1011, 'upstream unavailable');
    }
  };

  const upstreamSockets = new WeakMap<ServerWebSocket<WsData>, WebSocket>();

  const message = (ws: ServerWebSocket<WsData>, data: string | Buffer) => {
    touchProject(ws.data.projectId);
    if (ws.data.kind === 'collab') {
      updateCollab(ws, data);
      return;
    }
    if (ws.data.kind === 'console' || ws.data.kind === 'vnc') {
      if (typeof data === 'string' && data.startsWith('{') && data.includes('"type":"resize"')) {
        if (ws.data.telnet) {
          try {
            const parsed = JSON.parse(data) as { cols?: number; rows?: number };
            const cols = Math.max(1, Math.min(65_535, Number(parsed.cols ?? 80)));
            const rows = Math.max(1, Math.min(65_535, Number(parsed.rows ?? 24)));
            ws.data.upstream.socket?.write(
              new Uint8Array([
                255,
                250,
                31,
                (cols >> 8) & 255,
                cols & 255,
                (rows >> 8) & 255,
                rows & 255,
                255,
                240,
              ]),
            );
          } catch {
            // malformed control frame: ignore
          }
        }
        return;
      }
    }
    const wsUpstream = upstreamSockets.get(ws);
    if (wsUpstream) {
      wsUpstream.send(typeof data === 'string' ? data : new Uint8Array(data));
      return;
    }
    const upstream = ws.data.upstream.socket;
    if (!upstream) return;
    upstream.write(typeof data === 'string' ? data : new Uint8Array(data));
  };

  const close = (ws: ServerWebSocket<WsData>) => {
    wsSessionClosed();
    if (ws.data.kind === 'collab') {
      leaveCollab(ws);
      leaveProject(ws.data.projectId);
      return;
    }
    leaveProject(ws.data.projectId);
    ws.data.upstream.closed = true;
    const wsUpstream = upstreamSockets.get(ws);
    if (wsUpstream) {
      try {
        wsUpstream.close();
      } catch {
        // already closed
      }
      upstreamSockets.delete(ws);
      return;
    }
    try {
      ws.data.upstream.socket?.end();
    } catch {
      // already gone
    }
  };

  return { open, message, close };
}
