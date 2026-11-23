/** In-memory rate limiting for login, uploads, and tickets. */

import { AppError } from '@netlabor/contract';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  upload: { limit: 2, windowMs: 60_000 },
  websocket: { limit: 120, windowMs: 60_000 },
  ticket: { limit: 60, windowMs: 60_000 },
  oidc: { limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Consume one unit; throws TOO_MANY_REQUESTS when the window is exhausted. */
  consume(key: string, rule: RateLimitRule): void {
    if (process.env.NB_DISABLE_RATE_LIMITS === '1') return;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      this.compact(now);
      return;
    }
    if (bucket.count >= rule.limit) {
      throw new AppError('TOO_MANY_REQUESTS', 'too many requests; slow down', {
        details: { retryAfterMs: bucket.resetAt - now },
        retryable: true,
      });
    }
    bucket.count++;
  }

  private compact(now: number): void {
    if (this.buckets.size < 5_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** Rate limiting can be disabled for integration and load tests. */
export const limiter: RateLimiter =
  process.env.NB_DISABLE_RATE_LIMITS === '1'
    ? new (class extends RateLimiter {})()
    : new RateLimiter();

export function rateLimitsDisabled(): boolean {
  return process.env.NB_DISABLE_RATE_LIMITS === '1';
}

/** Bucket per resolved client address; the caller never passes forwarded headers here. */
export function clientKey(action: string, ip: string | null): string {
  return `${action}:${ip ?? 'unresolved'}`;
}
