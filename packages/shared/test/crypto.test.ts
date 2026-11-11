import { describe, expect, test } from 'bun:test';
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  parseSecretKey,
  sha256Hex,
} from '../src/crypto.ts';

const key = parseSecretKey(Buffer.alloc(32, 9).toString('base64'));

describe('crypto', () => {
  test('encrypts and decrypts a secret', () => {
    const secret = encryptSecret('hunter2-secret', key);
    expect(new TextDecoder().decode(secret.ciphertext)).not.toContain('hunter2');
    expect(decryptSecret(secret, key)).toBe('hunter2-secret');
  });

  test('rejects tampered ciphertext', () => {
    const secret = encryptSecret('value', key);
    secret.ciphertext[0] = (secret.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret(secret, key)).toThrow();
  });

  test('api keys are prefixed and hashed', () => {
    const material = generateApiKey();
    expect(material.plaintext.startsWith('nbk_')).toBe(true);
    expect(material.prefix).toBe(`nbk_${material.plaintext.slice(4, 12)}`);
    expect(material.hash).toBe(sha256Hex(material.plaintext));
  });

  test('constant time comparison', () => {
    expect(constantTimeEqual(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(constantTimeEqual(sha256Hex('a'), sha256Hex('b'))).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  test('secret keys must be 32 bytes', () => {
    expect(() => parseSecretKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});
