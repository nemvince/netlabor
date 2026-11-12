/** HTTP server for an initialised controller: oRPC, OIDC, health, static. */

import { AppError } from '@netlabor/contract';
import type { TicketStore } from '@netlabor/shared';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { RPCHandler } from '@orpc/server/fetch';
import type {
  StandardHandleResult,
  StandardHandlerInterceptorOptions,
} from '@orpc/server/standard';
import type { Server } from 'bun';
import { createAppRouter } from './app.ts';
import { readCookies } from './auth/principal.ts';
import type { ControllerConfig } from './config.ts';
import { isSecureOrigin } from './config.ts';
import { type Context, createRequestContext } from './context.ts';
import { normalizeError } from './errors.ts';
import type { AppDeps } from './implementer.ts';
import { clientKey, LIMITS, limiter } from './limits.ts';
import { handleMcpRequest } from './mcp/server.ts';
import { recordHttpRequest, renderMetrics } from './metrics.ts';
import { apiSpecInfo, zodConverter } from './openapi.ts';
import { handleAgentBlobHttp } from './routes/images.ts';
import { serveStatic } from './routes/static.ts';
import { handleWebSocketUpgrade, type WsData, websocketHandlers } from './routes/websockets.ts';
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

  // Map controller errors (AppError) onto ORPCError codes for both transports.
  const errorInterceptor = async (
    options: StandardHandlerInterceptorOptions<Context> & {
      next: () => Promise<StandardHandleResult>;
    },
  ): Promise<StandardHandleResult> => {
    try {
      return await options.next();
    } catch (error) {
      const mapped = normalizeError(error);
      const target = mapped === error ? error : mapped;
      if (error instanceof Error && /validation/i.test(error.message)) {
        logger.error('api validation failed', {
          message: error.message,
          details:
            (error as { issues?: unknown; data?: unknown }).issues ??
            (error as { data?: unknown }).data,
        });
      }
      throw target;
    }
  };

  const rpcHandler = new RPCHandler<Context>(router, {
    interceptors: [errorInterceptor],
  });

  // Same contract, REST/OpenAPI transport: every procedure with a `route` is
  // reachable from `/api`, and the reference UI is served from `/api/docs`.
  const openApiHandler = new OpenAPIHandler<Context>(router, {
    interceptors: [errorInterceptor],
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [zodConverter],
        specGenerateOptions: apiSpecInfo(config.version),
        specPath: '/openapi.json',
        docsPath: '/docs',
        docsTitle: 'Netlabor controller API',
      }),
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
      if (
        (url.pathname === '/api/uploads' || url.pathname === '/rpc/uploads/start') &&
        request.method === 'POST'
      ) {
        try {
          limiter.consume(clientKey(request, 'upload'), LIMITS.upload);
        } catch {
          return Response.json(
            { code: 'TOO_MANY_REQUESTS', message: 'upload limit reached' },
            { status: 429 },
          );
        }
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const context = await createRequestContext(deps, request);
        const { matched, response } = await openApiHandler.handle(request, {
          context,
          prefix: '/api',
        });
        if (matched) {
          for (const [name, value] of context.resHeaders) response.headers.append(name, value);
          return response;
        }
        return new Response('not found', { status: 404 });
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
