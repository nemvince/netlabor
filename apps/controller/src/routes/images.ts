/** Image routes plus the agent-authenticated blob download endpoint. */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, ERROR_STATUS } from '@netlabor/contract';
import { sha256Hex } from '@netlabor/shared';
import { hasPrivilege } from '../auth/principal.ts';
import { createRequestContext } from '../context.ts';
import type { AppDeps, Implementer } from '../implementer.ts';
import {
  createImageFromUpload,
  deleteImage,
  getImage,
  listImageReplicas,
  listImages,
  pruneImages,
  syncImage,
  updateImageName,
} from '../services/images.ts';
import type { JobService } from '../services/jobs.ts';
import { uploadBlobPath } from '../services/uploads.ts';

export function imageRoutes(os: Implementer, jobs: JobService) {
  return {
    images: {
      list: os.images.list.handler(async ({ input, context }) => listImages(context.db, input)),
      get: os.images.get.handler(async ({ input, context }) => getImage(context.db, input.id)),
      createFromUpload: os.images.createFromUpload.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return createImageFromUpload(
          context,
          { userId: user.id, isAdmin: context.auth.isAdmin },
          input,
        );
      }),
      update: os.images.update.handler(async ({ input, context }) =>
        updateImageName(context, input),
      ),
      delete: os.images.delete.handler(async ({ input, context }) => {
        await deleteImage(context, context.auth.user?.id ?? null, input.id);
        return { ok: true as const };
      }),
      sync: os.images.sync.handler(async ({ input, context }) => syncImage(context, jobs, input)),
      prune: os.images.prune.handler(async ({ input, context }) =>
        pruneImages(context, jobs, input),
      ),
      replicas: os.images.replicas.handler(async ({ input, context }) =>
        listImageReplicas(context.db, input.imageId),
      ),
    },
  };
}

/** Reject any filename that could escape the blob directory. */
function safeBlobFilename(filename: string): string {
  if (filename !== path.basename(filename) || filename === '.' || filename === '..') {
    throw new AppError('BAD_REQUEST', 'invalid blob filename');
  }
  return filename;
}

async function authorizeAgent(deps: AppDeps, request: Request): Promise<void> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'agent token required');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) throw new AppError('UNAUTHORIZED', 'agent token required');
  const rows = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM computes WHERE token_hash = $1',
    [sha256Hex(token)],
  );
  if (!rows[0]) throw new AppError('UNAUTHORIZED', 'agent token required');
}

function blobCandidates(deps: AppDeps, sha256: string, filename: string): string[] {
  const candidates = [uploadBlobPath(deps.config, sha256, filename)];
  if (deps.config.storageDriver === 'nfs' && deps.config.nfsImageDir) {
    candidates.push(path.join(deps.config.nfsImageDir, sha256, filename));
  }
  return candidates;
}

async function resolveBlob(
  deps: AppDeps,
  sha256: string,
  filename: string,
): Promise<string | null> {
  for (const candidate of blobCandidates(deps, sha256, filename)) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // try the next location
    }
  }
  return null;
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (startRaw === '' && endRaw === '') return null;
  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Serve an image blob to a compute agent. The caller authenticates with the
 * requesting compute's token; peers use their own token against the peer's
 * agent.
 */
export async function handleAgentBlobHttp(
  deps: AppDeps,
  request: Request,
  sha256: string,
  encodedFilename: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ code: 'BAD_REQUEST', message: 'method not allowed' }, { status: 405 });
  }
  try {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new AppError('BAD_REQUEST', 'invalid sha256');
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(encodedFilename);
    } catch {
      throw new AppError('BAD_REQUEST', 'invalid blob filename');
    }
    const filename = safeBlobFilename(decoded);
    await authorizeAgent(deps, request);
    const filePath = await resolveBlob(deps, sha256, filename);
    if (!filePath) throw new AppError('NOT_FOUND', 'blob not found');

    const info = await stat(filePath);
    const file = Bun.file(filePath);
    const baseHeaders: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
    };
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const range = parseRange(rangeHeader, info.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, 'content-range': `bytes */${info.size}` },
        });
      }
      return new Response(
        request.method === 'HEAD' ? null : file.slice(range.start, range.end + 1),
        {
          status: 206,
          headers: {
            ...baseHeaders,
            'content-length': String(range.end - range.start + 1),
            'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
          },
        },
      );
    }
    return new Response(request.method === 'HEAD' ? null : file, {
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(info.size) },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(error.toJSON(), { status: ERROR_STATUS[error.code] });
    }
    deps.logger.error('blob download failed', { err: error });
    return Response.json({ code: 'INTERNAL', message: 'internal error' }, { status: 500 });
  }
}

/** Session-authenticated blob download for the browser (Range capable). */
export async function handleImageBlobHttp(
  deps: AppDeps,
  request: Request,
  sha256: string,
  encodedFilename: string,
): Promise<Response> {
  try {
    const context = await createRequestContext(deps, request);
    if (!context.auth.user || !hasPrivilege(context.auth, 'image.read', null)) {
      return new Response('forbidden', { status: 403 });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(encodedFilename);
    } catch {
      throw new AppError('BAD_REQUEST', 'invalid blob filename');
    }
    const filename = safeBlobFilename(decoded);
    const filePath = await resolveBlob(deps, sha256, filename);
    if (!filePath) throw new AppError('NOT_FOUND', 'blob not found');
    const info = await stat(filePath);
    const file = Bun.file(filePath);
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = match[1] === '' ? Math.max(0, info.size - Number(match[2])) : Number(match[1]);
        const end = match[2] === '' || match[1] === '' ? info.size - 1 : Number(match[2]);
        if (start <= end && start < info.size) {
          return new Response(file.slice(start, end + 1), {
            status: 206,
            headers: {
              'content-type': 'application/octet-stream',
              'accept-ranges': 'bytes',
              'content-length': String(end - start + 1),
              'content-range': `bytes ${start}-${end}/${info.size}`,
            },
          });
        }
      }
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${info.size}` },
      });
    }
    return new Response(file, {
      headers: {
        'content-type': 'application/octet-stream',
        'accept-ranges': 'bytes',
        'content-length': String(info.size),
        'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(error.toJSON(), { status: ERROR_STATUS[error.code] });
    }
    deps.logger.error('image blob download failed', { err: error });
    return Response.json({ code: 'INTERNAL', message: 'internal error' }, { status: 500 });
  }
}
