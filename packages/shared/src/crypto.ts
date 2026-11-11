/** Hashing, constant-time comparison, API key material, and secret encryption. */

import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export function sha256Bytes(data: string | Uint8Array): Uint8Array {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(data);
  return new Uint8Array(hasher.digest());
}

export function sha256Hex(data: string | Uint8Array): string {
  return Buffer.from(sha256Bytes(data)).toString('hex');
}

/** Compare two digests without leaking content timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

export interface ApiKeyMaterial {
  plaintext: string;
  /** Display prefix: `nbk_` plus the first 8 characters of the key body. */
  prefix: string;
  hash: string;
}

export function generateApiKey(): ApiKeyMaterial {
  const body = randomToken(32);
  const plaintext = `nbk_${body}`;
  return { plaintext, prefix: `nbk_${body.slice(0, 8)}`, hash: sha256Hex(plaintext) };
}

/** Decode NB_SECRET_KEY (base64, 32 bytes) into raw key bytes. */
export function parseSecretKey(value: string): Uint8Array {
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32) {
    throw new Error(`NB_SECRET_KEY must decode to 32 bytes, got ${raw.length}`);
  }
  return new Uint8Array(raw);
}

export interface EncryptedSecret {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/** AES-256-GCM with a fresh 12-byte nonce; the tag is appended to the ciphertext. */
export function encryptSecret(plaintext: string, key: Uint8Array): EncryptedSecret {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext: new Uint8Array(body), nonce };
}

export function decryptSecret(secret: EncryptedSecret, key: Uint8Array): string {
  const { ciphertext, nonce } = secret;
  if (ciphertext.length < 16) throw new Error('ciphertext too short');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
