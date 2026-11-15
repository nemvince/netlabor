/** Agent entrypoint: authenticated oRPC over Bun.serve. */

import { timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import { createLogger } from '@netlabor/shared';
import { ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { probeCapabilities } from './capabilities.ts';
import { loadAgentConfig } from './config.ts';
import { archiveProject, restoreProject } from './dataplane/archive.ts';
import { capturePathFor } from './dataplane/capture.ts';
import { registerBuiltinAdapters } from './emulators/builtin.ts';
import { registerDockerAdapter } from './emulators/docker.ts';
import { registerDynamipsAdapter } from './emulators/dynamips.ts';
import { registerDynamipsSwitchAdapters } from './emulators/dynamips-switch.ts';
import { registerIouAdapter } from './emulators/iou.ts';
import { registerQemuAdapter } from './emulators/qemu.ts';
import { registerVpcsAdapter } from './emulators/vpcs.ts';
import { AgentEvents } from './events.ts';
import { MarkerWatcher } from './markers/watcher.ts';
import { renderAgentMetrics } from './metrics.ts';
import { installNftRules } from './netns/netns.ts';
import { createAgentRouter, startupCleanup } from './router.ts';
import { ProjectRegistry } from './state.ts';
import { blobFile } from './storage/images.ts';
import { chownForEmulator } from './sys.ts';
import { SharkdPool } from './wireshark/sharkd.ts';
import { type WiresharkWsData, wiresharkWebsocketHandlers } from './wireshark/ws.ts';

const config = loadAgentConfig();
const logger = createLogger({ service: 'agent', level: config.logLevel, pretty: false });
const startedAt = new Date().toISOString();

const capabilities = await probeCapabilities(config);
logger.info('agent capabilities', { ...capabilities });

await mkdir(config.stateDir, { recursive: true, mode: 0o755 });
// 0711: emulators traverse the run dir for their sockets; they never list it.
await mkdir(config.runDir, { recursive: true, mode: 0o711 });
await chmod(config.runDir, 0o711);
await mkdir(path.join(config.runDir, 'emulators'), { recursive: true, mode: 0o750 });
await chownForEmulator(
  path.join(config.runDir, 'emulators'),
  config.emulatorUid,
  config.emulatorGid,
);
await mkdir(config.imageDir, { recursive: true, mode: 0o755 });

// One agent owns a run dir. A second one would tear down the first one's
// namespaces and emulators during startup cleanup.
const lockPath = path.join(config.runDir, 'agent.pid');
try {
  const running = Number((await readFile(lockPath, 'utf8')).trim());
  if (Number.isInteger(running) && running > 0 && running !== process.pid) {
    try {
      process.kill(running, 0);
      logger.error('another agent is already running for this run dir', {
        pid: running,
        runDir: config.runDir,
      });
      process.exit(1);
    } catch {
      // stale lock from a crashed agent
    }
  }
} catch {
  // no lock yet
}
await writeFile(lockPath, String(process.pid), { mode: 0o600 });
process.on('exit', () => {
  try {
    rmSync(lockPath, { force: true });
  } catch {
    // already gone
  }
});

await startupCleanup(config, logger);

// Rebuild the isolation table on every boot so an upgrade repairs rules left by
// an older agent instead of waiting for the next project realize.
await installNftRules(config.underlayInterface).catch((error: unknown) => {
  logger.warn('nftables rules not installed', {
    err: error instanceof Error ? error.message : String(error),
  });
});

registerVpcsAdapter();
registerBuiltinAdapters();
registerQemuAdapter();
registerDockerAdapter();
registerIouAdapter();
registerDynamipsAdapter();
registerDynamipsSwitchAdapters();

const registry = new ProjectRegistry(config);
const events = new AgentEvents();
const markerWatcher = new MarkerWatcher(logger, (hit) => {
  events.emit({
    type: 'agent.marker.hit',
    projectId: hit.projectId,
    linkId: hit.linkId,
    payload: {
      projectId: hit.projectId,
      linkId: hit.linkId,
      name: hit.name,
      tag: hit.tag,
      direction: hit.direction,
      length: hit.length,
      ts: hit.timestampMs / 1000,
    },
  });
});
markerWatcher.start();
const sharkdPool = new SharkdPool({
  binary: 'sharkd',
  maxSessions: config.maxSharkdSessions,
  logger,
});
const wiresharkSockets = wiresharkWebsocketHandlers({ config, pool: sharkdPool, logger });
const context = {
  config,
  registry,
  events,
  markers: markerWatcher,
  logger,
  startedAt,
  capabilities,
  onCaptureStopped: (projectId: string, linkId: string) => sharkdPool.closeLink(projectId, linkId),
};
const router = createAgentRouter(context);
const rpcHandler = new RPCHandler(router, {
  interceptors: [
    async (options) => {
      try {
        return await options.next();
      } catch (error) {
        if (error instanceof AppError) {
          logger.debug('agent rpc rejected', { code: error.code, message: error.message });
          throw toOrpcError(error);
        }
        logger.error('agent rpc failed', { err: error });
        throw error;
      }
    },
  ],
});

/** Map application errors onto oRPC codes with the app code in `data`. */
function toOrpcError(error: AppError): ORPCError<string, Record<string, unknown>> {
  const code = ERROR_STATUS_TO_ORPC[error.code];
  return new ORPCError(code, {
    message: error.message,
    data: {
      appCode: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
      retryable: error.retryable,
    },
  });
}

const ERROR_STATUS_TO_ORPC: Record<AppError['code'], ConstructorParameters<typeof ORPCError>[0]> = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  AGENT_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  AGENT_ERROR: 'BAD_GATEWAY',
  NODE_BUSY: 'CONFLICT',
  NODE_NOT_RUNNING: 'CONFLICT',
  IMAGE_MISSING: 'UNPROCESSABLE_CONTENT',
  BINARY_MISSING: 'UNPROCESSABLE_CONTENT',
  LICENSE_MISSING: 'UNPROCESSABLE_CONTENT',
  CAPABILITY_UNSUPPORTED: 'NOT_IMPLEMENTED',
  JOB_FAILED: 'INTERNAL_SERVER_ERROR',
  INTERNAL: 'INTERNAL_SERVER_ERROR',
};

function tokenMatches(provided: string | null): boolean {
  if (!provided?.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(provided.slice('Bearer '.length).trim());
  const expected = Buffer.from(config.token);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const server = Bun.serve<WiresharkWsData, never>({
  hostname: config.listen.hostname,
  port: config.listen.port,
  // Image replication answers only once the bytes are on disk, which outlasts
  // Bun's 255 s idle cap on slow links. WebSockets keep their own timeout.
  idleTimeout: 0,
  websocket: {
    open: wiresharkSockets.open,
    message: wiresharkSockets.message,
    close: wiresharkSockets.close,
    maxPayloadLength: 4 * 1024 * 1024,
    idleTimeout: 120,
  },
  ...(config.tlsCert && config.tlsKey
    ? { tls: { cert: Bun.file(config.tlsCert), key: Bun.file(config.tlsKey) } }
    : {}),
  async fetch(
    request: Request,
    bunServer: Bun.Server<WiresharkWsData>,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);

    if (url.pathname === '/agent/ws/wireshark') {
      if (!tokenMatches(request.headers.get('authorization'))) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'agent token required' },
          { status: 401 },
        );
      }
      const projectId = url.searchParams.get('projectId');
      const linkId = url.searchParams.get('linkId');
      if (!projectId || !linkId)
        return Response.json({ code: 'BAD_REQUEST', message: 'link required' }, { status: 400 });
      const upgraded = bunServer.upgrade(request, {
        data: { projectId, linkId, session: null, watcher: null, reloadTimer: null, lastSize: 0 },
      });
      return upgraded
        ? undefined
        : Response.json({ code: 'BAD_REQUEST', message: 'upgrade required' }, { status: 400 });
    }

    if (url.pathname === '/healthz') return Response.json({ status: 'ok' });
    if (url.pathname === '/metrics') {
      return new Response(await renderAgentMetrics(registry, sharkdPool), {
        headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
      });
    }
    if (url.pathname === '/version') {
      return Response.json({ version: config.version, apiVersion: '1' });
    }

    const captureMatch =
      /^\/agent\/projects\/([0-9a-fA-F-]{36})\/captures\/([0-9a-fA-F-]{36})\.pcap$/.exec(
        url.pathname,
      );
    if (captureMatch?.[1] && captureMatch[2]) {
      if (!tokenMatches(request.headers.get('authorization'))) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'agent token required' },
          { status: 401 },
        );
      }
      const file = Bun.file(capturePathFor(config, captureMatch[1], captureMatch[2]));
      if (!(await file.exists())) return new Response('capture not found', { status: 404 });
      return new Response(file, {
        headers: {
          'content-type': 'application/vnd.tcpdump.pcap',
          'content-length': String(file.size),
        },
      });
    }

    const archiveMatch = /^\/agent\/projects\/([0-9a-fA-F-]{36})\/archive$/.exec(url.pathname);
    if (archiveMatch?.[1]) {
      if (!tokenMatches(request.headers.get('authorization'))) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'agent token required' },
          { status: 401 },
        );
      }
      const projectId = archiveMatch[1];
      if (request.method === 'GET' || request.method === 'HEAD') {
        try {
          const archive = await archiveProject(config, projectId);
          return new Response(
            request.method === 'HEAD' ? null : new Blob([archive.buffer as ArrayBuffer]),
            {
              headers: {
                'content-type': 'application/gzip',
                'content-length': String(archive.byteLength),
                'x-content-type-options': 'nosniff',
              },
            },
          );
        } catch (error) {
          const status = error instanceof AppError ? 404 : 500;
          return Response.json(
            { code: 'NOT_FOUND', message: 'project archive unavailable' },
            { status },
          );
        }
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        try {
          const body = new Uint8Array(await request.arrayBuffer());
          await restoreProject(config, projectId, body);
          return Response.json({ ok: true });
        } catch (error) {
          logger.error('project restore failed', { projectId, err: error });
          return Response.json(
            { code: 'BAD_REQUEST', message: 'invalid archive' },
            { status: 400 },
          );
        }
      }
      return Response.json({ code: 'BAD_REQUEST', message: 'method not allowed' }, { status: 405 });
    }

    const blobMatch = /^\/agent\/blobs\/([0-9a-f]{64})\/([^/]+)$/.exec(url.pathname);
    if (blobMatch?.[1] && blobMatch[2]) {
      if (!tokenMatches(request.headers.get('authorization'))) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'agent token required' },
          { status: 401 },
        );
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return Response.json(
          { code: 'BAD_REQUEST', message: 'method not allowed' },
          { status: 405 },
        );
      }
      let filename: string;
      try {
        filename = decodeURIComponent(blobMatch[2]);
      } catch {
        return Response.json({ code: 'BAD_REQUEST', message: 'invalid filename' }, { status: 400 });
      }
      const blobPath = await blobFile(config, blobMatch[1], filename);
      if (!blobPath) {
        return Response.json({ code: 'NOT_FOUND', message: 'blob not found' }, { status: 404 });
      }
      const file = Bun.file(blobPath);
      return new Response(request.method === 'HEAD' ? null : file, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(file.size),
          'x-content-type-options': 'nosniff',
        },
      });
    }

    if (url.pathname === '/agent/rpc' || url.pathname.startsWith('/agent/')) {
      if (!tokenMatches(request.headers.get('authorization'))) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'agent token required' },
          { status: 401 },
        );
      }
      const { matched, response } = await rpcHandler.handle(request, {
        context,
        prefix: '/agent/rpc',
      });
      if (matched) return response;
    }

    return new Response('not found', { status: 404 });
  },
  error(error) {
    logger.error('agent request failed', { err: error });
    return Response.json({ code: 'INTERNAL', message: 'internal error' }, { status: 500 });
  },
});

logger.info('agent listening', {
  url: `http://${server.hostname}:${server.port}`,
  underlayIndex: config.underlayIndex,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('agent shutting down', { signal });
  await server.stop(true);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
