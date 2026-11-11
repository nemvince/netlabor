/** Chunked upload client for the controller's `/api/uploads` HTTP routes. */

interface UploadStartResponse {
  uploadId: string;
  chunkSize: number;
  receivedBytes: number;
}

async function readUploadError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return new Error(body.message ?? `${body.code ?? 'upload'} failed (${response.status})`);
  } catch {
    return new Error(`upload failed with status ${response.status}`);
  }
}

/**
 * Uploads one file in controller-sized chunks. Progress is the fraction of
 * bytes acknowledged by the server, never an estimate.
 */
export async function uploadFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const startResponse = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
  });
  if (!startResponse.ok) throw await readUploadError(startResponse);
  const started = (await startResponse.json()) as UploadStartResponse;

  let offset = started.receivedBytes;
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + started.chunkSize, file.size));
    const response = await fetch(`/api/uploads/${started.uploadId}?offset=${offset}`, {
      method: 'PUT',
      credentials: 'include',
      body: chunk,
    });
    if (!response.ok) throw await readUploadError(response);
    offset += chunk.size;
    onProgress?.(offset / file.size);
  }

  const completeResponse = await fetch(`/api/uploads/${started.uploadId}/complete`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!completeResponse.ok) throw await readUploadError(completeResponse);
  onProgress?.(1);
  return started.uploadId;
}
