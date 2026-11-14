/** Chunked upload client backed by the controller's upload procedures. */

import { client } from './api.ts';

/**
 * Uploads one file in controller-sized chunks. Progress is the fraction of
 * bytes acknowledged by the server, never an estimate. Aborting the signal
 * cancels the upload on the controller and leaves no staging bytes behind.
 */
export async function uploadFile(
  file: File,
  onProgress?: (fraction: number) => void,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const started = await client.uploads.start({ filename: file.name, sizeBytes: file.size });
  const signal = options.signal;

  async function cancelled(): Promise<never> {
    await client.uploads.cancel({ uploadId: started.uploadId }).catch(() => undefined);
    throw new DOMException('upload cancelled', 'AbortError');
  }

  let offset = started.receivedBytes;
  try {
    while (offset < file.size) {
      if (signal?.aborted) await cancelled();
      const end = Math.min(offset + started.chunkSize, file.size);
      const chunk = new File([file.slice(offset, end)], file.name);
      await client.uploads.chunk({ uploadId: started.uploadId, offset, chunk });
      offset = end;
      onProgress?.(offset / file.size);
    }
    await client.uploads.complete({ uploadId: started.uploadId });
  } catch (error) {
    if (signal?.aborted)
      await client.uploads.cancel({ uploadId: started.uploadId }).catch(() => undefined);
    throw error;
  }
  onProgress?.(1);
  return started.uploadId;
}
