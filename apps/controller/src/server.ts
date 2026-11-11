/** HTTP server for an initialised controller: oRPC, OIDC, health, static. */

import { AppError } from '@netlabor/contract';
import type { TicketStore } from '@netlabor/shared';
import { RPCHandler } from '@orpc/server/fetch';
import type { Server } from 'bun';
import { createAppRouter } from './app.ts';
import { hasPrivilege, readCookies } from './auth/principal.ts';
import type { ControllerConfig } from './config.ts';
import { isSecureOrigin } from './config.ts';
import { type Context, createRequestContext } from './context.ts';
import { normalizeError } from './errors.ts';
import type { AppDeps } from './implementer.ts';
import { clientKey, LIMITS, limiter } from './limits.ts';
import { handleMcpRequest } from './mcp/server.ts';
import { recordHttpRequest, renderMetrics } from './metrics.ts';
import { docsHtml, openApiDocument } from './openapi.ts';
import { handleAgentBlobHttp, handleImageBlobHttp } from './routes/images.ts';
import { serveStatic } from './routes/static.ts';
import { handleUploadHttp } from './routes/uploads.ts';
import { handleWebSocketUpgrade, type WsData, websocketHandlers } from './routes/websockets.ts';
import { exportPath, snapshotPath } from './services/archives.ts';
import { captureStatus, getLink } from './services/links.ts';
import { getNode } from './services/nodes.ts';
import {
  clearStateCookie,
  handleCallback,
  OIDC_STATE_COOKIE,
  startLogin,
} from './services/oidc.ts';

export interface RunningServer {
  server: Server<WsData>;
  stop(): Promise<void>;
}

