import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { ControllerConfig } from '../src/config.ts';
import { serveStatic } from '../src/routes/static.ts';

const webDist = path.resolve(import.meta.dir, '../../web/dist');
// Unit tests run before the web bundle is built.
const built = await Bun.file(path.join(webDist, 'index.html')).exists();
const embedded = { webRoot: null } as ControllerConfig;
const fromDisk = { webRoot: webDist } as ControllerConfig;

describe.skipIf(!built)('serveStatic', () => {
  test('serves the embedded index.html when no web root is configured', async () => {
    const response = await serveStatic(new Request('http://x/'), embedded);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toContain('text/html');
  });

  test('serves SPA fallback for unknown app routes', async () => {
    const response = await serveStatic(new Request('http://x/projects/1'), embedded);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toContain('text/html');
  });

  test('serves assets with immutable caching', async () => {
    const index = await (await serveStatic(new Request('http://x/'), embedded))!.text();
    const asset = index.match(/assets\/index-[^"]+\.js/)?.[0];
    expect(asset).toBeDefined();
    const response = await serveStatic(new Request(`http://x/${asset}`), embedded);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toContain('immutable');
  });

  test('serves from the configured web root', async () => {
    const response = await serveStatic(new Request('http://x/'), fromDisk);
    expect(response?.status).toBe(200);
  });

  test('404s a missing asset and rejects traversal', async () => {
    expect((await serveStatic(new Request('http://x/nope.js'), embedded))?.status).toBe(404);
    expect(
      (await serveStatic(new Request('http://x/..%2f..%2fetc%2fpasswd'), embedded))?.status,
    ).toBe(400);
  });
});
