/** AppError ⇄ ORPCError translation. */

import { AppError, type AppErrorCode } from '@netlabor/contract';
import { ORPCError } from '@orpc/server';

export const ORPC_CODE: Record<AppErrorCode, ConstructorParameters<typeof ORPCError>[0]> = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  AGENT_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  AGENT_ERROR: 'BAD_GATEWAY',
  NODE_BUSY: 'CONFLICT',
  NODE_NOT_RUNNING: 'CONFLICT',
  IMAGE_MISSING: 'UNPROCESSABLE_CONTENT',
  BINARY_MISSING: 'UNPROCESSABLE_CONTENT',
  LICENSE_MISSING: 'UNPROCESSABLE_CONTENT',
  CAPABILITY_UNSUPPORTED: 'NOT_IMPLEMENTED',
  JOB_FAILED: 'INTERNAL_SERVER_ERROR',
  INTERNAL: 'INTERNAL_SERVER_ERROR',
};

export function toORPCError(error: AppError): ORPCError<string, Record<string, unknown>> {
  return new ORPCError(ORPC_CODE[error.code], {
    message: error.message,
    data: {
      appCode: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
      retryable: error.retryable,
    },
  });
}

/** Convert any thrown value into an ORPCError, mapping AppError codes. */
export function normalizeError(error: unknown): unknown {
  if (error instanceof AppError) return toORPCError(error);
  return error;
}