export function startServer(deps: AppDeps, tickets: TicketStore): RunningServer {
  const { config, db, logger } = deps;
  const router = createAppRouter(deps);
  const sockets = websocketHandlers({ tickets, deps });

  const rpcHandler = new RPCHandler<Context>(router, {
    interceptors: [
      async (options) => {
        try {
          return await options.next();
        } catch (error) {
          const mapped = normalizeError(error);
          const target = mapped === error ? error : mapped;
          if (error instanceof Error && /validation/i.test(error.message)) {
            logger.error('rpc validation failed', {
              message: error.message,
              details:
                (error as { issues?: unknown; data?: unknown }).issues ??
                (error as { data?: unknown }).data,
            });
          }
          throw target;
        }
      },
    ],
  });

  const server = Bun.serve<WsData, never>({
    hostname: config.listen.hostname,
    port: config.listen.port,
    idleTimeout: 120,
    websocket: {
      open: sockets.open,
      message: sockets.message,
      close: sockets.close,
      maxPayloadLength: 4 * 1024 * 1024,
      idleTimeout: 120,
    },
    ...(config.tlsCert && config.tlsKey
      ? { tls: { cert: Bun.file(config.tlsCert), key: Bun.file(config.tlsKey) } }
      : {}),
    async fetch(request: Request, bunServer: Server<WsData>): Promise<Response | undefined> {
      const url = new URL(request.url);
      recordHttpRequest(request.method, url.pathname);

      if (url.pathname.startsWith('/ws/')) {
        try {
          limiter.consume(clientKey(request, 'ws'), LIMITS.websocket);
        } catch {
          return new Response('too many connections', { status: 429 });
        }
        const upgraded = await handleWebSocketUpgrade(request, bunServer, {
          tickets,
          config,
          deps,
        });
        return upgraded ? undefined : new Response('upgrade required', { status: 400 });
      }

      if (url.pathname === '/healthz') {
        try {
          await db.unsafe('SELECT 1');
          return Response.json({ status: 'ok' });
        } catch (error) {
          logger.error('healthz database check failed', { err: error });
          return Response.json({ status: 'error' }, { status: 503 });
        }
      }

      if (url.pathname === '/api/openapi.json') {
        const document = await openApiDocument(config.version);
        return Response.json(document);
      }
      if (url.pathname === '/api/docs') {
        return new Response(docsHtml(), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          },
        });
      }
      if (url.pathname === '/version') {
        return Response.json({ version: config.version, apiVersion: '1' });
      }
      if (url.pathname === '/metrics') {
        return new Response(await renderMetrics(db), {
          headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
        });
      }

      if (url.pathname === '/rpc/auth/login' && request.method === 'POST') {
        try {
          limiter.consume(clientKey(request, 'login'), LIMITS.login);
        } catch (error) {
          const status = error instanceof AppError ? 429 : 500;
          return Response.json(
            { code: 'TOO_MANY_REQUESTS', message: 'too many login attempts; wait a minute' },
            { status },
          );
        }
      }
      if (url.pathname.startsWith('/api/uploads') && request.method === 'POST') {
        try {
          limiter.consume(clientKey(request, 'upload'), LIMITS.upload);
        } catch {
          return Response.json(
            { code: 'TOO_MANY_REQUESTS', message: 'upload limit reached' },
            { status: 429 },
          );
        }
      }

      if (url.pathname === '/rpc' || url.pathname.startsWith('/rpc/')) {
        const context = await createRequestContext(deps, request);
        const { matched, response } = await rpcHandler.handle(request, { context, prefix: '/rpc' });
        if (matched) {
          for (const [name, value] of context.resHeaders) response.headers.append(name, value);
          return withSecurityHeaders(response, config);
        }
        return new Response('not found', { status: 404 });
      }

      const exportMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/export$/.exec(url.pathname);
      if (exportMatch?.[1] && request.method === 'GET') {
        const context = await createRequestContext(deps, request);
        if (!context.auth.user) return new Response('unauthorized', { status: 401 });
        const file = Bun.file(exportPath(deps, exportMatch[1]));
        if (!(await file.exists())) return new Response('export not ready', { status: 404 });
        return new Response(file, {
          headers: {
            'content-type': 'application/gzip',
            'content-disposition': `attachment; filename="project-${exportMatch[1]}.tar.gz"`,
          },
        });
      }

      const snapshotMatch = /^\/api\/snapshots\/([0-9a-fA-F-]{36})\/download$/.exec(url.pathname);
      if (snapshotMatch?.[1] && request.method === 'GET') {
        const context = await createRequestContext(deps, request);
        if (!context.auth.user) return new Response('unauthorized', { status: 401 });
        const file = Bun.file(snapshotPath(deps, snapshotMatch[1]));
        if (!(await file.exists())) return new Response('snapshot missing', { status: 404 });
        return new Response(file, {
          headers: {
            'content-type': 'application/gzip',
            'content-disposition': `attachment; filename="snapshot-${snapshotMatch[1]}.tar.gz"`,
          },
        });
      }

      const pcapMatch = /^\/api\/links\/([0-9a-fA-F-]{36})\/capture\.pcap$/.exec(url.pathname);
      if (pcapMatch?.[1] && request.method === 'GET') {
        const context = await createRequestContext(deps, request);
        if (!context.auth.user) return new Response('unauthorized', { status: 401 });
        const link = await getLink(context.db, pcapMatch[1]);
        const node = await getNode(context.db, link.nodeAId);
        const status = await captureStatus(context, pcapMatch[1]);
        if (!status.path) return new Response('no capture', { status: 404 });
        const token = await deps.agents.agentToken(node.computeId);
        const compute = await context.db.unsafe<{ url: string }[]>(
          'SELECT url FROM computes WHERE id = $1',
          [node.computeId],
        );
        const upstream = await fetch(
          `${(compute[0]?.url ?? '').replace(/\/$/, '')}/agent/projects/${link.projectId}/captures/${link.id}.pcap`,
          { headers: token ? { authorization: `Bearer ${token}` } : {} },
        ).catch(() => null);
        if (!upstream?.ok) return new Response('capture not available', { status: 404 });
        return new Response(upstream.body, {
          headers: { 'content-type': 'application/vnd.tcpdump.pcap' },
        });
      }

      if (url.pathname === '/mcp') {
        const context = await createRequestContext(deps, request);
        const response = await handleMcpRequest(request, { context, router });
        return withSecurityHeaders(response, config);
      }

      const oidcStart = /^\/auth\/oidc\/([0-9a-fA-F-]{36})\/start$/.exec(url.pathname);
      if (oidcStart?.[1]) {
        try {
          const { redirectUrl, cookie } = await startLogin(db, config, oidcStart[1]);
          return new Response(null, {
            status: 302,
            headers: { location: redirectUrl, 'set-cookie': cookie },
          });
        } catch (error) {
          logger.warn('oidc start failed', { err: error });
          return redirectToLogin(config, 'oidc-unavailable');
        }
      }

      const oidcCallback = /^\/auth\/oidc\/([0-9a-fA-F-]{36})\/callback$/.exec(url.pathname);
      if (oidcCallback?.[1]) {
        const stateCookie =
          readCookies(request.headers.get('cookie')).get(OIDC_STATE_COOKIE) ?? null;
        try {
          const result = await handleCallback(db, config, oidcCallback[1], url, stateCookie);
          const headers = new Headers();
          headers.append('set-cookie', result.sessionCookie);
          headers.append('set-cookie', clearStateCookie());
          headers.set('location', `${config.publicUrl}${result.redirectTo}`);
          return new Response(null, { status: 302, headers });
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'internal error';
          logger.warn('oidc callback failed', { err: error });
          return redirectToLogin(config, message);
        }
      }

      const uploadResponse = await handleUploadHttp(deps, request);
      if (uploadResponse) return withSecurityHeaders(uploadResponse, config);

      const httpConsoleMatch = /^\/api\/nodes\/([0-9a-fA-F-]{36})\/console(?:\/(.*))?$/.exec(
        url.pathname,
      );
      if (httpConsoleMatch?.[1]) {
        const context = await createRequestContext(deps, request);
        if (!context.auth.user) return new Response('unauthorized', { status: 401 });
        try {
          const node = await getNode(context.db, httpConsoleMatch[1]);
          if (!hasPrivilege(context.auth, 'node.console', node.projectId)) {
            return new Response('forbidden', { status: 403 });
          }
          if (node.consoleType !== 'http' && node.consoleType !== 'https') {
            return new Response('node has no web console', { status: 400 });
          }
          if (node.consolePort === null) return new Response('console not ready', { status: 409 });
          const compute = await context.db.unsafe<{ url: string }[]>(
            'SELECT url FROM computes WHERE id = $1',
            [node.computeId],
          );
          const host = new URL(compute[0]?.url ?? '').hostname;
          const rest = httpConsoleMatch[2] ?? '';
          const scheme = node.consoleType === 'https' ? 'https' : 'http';
          const target = `${scheme}://${host}:${node.consolePort}/${rest}${url.search}`;
          const headers = new Headers();
          for (const name of ['accept', 'content-type', 'range', 'if-range', 'if-none-match']) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
          }
          const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
            redirect: 'manual',
            ...(scheme === 'https' ? ({ tls: { rejectUnauthorized: false } } as never) : {}),
          });
          const responseHeaders = new Headers();
          for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'location']) {
            const value = upstream.headers.get(name);
            if (value) responseHeaders.set(name, value);
          }
          return new Response(upstream.body, {
            status: upstream.status,
            headers: responseHeaders,
          });
        } catch (error) {
          logger.warn('http console proxy failed', { nodeId: httpConsoleMatch[1], err: error });
          return new Response('console unavailable', { status: 502 });
        }
      }

      const imageBlobMatch = /^\/api\/blobs\/([0-9a-f]{64})\/([^/]+)$/.exec(url.pathname);
      if (imageBlobMatch?.[1] && imageBlobMatch[2]) {
        return handleImageBlobHttp(deps, request, imageBlobMatch[1], imageBlobMatch[2]);
      }

      const nodeFileMatch = /^\/api\/nodes\/([0-9a-fA-F-]{36})\/files\/(.+)$/.exec(
        url.pathname,
      );
      if (nodeFileMatch?.[1] && nodeFileMatch[2]) {
        const context = await createRequestContext(deps, request);
        if (!context.auth.user) return new Response('unauthorized', { status: 401 });
        try {
          const node = await getNode(context.db, nodeFileMatch[1]);
          if (!hasPrivilege(context.auth, 'node.files', node.projectId)) {
            return new Response('forbidden', { status: 403 });
          }
          const relative = decodeURIComponent(nodeFileMatch[2]);
          const file = await deps.agents.call(node.computeId, (agent) =>
            agent.nodeFiles.read({ projectId: node.projectId, nodeId: node.id, path: relative }),
          );
          return new Response(file.content, {
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'content-disposition': `attachment; filename="${encodeURIComponent(relative.split('/').pop() ?? 'file')}"`,
              'x-content-type-options': 'nosniff',
            },
          });
        } catch (error) {
          const mapped = error instanceof AppError ? error : null;
          if (mapped) {
            return Response.json(mapped.toJSON(), {
              status: mapped.code === 'NOT_FOUND' ? 404 : 400,
            });
          }
          logger.warn('node file download failed', { nodeId: nodeFileMatch[1], err: error });
          return new Response('file unavailable', { status: 502 });
        }
      }

      const blobMatch = /^\/agent\/blobs\/([0-9a-f]{64})\/([^/]+)$/.exec(url.pathname);
      if (blobMatch?.[1] && blobMatch[2]) {
        return handleAgentBlobHttp(deps, request, blobMatch[1], blobMatch[2]);
      }

      const staticResponse = await serveStatic(request, config);
      if (staticResponse) return withSecurityHeaders(staticResponse, config);
      return new Response('not found', { status: 404 });
    },
    error(error) {
      logger.error('unhandled request error', { err: error });
      return Response.json({ code: 'INTERNAL', message: 'internal error' }, { status: 500 });
    },
  });

  return {
    server,
    async stop() {
      await server.stop(true);
    },
  };
}

function redirectToLogin(config: ControllerConfig, reason: string): Response {
  const url = new URL('/login', config.publicUrl);
  url.searchParams.set('error', reason);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

function withSecurityHeaders(response: Response, config: ControllerConfig): Response {
  const headers = new Headers(response.headers);
  headers.set(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'",
  );
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'same-origin');
  headers.set('x-frame-options', 'SAMEORIGIN');
  if (isSecureOrigin(config)) {
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
