import { describe, expect, test } from 'bun:test';
import { clientAddress } from '../src/context.ts';

function request(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1:8080/rpc', { headers });
}

describe('clientAddress', () => {
  test('uses the socket address and ignores forged forwarding headers', () => {
    const address = clientAddress(
      request({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' }),
      '127.0.0.1',
      false,
    );
    expect(address).toBe('127.0.0.1');
  });

  test('honours the first forwarded hop behind a trusted proxy', () => {
    const address = clientAddress(
      request({ 'x-forwarded-for': '203.0.113.9, 10.0.0.2' }),
      '127.0.0.1',
      true,
    );
    expect(address).toBe('203.0.113.9');
  });

  test('falls back to the socket address when the proxy sent nothing', () => {
    expect(clientAddress(request({}), '127.0.0.1', true)).toBe('127.0.0.1');
  });
});
