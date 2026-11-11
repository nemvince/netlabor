/**
 * Failure helpers for oRPC calls. The UI renders the server message verbatim
 * and never parses it; `appCode` is the stable discriminator.
 */

interface OrpcLikeError {
  code: string;
  message: string;
  data: unknown;
}

function asOrpcError(error: unknown): OrpcLikeError | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const code = record.code;
  const message = record.message;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { code, message, data: record.data };
}

/** Stable application code (FORBIDDEN, CONFLICT, …) carried in ORPCError.data. */
export function appCodeOf(error: unknown): string | undefined {
  const orpc = asOrpcError(error);
  if (!orpc) return undefined;
  const { data } = orpc;
  if (typeof data === 'object' && data !== null) {
    const appCode = (data as Record<string, unknown>).appCode;
    if (typeof appCode === 'string') return appCode;
  }
  return orpc.code;
}

export function isUnauthorized(error: unknown): boolean {
  return appCodeOf(error) === 'UNAUTHORIZED';
}

export function messageOf(error: unknown): string {
  const orpc = asOrpcError(error);
  if (orpc) return orpc.message;
  if (error instanceof Error && error.message) return error.message;
  return 'The request failed without a message.';
}
