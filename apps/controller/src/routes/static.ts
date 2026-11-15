/** Static asset serving for the built web app with SPA fallback. */

import path from 'node:path';
import { resolveWithin } from '@netlabor/shared';
import type { ControllerConfig } from '../config.ts';

/** Relative web-dist dir embedded into the compiled binary (`compile.assets` in scripts/build.ts). */
declare const NB_WEB_EMBED_DIR: string | undefined;

const EMBED_REL = typeof NB_WEB_EMBED_DIR === 'string' ? NB_WEB_EMBED_DIR : 'apps/web/dist';
// Compiled: a directory asset lives under its basename in the binary's virtual root. From source: the repo dist.
const EMBED_DIR = Bun.isStandaloneExecutable
  ? `${import.meta.dir}/${path.basename(EMBED_REL)}`
  : path.resolve(EMBED_REL);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

const IMMUTABLE = /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg)$/;

export async function serveStatic(
  request: Request,
  config: ControllerConfig,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  // The UI lives in the binary unless NB_WEB_ROOT points at an unpacked copy.
  const root = config.webRoot === null ? EMBED_DIR : path.resolve(config.webRoot);
  const indexPath = path.join(root, 'index.html');
  if (!(await Bun.file(indexPath).exists())) {
    // No built frontend (e.g. unit tests): let the caller 404.
    return null;
  }

  let target: string;
  try {
    target = url.pathname === '/' ? indexPath : resolveWithin(root, url.pathname);
  } catch {
    return new Response('bad path', { status: 400 });
  }

  const file = Bun.file(target);
  if (await file.exists()) {
    const headers = new Headers({
      'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
    });
    if (IMMUTABLE.test(target)) headers.set('cache-control', 'public, max-age=31536000, immutable');
    else if (target.endsWith('.html')) headers.set('cache-control', 'no-cache');
    return new Response(request.method === 'HEAD' ? null : file.stream(), { headers });
  }

  // SPA fallback: unknown non-asset routes render the app shell.
  if (path.extname(url.pathname) === '') {
    return new Response(request.method === 'HEAD' ? null : Bun.file(indexPath).stream(), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }
  return new Response('not found', { status: 404 });
}
