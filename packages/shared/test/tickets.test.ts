import { describe, expect, test } from 'bun:test';
import { issueTicket, TicketError, TicketStore } from '../src/tickets.ts';

const key = new Uint8Array(32).fill(3);

describe('ws tickets', () => {
  test('round-trips a console ticket', () => {
    const store = new TicketStore(key);
    const token = issueTicket(
      { sub: 'user-1', purpose: 'console', resourceId: 'node-1', projectId: 'proj-1' },
      key,
    );
    const payload = store.verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.resourceId).toBe('node-1');
    expect(payload.projectId).toBe('proj-1');
  });

  test('rejects replay of the same ticket', () => {
    const store = new TicketStore(key);
    const token = issueTicket({ sub: 'u', purpose: 'vnc', resourceId: 'n' }, key);
    store.verify(token);
    expect(() => store.verify(token)).toThrow(TicketError);
  });

  test('rejects a forged signature', () => {
    const store = new TicketStore(key);
    const token = issueTicket({ sub: 'u', purpose: 'console', resourceId: 'n' }, key);
    const [payload] = token.split('.');
    expect(() => store.verify(`${payload}.forged`)).toThrow(TicketError);
  });

  test('rejects an expired ticket', () => {
    const store = new TicketStore(key);
    const token = issueTicket(
      { sub: 'u', purpose: 'console', resourceId: 'n', ttlSeconds: -1 },
      key,
    );
    expect(() => store.verify(token)).toThrow(/expired/);
  });
});
