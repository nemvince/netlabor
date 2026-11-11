/**
 * Application error model. Every failure surfaced through oRPC uses one of
 * these codes; the UI renders `message`/`details` and never parses strings.
 */

export const APP_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'TOO_MANY_REQUESTS',
  'AGENT_UNAVAILABLE',
  'AGENT_ERROR',
  'NODE_BUSY',
  'NODE_NOT_RUNNING',
  'IMAGE_MISSING',
  'BINARY_MISSING',
  'LICENSE_MISSING',
  'CAPABILITY_UNSUPPORTED',
  'JOB_FAILED',
  'INTERNAL',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppErrorData {
  code: AppErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { details?: unknown; retryable?: boolean },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }

  toJSON(): AppErrorData {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      retryable: this.retryable,
    };
  }
}

/** HTTP status mapping used by the controller and the agent. */
export const ERROR_STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  AGENT_UNAVAILABLE: 503,
  AGENT_ERROR: 502,
  NODE_BUSY: 409,
  NODE_NOT_RUNNING: 409,
  IMAGE_MISSING: 422,
  BINARY_MISSING: 422,
  LICENSE_MISSING: 422,
  CAPABILITY_UNSUPPORTED: 501,
  JOB_FAILED: 500,
  INTERNAL: 500,
};

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError('BAD_REQUEST', message, { details });
}

export function notFound(what: string, details?: unknown): AppError {
  return new AppError('NOT_FOUND', `${what} not found`, { details });
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, { details });
}

export function forbidden(message = 'not allowed'): AppError {
  return new AppError('FORBIDDEN', message);
}

export function unauthorized(message = 'authentication required'): AppError {
  return new AppError('UNAUTHORIZED', message);
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Abort signal and cancellation errors are not application failures. */
export function isAbortError(value: unknown): boolean {
  return value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError');
}
