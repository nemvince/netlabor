/** Chunked uploads: staging files, offset validation, and sha256 finalization. */

import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type UploadStatus } from '@netlabor/contract';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { ControllerConfig } from '../config.ts';

/** Chunk size advertised to upload clients (8 MiB). */
export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

export interface UploadRecord {
  id: string;
  user_id: string | null;
  filename: string;
  sha256: string | null;
  size_bytes: string | number;
  received_bytes: string | number;
  state: 'pending' | 'complete' | 'cancelled';
  created_at: Date;
}

export function uploadPartPath(config: ControllerConfig, uploadId: string): string {
  return path.join(config.stagingDir, `${uploadId}.part`);
}

export function uploadBlobPath(config: ControllerConfig, sha256: string, filename: string): string {
  return path.join(config.stagingDir, 'blobs', sha256, filename);
}

async function hashFile(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(filePath).stream()) {
    hasher.update(chunk);
  }
  return Buffer.from(hasher.digest()).toString('hex');
}

function toStatus(record: UploadRecord): UploadStatus {
  return {
    uploadId: record.id,
    filename: record.filename,
    sha256: record.sha256,
    sizeBytes: Number(record.size_bytes),
    receivedBytes: Number(record.received_bytes),
    state: record.state,
  };
}

async function getRecord(db: SQL, id: string): Promise<UploadRecord> {
  const rows = await db.unsafe<UploadRecord[]>(
    `SELECT id, user_id, filename, sha256, size_bytes, received_bytes, state, created_at
       FROM uploads WHERE id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'upload not found');
  return record;
}

function assertOwner(record: UploadRecord, userId: string, isAdmin: boolean): void {
  if (record.user_id && record.user_id !== userId && !isAdmin) {
    throw new AppError('FORBIDDEN', 'this upload belongs to another user');
  }
}

export interface UploadAuth {
  userId: string;
  isAdmin: boolean;
}

export async function startUpload(
  db: SQL,
  config: ControllerConfig,
  auth: UploadAuth,
  input: { filename: string; sizeBytes: number },
): Promise<{ uploadId: string; chunkSize: number; receivedBytes: number }> {
  if (
    path.basename(input.filename) !== input.filename ||
    input.filename === '.' ||
    input.filename === '..'
  ) {
    throw new AppError('BAD_REQUEST', 'upload filename cannot contain path separators');
  }
  if (input.sizeBytes > config.maxUploadBytes) {
    throw new AppError('BAD_REQUEST', 'upload exceeds the configured maximum size', {
      details: { maxUploadBytes: config.maxUploadBytes },
    });
  }
  const id = newId();
  const partPath = uploadPartPath(config, id);
  await mkdir(config.stagingDir, { recursive: true, mode: 0o755 });
  await writeFile(partPath, new Uint8Array(), { mode: 0o600 });
  await db.unsafe(
    `INSERT INTO uploads (id, user_id, filename, size_bytes, received_bytes, state)
     VALUES ($1, $2, $3, $4, 0, 'pending')`,
    [id, auth.userId, input.filename, input.sizeBytes],
  );
  return { uploadId: id, chunkSize: UPLOAD_CHUNK_SIZE, receivedBytes: 0 };
}

export async function uploadStatus(db: SQL, id: string): Promise<UploadStatus> {
  return toStatus(await getRecord(db, id));
}

export async function writeUploadChunk(
  db: SQL,
  config: ControllerConfig,
  auth: UploadAuth,
  id: string,
  offset: number,
  bytes: Uint8Array,
): Promise<UploadStatus> {
  const record = await getRecord(db, id);
  assertOwner(record, auth.userId, auth.isAdmin);
  if (record.state !== 'pending') {
    throw new AppError('CONFLICT', `upload is ${record.state}`);
  }
  const received = Number(record.received_bytes);
  const total = Number(record.size_bytes);
  if (offset !== received) {
    throw new AppError('CONFLICT', `offset mismatch: expected ${received}`, {
      details: { expectedOffset: received },
    });
  }
  if (bytes.byteLength === 0) throw new AppError('BAD_REQUEST', 'empty chunk');
  if (bytes.byteLength > UPLOAD_CHUNK_SIZE) {
    throw new AppError('BAD_REQUEST', `chunk exceeds ${UPLOAD_CHUNK_SIZE} bytes`);
  }
  if (received + bytes.byteLength > total) {
    throw new AppError('BAD_REQUEST', 'chunk exceeds the declared upload size', {
      details: { sizeBytes: total, expectedOffset: received },
    });
  }

  const partPath = uploadPartPath(config, id);
  let handle: FileHandle;
  try {
    handle = await open(partPath, 'r+');
  } catch {
    throw new AppError('NOT_FOUND', 'upload data is missing from staging');
  }
  try {
    const written = await handle.write(bytes, 0, bytes.byteLength, offset);
    if (written.bytesWritten !== bytes.byteLength) {
      throw new AppError('INTERNAL', 'short write while storing the upload chunk');
    }
  } finally {
    await handle.close();
  }

  const rows = await db.unsafe<UploadRecord[]>(
    `UPDATE uploads SET received_bytes = received_bytes + $2 WHERE id = $1
     RETURNING id, user_id, filename, sha256, size_bytes, received_bytes, state, created_at`,
    [id, bytes.byteLength],
  );
  const updated = rows[0];
  if (!updated) throw new AppError('INTERNAL', 'upload row disappeared');
  return toStatus(updated);
}

export async function completeUpload(
  db: SQL,
  config: ControllerConfig,
  auth: UploadAuth,
  id: string,
): Promise<UploadStatus> {
  const record = await getRecord(db, id);
  assertOwner(record, auth.userId, auth.isAdmin);
  if (record.state === 'complete') return toStatus(record);
  if (record.state === 'cancelled') throw new AppError('CONFLICT', 'upload was cancelled');

  const partPath = uploadPartPath(config, id);
  let size: number;
  try {
    size = (await stat(partPath)).size;
  } catch {
    throw new AppError('NOT_FOUND', 'upload data is missing from staging');
  }
  const total = Number(record.size_bytes);
  if (size !== total) {
    throw new AppError('CONFLICT', `upload is incomplete: received ${size} of ${total} bytes`, {
      details: { expectedOffset: size, sizeBytes: total },
    });
  }
  const sha256 = await hashFile(partPath);
  const rows = await db.unsafe<UploadRecord[]>(
    `UPDATE uploads SET sha256 = $2, state = 'complete', received_bytes = $3
      WHERE id = $1
     RETURNING id, user_id, filename, sha256, size_bytes, received_bytes, state, created_at`,
    [id, sha256, size],
  );
  const updated = rows[0];
  if (!updated) throw new AppError('INTERNAL', 'upload row disappeared');
  return toStatus(updated);
}

export async function cancelUpload(
  db: SQL,
  config: ControllerConfig,
  auth: UploadAuth,
  id: string,
): Promise<void> {
  const record = await getRecord(db, id);
  assertOwner(record, auth.userId, auth.isAdmin);
  if (record.state === 'cancelled') return;
  if (record.state === 'complete') {
    throw new AppError('CONFLICT', 'completed uploads cannot be cancelled');
  }
  await db.unsafe("UPDATE uploads SET state = 'cancelled' WHERE id = $1", [id]);
  await rm(uploadPartPath(config, id), { force: true });
}

/** Re-read a completed upload and verify its sha256 against the stored value. */
export async function verifyCompletedUpload(
  db: SQL,
  config: ControllerConfig,
  id: string,
): Promise<{ record: UploadRecord; partPath: string; sha256: string }> {
  const record = await getRecord(db, id);
  if (record.state !== 'complete' || !record.sha256) {
    throw new AppError('CONFLICT', 'upload is not complete');
  }
  const partPath = uploadPartPath(config, id);
  let exists = true;
  try {
    await stat(partPath);
  } catch {
    exists = false;
  }
  if (!exists) throw new AppError('NOT_FOUND', 'upload data is missing from staging');
  const sha256 = await hashFile(partPath);
  if (sha256 !== record.sha256) {
    throw new AppError('BAD_REQUEST', 'staged upload does not match its recorded sha256', {
      details: { expected: record.sha256, actual: sha256 },
    });
  }
  return { record, partPath, sha256 };
}
