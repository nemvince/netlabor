import { describe, expect, test } from 'bun:test';
import type { ControllerConfig } from '../src/config.ts';
import { serveStatic } from '../src/routes/static.ts';

const config = { webRoot: '/nonexistent/netlabor-web' } as ControllerConfig;

describe('serveStatic with an embedded web dist', () => {
  test('serves index.html when the webRoot has no index.html', async () => {
    const response = await serveStatic(new Request('http://x/'), config);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toContain('text/html');
  });

  test('serves SPA fallback for unknown app routes', async () => {
    const response = await serveStatic(new Request('http://x/projects/1'), config);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toContain('text/html');
  });

  test('serves embedded assets with immutable caching', async () => {
    const index = await (await serveStatic(new Request('http://x/'), config))!.text();
    const asset = index.match(/assets\/index-[^"]+\.js/)?.[0];
    expect(asset).toBeDefined();
    const response = await serveStatic(new Request(`http://x/${asset}`), config);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toContain('immutable');
  });

  test('404s a missing asset and rejects traversal', async () => {
    expect((await serveStatic(new Request('http://x/nope.js'), config))?.status).toBe(404);
    expect(
      (await serveStatic(new Request('http://x/..%2f..%2fetc%2fpasswd'), config))?.status,
    ).toBe(400);
  });
});
