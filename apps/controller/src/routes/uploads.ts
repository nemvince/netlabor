/** Upload routes: oRPC start/status/cancel plus the chunked HTTP endpoints. */

import {
  AppError,
  ERROR_STATUS,
  UploadStartInput,
  type UploadStartOutput,
  type UploadStatus,
} from '@netlabor/contract';
import { hasPrivilege } from '../auth/principal.ts';
import { createRequestContext } from '../context.ts';
import type { AppDeps, Implementer } from '../implementer.ts';
import {
  cancelUpload,
  completeUpload,
  startUpload,
  type UploadAuth,
  uploadStatus,
  writeUploadChunk,
} from '../services/uploads.ts';

export function uploadRoutes(os: Implementer) {
  return {
    uploads: {
      start: os.uploads.start.handler(async ({ input, context }) =>
        startUpload(context.db, context.config, requireAuth(context.auth), input),
      ),
      status: os.uploads.status.handler(async ({ input, context }) =>
        uploadStatus(context.db, input.uploadId),
      ),
      cancel: os.uploads.cancel.handler(async ({ input, context }) => {
        await cancelUpload(context.db, context.config, requireAuth(context.auth), input.uploadId);
        return { ok: true as const };
      }),
    },
  };
}

type AuthInfoLike = {
  type: string;
  user: { id: string } | null;
  isAdmin: boolean;
};

function requireAuth(auth: AuthInfoLike): UploadAuth {
  if (!auth.user) throw new AppError('UNAUTHORIZED', 'authentication required');
  return { userId: auth.user.id, isAdmin: auth.isAdmin };
}

async function authenticateHttp(deps: AppDeps, request: Request): Promise<UploadAuth> {
  const context = await createRequestContext(deps, request);
  if (context.auth.type !== 'session') {
    throw new AppError('FORBIDDEN', 'uploads require an interactive session');
  }
  const user = context.auth.user;
  if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
  if (!hasPrivilege(context.auth, 'image.write', null)) {
    throw new AppError('FORBIDDEN', 'missing privilege image.write');
  }
  const mutating = request.method !== 'GET' && request.method !== 'HEAD';
  if (mutating) {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    const expected = new URL(deps.config.publicUrl).origin;
    if ((origin && origin !== expected) || (site && site !== 'same-origin' && site !== 'none')) {
      throw new AppError('FORBIDDEN', 'cross-origin request rejected');
    }
  }
  return { userId: user.id, isAdmin: context.auth.isAdmin };
}

function errorResponse(error: unknown, deps: AppDeps): Response {
  if (error instanceof AppError) {
    return Response.json(error.toJSON(), { status: ERROR_STATUS[error.code] });
  }
  deps.logger.error('upload request failed', { err: error });
  return Response.json({ code: 'INTERNAL', message: 'internal error' }, { status: 500 });
}

const UPLOAD_PATH = /^\/api\/uploads\/([0-9a-fA-F-]{36})(\/complete)?$/;

/**
 * Handle the chunked upload HTTP surface. Returns null for unrelated paths so
 * the caller can fall through to other routes.
 */
export async function handleUploadHttp(deps: AppDeps, request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const isCollection = url.pathname === '/api/uploads';
  const itemMatch = UPLOAD_PATH.exec(url.pathname);
  if (!isCollection && !itemMatch) return null;

  try {
    if (isCollection) {
      if (request.method !== 'POST') {
        return Response.json(
          { code: 'BAD_REQUEST', message: 'method not allowed' },
          { status: 405 },
        );
      }
      const auth = await authenticateHttp(deps, request);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('BAD_REQUEST', 'request body must be JSON');
      }
      const parsed = UploadStartInput.safeParse(body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'invalid upload request', {
          details: parsed.error.issues,
        });
      }
      const output: UploadStartOutput = await startUpload(deps.db, deps.config, auth, parsed.data);
      return Response.json(output, { status: 201 });
    }

    const uploadId = itemMatch?.[1];
    if (!uploadId) return null;
    const complete = Boolean(itemMatch?.[2]);
    const auth = await authenticateHttp(deps, request);

    if (complete) {
      if (request.method !== 'POST') {
        return Response.json(
          { code: 'BAD_REQUEST', message: 'method not allowed' },
          { status: 405 },
        );
      }
      const status: UploadStatus = await completeUpload(deps.db, deps.config, auth, uploadId);
      return Response.json(status);
    }

    switch (request.method) {
      case 'PUT': {
        const rawOffset = url.searchParams.get('offset');
        if (rawOffset === null) {
          throw new AppError('BAD_REQUEST', 'offset query parameter is required');
        }
        const offset = Number(rawOffset);
        if (!Number.isInteger(offset) || offset < 0) {
          throw new AppError('BAD_REQUEST', 'offset must be a non-negative integer');
        }
        const body = new Uint8Array(await request.arrayBuffer());
        const status = await writeUploadChunk(deps.db, deps.config, auth, uploadId, offset, body);
        return Response.json(status);
      }
      case 'GET':
        return Response.json(await uploadStatus(deps.db, uploadId));
      case 'DELETE':
        await cancelUpload(deps.db, deps.config, auth, uploadId);
        return Response.json({ ok: true });
      default:
        return Response.json(
          { code: 'BAD_REQUEST', message: 'method not allowed' },
          { status: 405 },
        );
    }
  } catch (error) {
    return errorResponse(error, deps);
  }
}
