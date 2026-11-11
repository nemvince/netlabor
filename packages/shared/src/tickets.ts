/**
 * HMAC-signed single-use tickets for WebSocket upgrades.
 * Format: base64url(payloadJSON) + "." + base64url(hmacSha256(payload)).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type TicketPurpose = 'console' | 'vnc' | 'wireshark' | 'project' | 'capture';

export interface TicketPayload {
  sub: string;
  purpose: TicketPurpose;
  resourceId: string;
  projectId?: string;
  exp: number;
  nonce: string;
}

export class TicketError extends Error {
  constructor(
    message: string,
    readonly reason: 'malformed' | 'signature' | 'expired' | 'replayed',
  ) {
    super(message);
    this.name = 'TicketError';
  }
}

function sign(payload: string, key: Uint8Array): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function issueTicket(
  input: Omit<TicketPayload, 'exp' | 'nonce'> & { ttlSeconds?: number },
  key: Uint8Array,
): string {
  const ttl = input.ttlSeconds ?? 60;
  const payload: TicketPayload = {
    sub: input.sub,
    purpose: input.purpose,
    resourceId: input.resourceId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    exp: Math.floor(Date.now() / 1000) + ttl,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

const CONSUMED_LIMIT = 10_000;

/** Verify signature and expiry, then record the nonce as consumed. */
export class TicketStore {
  private readonly consumed = new Set<string>();

  constructor(private readonly key: Uint8Array) {}

  verify(token: string): TicketPayload {
    const dot = token.indexOf('.');
    if (dot <= 0) throw new TicketError('malformed ticket', 'malformed');
    const encoded = token.slice(0, dot);
    const providedSig = token.slice(dot + 1);
    const expectedSig = sign(encoded, this.key);
    const provided = Buffer.from(providedSig);
    const expected = Buffer.from(expectedSig);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new TicketError('bad ticket signature', 'signature');
    }
    let payload: TicketPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketPayload;
    } catch {
      throw new TicketError('ticket payload is not JSON', 'malformed');
    }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
      throw new TicketError('ticket expired', 'expired');
    }
    if (this.consumed.has(payload.nonce)) throw new TicketError('ticket already used', 'replayed');
    this.consumed.add(payload.nonce);
    if (this.consumed.size > CONSUMED_LIMIT) {
      const [oldest] = this.consumed;
      if (oldest) this.consumed.delete(oldest);
    }
    return payload;
  }
}
