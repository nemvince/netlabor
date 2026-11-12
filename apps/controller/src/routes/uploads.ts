/** Upload procedures: start, chunk, complete, status, cancel. */

import { AppError } from '@netlabor/contract';
import { mutationOriginAllowed } from '../auth/middleware.ts';
import type { Context } from '../context.ts';
import type { Implementer } from '../implementer.ts';
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
        startUpload(context.db, context.config, uploadAuth(context.auth), input),
      ),
      status: os.uploads.status.handler(async ({ input, context }) =>
        uploadStatus(context.db, input.uploadId),
      ),
      chunk: os.uploads.chunk.handler(async ({ input, context }) => {
        assertSameOrigin(context);
        return writeUploadChunk(
          context.db,
          context.config,
          uploadAuth(context.auth),
          input.uploadId,
          input.offset,
          new Uint8Array(await input.chunk.arrayBuffer()),
        );
      }),
      complete: os.uploads.complete.handler(async ({ input, context }) =>
        completeUpload(context.db, context.config, uploadAuth(context.auth), input.uploadId),
      ),
      cancel: os.uploads.cancel.handler(async ({ input, context }) => {
        await cancelUpload(context.db, context.config, uploadAuth(context.auth), input.uploadId);
        return { ok: true as const };
      }),
    },
  };
}

type AuthInfoLike = {
  user: { id: string } | null;
  isAdmin: boolean;
};

function uploadAuth(auth: AuthInfoLike): UploadAuth {
  if (!auth.user) throw new AppError('UNAUTHORIZED', 'authentication required');
  return { userId: auth.user.id, isAdmin: auth.isAdmin };
}

/**
 * Chunk writes are raw-body requests and not named as mutations, so the shared
 * middleware does not CSRF-check them; keep the old HTTP-level origin rule.
 */
function assertSameOrigin(context: Context): void {
  if (context.auth.type !== 'session') return;
  const allowed = mutationOriginAllowed({
    origin: context.request.origin,
    host: context.request.host,
    publicUrl: context.config.publicUrl,
  });
  const site = context.request.secFetchSite;
  if (!allowed || (site && site !== 'same-origin' && site !== 'none')) {
    throw new AppError('FORBIDDEN', 'cross-origin request rejected');
  }
}
