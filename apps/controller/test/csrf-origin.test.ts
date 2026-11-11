import { describe, expect, test } from 'bun:test';
import { mutationOriginAllowed } from '../src/auth/middleware.ts';

const PUBLIC = 'http://127.0.0.1:8080';

function allowed(origin: string | null, host: string | null, publicUrl = PUBLIC): boolean {
  return mutationOriginAllowed({ origin, host, publicUrl });
}

describe('mutationOriginAllowed', () => {
  test('accepts non-browser clients that send no Origin', () => {
    expect(allowed(null, '127.0.0.1:8080')).toBe(true);
  });

  test('accepts the configured public origin', () => {
    expect(allowed('http://127.0.0.1:8080', '127.0.0.1:8080')).toBe(true);
    expect(allowed('http://127.0.0.1:8080', null)).toBe(true);
  });

  test('accepts the host the browser actually used', () => {
    expect(allowed('http://localhost:8080', 'localhost:8080')).toBe(true);
    expect(allowed('http://192.168.20.5:8080', '192.168.20.5:8080')).toBe(true);
    expect(allowed('http://skedoodle:8080', 'skedoodle:8080')).toBe(true);
    expect(allowed('https://lab.example', 'lab.example')).toBe(true);
  });

  test('rejects a foreign origin even when a Host is present', () => {
    expect(allowed('http://evil.example', '127.0.0.1:8080')).toBe(false);
    expect(allowed('http://localhost:5173', '127.0.0.1:8080')).toBe(false);
    expect(allowed('http://192.168.20.5:8080', 'localhost:8080')).toBe(false);
  });

  test('rejects malformed origins', () => {
    expect(allowed('null', '127.0.0.1:8080')).toBe(false);
    expect(allowed('not a url', '127.0.0.1:8080')).toBe(false);
  });

  test('keeps the public-url check when no Host is seen', () => {
    expect(allowed('http://localhost:8080', null)).toBe(false);
    expect(allowed('http://127.0.0.1:8080', null, 'https://lab.example')).toBe(false);
  });
});
