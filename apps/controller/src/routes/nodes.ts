/** Node routes: CRUD, power actions, isolation, and files. */

import { AppError, WEB_PROXY_STATUSES, type WebProxyOutput } from '@netlabor/contract';
import { issueTicket } from '@netlabor/shared';
import type { Context } from '../context.ts';
import type { AppDeps, Implementer } from '../implementer.ts';
import {
  createNode,
  deleteNode,
  duplicateNode,
  getNode,
  listNodes,
  setNodePower,
  updateNode,
} from '../services/nodes.ts';

export function nodeRoutes(os: Implementer) {
  return {
    nodes: {
      list: os.nodes.list.handler(async ({ input, context }) =>
        listNodes(context.db, input.projectId),
      ),
      get: os.nodes.get.handler(async ({ input, context }) => getNode(context.db, input.id)),
      create: os.nodes.create.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        try {
          return await createNode(context, user.id, input);
        } catch (error) {
          context.logger.error('nodes.create failed', { err: error });
          throw error;
        }
      }),
      update: os.nodes.update.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return updateNode(context, user.id, {
          id: input.id,
          ...(input.name ? { name: input.name } : {}),
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          ...(input.z !== undefined ? { z: input.z } : {}),
          ...(input.layer !== undefined ? { layer: input.layer } : {}),
          ...(input.locked !== undefined ? { locked: input.locked } : {}),
          ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
          ...(input.properties !== undefined ? { properties: input.properties } : {}),
          ...(input.consoleAutoStart !== undefined
            ? { consoleAutoStart: input.consoleAutoStart }
            : {}),
        });
      }),
      delete: os.nodes.delete.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await deleteNode(context, user.id, input.id);
        return { ok: true as const };
      }),
      duplicate: os.nodes.duplicate.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return duplicateNode(context, user.id, {
          id: input.id,
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          ...(input.name ? { name: input.name } : {}),
        });
      }),
      start: os.nodes.start.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return setNodePower(context, user.id, input.id, 'start');
      }),
      stop: os.nodes.stop.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return setNodePower(context, user.id, input.id, 'stop');
      }),
      suspend: os.nodes.suspend.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return setNodePower(context, user.id, input.id, 'suspend');
      }),
      reload: os.nodes.reload.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return setNodePower(context, user.id, input.id, 'reload');
      }),
      consoleTicket: os.nodes.consoleTicket.handler(async ({ input, context }) => {
        const node = await getNode(context.db, input.id);
        if (node.consolePort === null || node.consoleType === 'none') {
          throw new AppError('BAD_REQUEST', 'node has no console');
        }
        if (node.status !== 'started' && node.status !== 'suspended') {
          throw new AppError('CONFLICT', 'node is not running; start it before opening a console');
        }
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        const ticket = issueTicket(
          {
            sub: user.id,
            purpose: input.purpose === 'vnc' ? 'vnc' : 'console',
            resourceId: node.id,
            projectId: node.projectId,
          },
          context.config.secretKey,
        );
        const compute = await context.db.unsafe<{ url: string }[]>(
          'SELECT url FROM computes WHERE id = $1',
          [node.computeId],
        );
        let consoleHost = '127.0.0.1';
        try {
          consoleHost = new URL(compute[0]?.url ?? '').hostname;
        } catch {
          consoleHost = '127.0.0.1';
        }
        const path = input.purpose === 'vnc' ? 'vnc' : 'console';
        return {
          ticket,
          wsUrl: `/ws/${path}/${node.id}?ticket=${encodeURIComponent(ticket)}`,
          tcp: { host: consoleHost, port: node.consolePort },
          consoleType: node.consoleType,
        };
      }),

      resetConsole: os.nodes.resetConsole.handler(async ({ input, context }) => {
        const node = await getNode(context.db, input.id);
        await context.agents.call(node.computeId, (agent) =>
          agent.resetConsole({ projectId: node.projectId, nodeId: node.id }),
        );
        return { ok: true as const };
      }),

      console: {
        exec: os.nodes.console.exec.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.id);
          const result = await context.agents.call(node.computeId, (agent) =>
            agent.execConsole({
              projectId: node.projectId,
              nodeId: node.id,
              commands: input.commands,
              timeoutMs: input.timeoutMs,
              terminalLengthZero: input.terminalLengthZero,
              prompt: input.prompt ?? null,
            }),
          );
          return result;
        }),
        get: os.nodes.console.get.handler(async ({ input, context }) =>
          proxyConsole(context, input, 'GET'),
        ),
        post: os.nodes.console.post.handler(async ({ input, context }) =>
          proxyConsole(context, input, 'POST'),
        ),
        getRoot: os.nodes.console.getRoot.handler(async ({ input, context }) =>
          proxyConsole(context, input, 'GET'),
        ),
        postRoot: os.nodes.console.postRoot.handler(async ({ input, context }) =>
          proxyConsole(context, input, 'POST'),
        ),
      },

      files: {
        list: os.nodes.files.list.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          return context.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.list({ projectId: node.projectId, nodeId: node.id, path: input.path }),
          );
        }),
        read: os.nodes.files.read.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          return context.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.read({ projectId: node.projectId, nodeId: node.id, path: input.path }),
          );
        }),
        download: os.nodes.files.download.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          const file = await context.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.read({ projectId: node.projectId, nodeId: node.id, path: input.path }),
          );
          const name = input.path.split('/').pop() ?? 'file';
          return new File([file.content], name, { type: 'text/plain; charset=utf-8' });
        }),
        write: os.nodes.files.write.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          if (node.status === 'started') {
            throw new AppError('NODE_BUSY', 'stop the node before editing its files');
          }
          return context.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.write({
              projectId: node.projectId,
              nodeId: node.id,
              path: input.path,
              content: input.content,
            }),
          );
        }),
        delete: os.nodes.files.delete.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          if (node.status === 'started') {
            throw new AppError('NODE_BUSY', 'stop the node before deleting its files');
          }
          await context.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.delete({
              projectId: node.projectId,
              nodeId: node.id,
              path: input.path,
            }),
          );
          return { ok: true as const };
        }),
      },

      qemu: {
        diskImage: {
          create: os.nodes.qemu.diskImage.create.handler(async ({ input, context }) => {
            const node = await getNode(context.db, input.nodeId);
            if (node.nodeType !== 'qemu')
              throw new AppError('BAD_REQUEST', 'node is not a QEMU node');
            if (node.status !== 'stopped') throw new AppError('NODE_BUSY', 'stop the node first');
            const result = await context.agents.call(node.computeId, (agent) =>
              agent.qemu.diskImage.create({
                projectId: node.projectId,
                nodeId: node.id,
                disk: input.disk,
                sizeBytes: input.sizeBytes ?? 512 * 1024 * 1024,
                backingImagePath: null,
              }),
            );
            return { disk: input.disk, path: result.path, sizeBytes: result.sizeBytes };
          }),
          delete: os.nodes.qemu.diskImage.delete.handler(async ({ input, context }) => {
            const node = await getNode(context.db, input.nodeId);
            if (node.status !== 'stopped') throw new AppError('NODE_BUSY', 'stop the node first');
            await context.agents.call(node.computeId, (agent) =>
              agent.qemu.diskImage.delete({
                projectId: node.projectId,
                nodeId: node.id,
                disk: input.disk,
              }),
            );
            return { ok: true as const };
          }),
          resize: os.nodes.qemu.diskImage.resize.handler(async ({ input, context }) => {
            const node = await getNode(context.db, input.nodeId);
            if (node.status !== 'stopped') throw new AppError('NODE_BUSY', 'stop the node first');
            const result = await context.agents.call(node.computeId, (agent) =>
              agent.qemu.diskImage.resize({
                projectId: node.projectId,
                nodeId: node.id,
                disk: input.disk,
                sizeBytes: input.sizeBytes,
              }),
            );
            return { disk: input.disk, path: result.path, sizeBytes: result.sizeBytes };
          }),
        },
      },

      dynamips: {
        idlepc: os.nodes.dynamips.idlepc.handler(async ({ input, context }) => {
          const node = await getNode(context.db, input.nodeId);
          if (node.nodeType !== 'dynamips')
            throw new AppError('BAD_REQUEST', 'node is not a Dynamips node');
          await context.agents.call(node.computeId, (agent) =>
            agent.dynamips.setIdlepc({
              projectId: node.projectId,
              nodeId: node.id,
              idlepc: input.idlepc,
            }),
          );
          await context.db.unsafe(
            `UPDATE nodes SET properties = properties || jsonb_build_object('idlepc', $2::text), updated_at = now() WHERE id = $1`,
            [node.id, input.idlepc],
          );
          return { ok: true as const };
        }),
      },

      isolate: os.nodes.isolate.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await setIsolated(context, user.id, input.id, true);
        return { ok: true as const };
      }),
      unisolate: os.nodes.unisolate.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await setIsolated(context, user.id, input.id, false);
        return { ok: true as const };
      }),
    },
  };
}

