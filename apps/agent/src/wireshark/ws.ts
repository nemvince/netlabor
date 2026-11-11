/** WebSocket bridge for Web Wireshark: one sharkd session per browser tab. */

import { AppError } from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import type { ServerWebSocket } from 'bun';
import type { AgentConfig } from '../config.ts';
import { capturePathFor } from '../dataplane/capture.ts';
import type { SharkdPool, SharkdSession } from './sharkd.ts';

export interface WiresharkWsData {
  projectId: string;
  linkId: string;
  session: SharkdSession | null;
  tail: ReturnType<typeof setInterval> | null;
  lastSize: number;
}

export interface WiresharkWsRuntime {
  config: AgentConfig;
  pool: SharkdPool;
  logger: Logger;
}

interface Envelope {
  op?: string;
  requestId?: number;
  params?: Record<string, unknown>;
}

const OP_METHOD: Record<string, string> = {
  frames: 'frames',
  frame: 'frame',
  check: 'check',
  follow: 'follow',
  complete: 'complete',
  info: 'info',
  status: 'status',
  load: 'load',
};

export function wiresharkWebsocketHandlers(runtime: WiresharkWsRuntime) {
  const open = async (ws: ServerWebSocket<WiresharkWsData>) => {
    const { projectId, linkId } = ws.data;
    try {
      const session = await runtime.pool.open(projectId, linkId);
      ws.data.session = session;
      const pcapPath = capturePathFor(runtime.config, projectId, linkId);
      const info = await session.request('load', { file: pcapPath });
      ws.send(JSON.stringify({ op: 'loaded', result: info }));
      ws.send(
        JSON.stringify({ op: 'status', requestId: 0, result: await session.request('status', {}) }),
      );
      ws.data.lastSize = await Bun.file(pcapPath)
        .stat()
        .then((stat) => stat.size)
        .catch(() => 0);

      // Live tail: reload when the capture file grows.
      ws.data.tail = setInterval(() => {
        void (async () => {
          const size = await Bun.file(pcapPath)
            .stat()
            .then((stat) => stat.size)
            .catch(() => 0);
          if (size <= (ws.data.lastSize ?? 0)) return;
          ws.data.lastSize = size;
          try {
            await session.request('load', { file: pcapPath });
            const status = await session.request('status', {});
            ws.send(JSON.stringify({ op: 'reload', result: status }));
          } catch (error) {
            runtime.logger.debug('sharkd reload failed mid-write', {
              err: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      }, 1000);
      ws.data.tail.unref?.();
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'wireshark session failed';
      ws.send(JSON.stringify({ op: 'error', requestId: 0, error: { message } }));
      ws.close(1011, 'sharkd unavailable');
    }
  };

  const message = async (ws: ServerWebSocket<WiresharkWsData>, raw: string | Buffer) => {
    const session = ws.data.session;
    if (!session) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(
        typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
      ) as Envelope;
    } catch {
      ws.send(JSON.stringify({ op: 'error', requestId: 0, error: { message: 'invalid JSON' } }));
      return;
    }
    const op = envelope.op ?? '';
    const method = OP_METHOD[op];
    if (!method) {
      ws.send(
        JSON.stringify({
          op: 'error',
          requestId: envelope.requestId ?? 0,
          error: { message: `unsupported operation ${op}` },
        }),
      );
      return;
    }
    const params = { ...(envelope.params ?? {}) };
    if (method === 'load' && !params.file) {
      params.file = capturePathFor(runtime.config, ws.data.projectId, ws.data.linkId);
    }
    if (method === 'frames') {
      const status = (await session.request('status', {})) as { frames?: number };
      void status;
    }
    try {
      const result = await session.request(method, params);
      ws.send(JSON.stringify({ op: 'result', requestId: envelope.requestId ?? 0, result }));
    } catch (error) {
      ws.send(
        JSON.stringify({
          op: 'error',
          requestId: envelope.requestId ?? 0,
          error: { message: error instanceof AppError ? error.message : String(error) },
        }),
      );
    }
  };

  const close = (ws: ServerWebSocket<WiresharkWsData>) => {
    if (ws.data.tail) clearInterval(ws.data.tail);
    if (ws.data.session)
      runtime.pool.closeSession(ws.data.projectId, ws.data.linkId, ws.data.session);
    ws.data.session = null;
  };

  return { open, message, close };
}
