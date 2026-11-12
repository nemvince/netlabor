/**
 * Byte-serving routes against a live controller (NB_TEST_API_URL): chunked
 * uploads and the range-capable image blob endpoint. Skipped without a stack.
 */

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@netlabor/shared';
import { baseUrl, login, type Session } from './live.ts';

const describeLive = baseUrl ? describe : describe.skip;

let session: Session;

describeLive('file routes', () => {
  test('publishes an upload as a range-capable image blob', async () => {
    session = await login();
    const bytes = Array.from({ length: 4096 }, (_, index) => index % 256);
    const payload = new Uint8Array(bytes);
    const filename = `e2e-${Date.now().toString(36)}.bin`;

    const started = await session.client.uploads.start({
      filename,
      sizeBytes: payload.byteLength,
    });
    expect(started.receivedBytes).toBe(0);
    expect(started.chunkSize).toBeGreaterThan(0);

    const appended = await session.client.uploads.chunk({
      uploadId: started.uploadId,
      offset: 0,
      chunk: new File([payload], filename),
    });
    expect(appended.receivedBytes).toBe(payload.byteLength);

    const completed = await session.client.uploads.complete({ uploadId: started.uploadId });
    expect(completed.state).toBe('complete');
    expect(completed.sha256).toBe(sha256Hex(payload));

    const image = await session.client.images.createFromUpload({
      uploadId: started.uploadId,
      name: `e2e ${filename}`,
      kind: 'firmware',
    });
    expect(image.sha256).toBe(sha256Hex(payload));
    expect(image.sizeBytes).toBe(payload.byteLength);

    const url = `${baseUrl}/api/blobs/${image.sha256}/${encodeURIComponent(image.filename)}`;
    const auth = { cookie: session.cookie() };

    const whole = await fetch(url, { headers: auth });
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(payload);

    const slice = await fetch(url, { headers: { ...auth, range: 'bytes=10-19' } });
    expect(slice.status).toBe(206);
    expect(slice.headers.get('content-range')).toBe(`bytes 10-19/${payload.byteLength}`);
    expect(slice.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await slice.arrayBuffer())).toEqual(payload.slice(10, 20));

    const anonymous = await fetch(url);
    expect(anonymous.status).toBe(401);
  });

  test('rejects a chunk whose offset does not match the received bytes', async () => {
    const started = await session.client.uploads.start({ filename: 'offset.bin', sizeBytes: 8 });
    const chunk = new File([new Uint8Array(4)], 'offset.bin');
    await expect(
      session.client.uploads.chunk({ uploadId: started.uploadId, offset: 4, chunk }),
    ).rejects.toThrow(/offset/i);
    const status = await session.client.uploads.status({ uploadId: started.uploadId });
    expect(status.receivedBytes).toBe(0);
    expect(status.state).toBe('pending');
  });

  test('cancelling an upload freezes it', async () => {
    const started = await session.client.uploads.start({ filename: 'cancel.bin', sizeBytes: 16 });
    await session.client.uploads.cancel({ uploadId: started.uploadId });
    const status = await session.client.uploads.status({ uploadId: started.uploadId });
    expect(status.state).toBe('cancelled');
  });
});