async function setIsolated(
  deps: AppDeps,
  userId: string,
  nodeId: string,
  isolated: boolean,
): Promise<void> {
  const node = await getNode(deps.db, nodeId);
  if (node.isolated === isolated) return;
  await deps.db.unsafe('UPDATE nodes SET isolated = $2, updated_at = now() WHERE id = $1', [
    nodeId,
    isolated,
  ]);
  await deps.events.publish({
    type: 'node.updated',
    projectId: node.projectId,
    userId,
    payload: { nodeId, isolated },
  });
}

/** Request headers forwarded to a node web console upstream. */
const CONSOLE_FORWARD_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'range',
  'if-range',
  'if-none-match',
]);

/** Response headers copied back from a node web console upstream. */
const CONSOLE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'location',
  'content-disposition',
  'accept-ranges',
  'content-range',
  'last-modified',
];

interface WebProxyInput {
  params: { nodeId: string; rest?: string };
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
}

function proxyBody(body: unknown, contentType: string | undefined): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }
  if (contentType?.includes('application/x-www-form-urlencoded') && typeof body === 'object') {
    return new URLSearchParams(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    );
  }
  return JSON.stringify(body);
}

/**
 * Reverse-proxy one request to a node's web console. Detailed OpenAPI output
 * lets the upstream status (2xx/3xx) and headers reach the browser unchanged.
 */
