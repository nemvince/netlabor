import { describe, expect, test } from 'bun:test';
import type { ControllerConfig } from '../src/config.ts';
import { serveStatic } from '../src/routes/static.ts';

const embedded = { webRoot: null } as ControllerConfig;
const fromDisk = { webRoot: 'apps/web/dist' } as ControllerConfig;

describe('serveStatic', () => {
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
