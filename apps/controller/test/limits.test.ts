import { describe, expect, setSystemTime, test } from 'bun:test';
import { LIMITS, RateLimiter } from '../src/limits.ts';

describe('RateLimiter', () => {
  test('exhausts a window at the configured limit', () => {
    const limiter = new RateLimiter();
    const rule = { limit: 2, windowMs: 60_000 };
    limiter.consume('upload:127.0.0.1', rule);
    limiter.consume('upload:127.0.0.1', rule);
    expect(() => limiter.consume('upload:127.0.0.1', rule)).toThrow(/too many requests/i);
  });

  test('keeps buckets per key', () => {
    const limiter = new RateLimiter();
    const rule = { limit: 1, windowMs: 60_000 };
    limiter.consume('login:a', rule);
    expect(() => limiter.consume('login:a', rule)).toThrow();
    expect(() => limiter.consume('login:b', rule)).not.toThrow();
  });

  test('forgets the count once the window has passed', () => {
    const limiter = new RateLimiter();
    const rule = { limit: 1, windowMs: 20 };
    const start = Date.now();
    setSystemTime(new Date(start));
    try {
      limiter.consume('ticket:x', rule);
      setSystemTime(new Date(start + 25));
      expect(() => limiter.consume('ticket:x', rule)).not.toThrow();
    } finally {
      setSystemTime();
    }
  });

  test('is bypassed when NB_DISABLE_RATE_LIMITS=1', () => {
    const previous = process.env.NB_DISABLE_RATE_LIMITS;
    process.env.NB_DISABLE_RATE_LIMITS = '1';
    try {
      const limiter = new RateLimiter();
      for (let attempt = 0; attempt < LIMITS.upload.limit + 5; attempt++) {
        expect(() => limiter.consume('upload:local', LIMITS.upload)).not.toThrow();
      }
    } finally {
      if (previous === undefined) delete process.env.NB_DISABLE_RATE_LIMITS;
      else process.env.NB_DISABLE_RATE_LIMITS = previous;
    }
  });
});