async function proxyConsole(
  context: Context,
  input: WebProxyInput,
  method: 'GET' | 'POST',
): Promise<WebProxyOutput> {
  const node = await getNode(context.db, input.params.nodeId);
  if (node.consoleType !== 'http' && node.consoleType !== 'https') {
    throw new AppError('BAD_REQUEST', 'node has no web console');
  }
  if (node.consolePort === null) throw new AppError('CONFLICT', 'console not ready');
  const compute = await context.db.unsafe<{ url: string }[]>(
    'SELECT url FROM computes WHERE id = $1',
    [node.computeId],
  );
  const host = new URL(compute[0]?.url ?? '').hostname;
  const scheme = node.consoleType === 'https' ? 'https' : 'http';
  const search = new URLSearchParams(input.query).toString();
  const rest = input.params.rest ?? '';
  const target = `${scheme}://${host}:${node.consolePort}/${rest}${search ? `?${search}` : ''}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    if (CONSOLE_FORWARD_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  const upstream = await fetch(target, {
    method,
    headers,
    ...(method === 'GET'
      ? {}
      : { body: proxyBody(input.body, input.headers['content-type']) ?? null }),
    redirect: 'manual',
    ...(scheme === 'https' ? ({ tls: { rejectUnauthorized: false } } as never) : {}),
  }).catch(() => null);
  if (!upstream) throw new AppError('AGENT_ERROR', 'console unavailable');
  if (upstream.status >= 400) {
    throw new AppError(
      upstream.status >= 500 ? 'AGENT_ERROR' : 'NOT_FOUND',
      `console returned ${upstream.status}`,
    );
  }
  const responseHeaders: Record<string, string> = {};
  for (const name of CONSOLE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  const status = (WEB_PROXY_STATUSES as readonly number[]).includes(upstream.status)
    ? (upstream.status as (typeof WEB_PROXY_STATUSES)[number])
    : 200;
  return { status, headers: responseHeaders, body: upstream.body };
}
