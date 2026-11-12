/** Chunked upload client backed by the controller's upload procedures. */

import { client } from './api.ts';

/**
 * Uploads one file in controller-sized chunks. Progress is the fraction of
 * bytes acknowledged by the server, never an estimate.
 */
export async function uploadFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const started = await client.uploads.start({ filename: file.name, sizeBytes: file.size });

  let offset = started.receivedBytes;
  while (offset < file.size) {
    const end = Math.min(offset + started.chunkSize, file.size);
    const chunk = new File([file.slice(offset, end)], file.name);
    await client.uploads.chunk({ uploadId: started.uploadId, offset, chunk });
    offset = end;
    onProgress?.(offset / file.size);
  }

  await client.uploads.complete({ uploadId: started.uploadId });
  onProgress?.(1);
  return started.uploadId;
}
