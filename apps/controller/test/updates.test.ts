import { describe, expect, test } from 'bun:test';
import { newerVersion, parseChecksums } from '../src/services/updates.ts';

describe('update versions', () => {
  test('orders numeric semver parts', () => {
    expect(newerVersion('0.2.0', '0.1.9')).toBe(true);
    expect(newerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(newerVersion('0.1.10', '0.10.0')).toBe(false);
  });

  test('accepts a v prefix on release tags', () => {
    expect(newerVersion('v0.2.0', '0.1.0')).toBe(true);
  });

  test('treats a commit or development build as older than a release', () => {
    expect(newerVersion('0.2.0', 'dde550f')).toBe(true);
    expect(newerVersion('0.2.0', 'development')).toBe(true);
  });
});

describe('SHA256SUMS parsing', () => {
  test('reads sha256sum output with and without the binary marker', () => {
    const sums = parseChecksums(
      `${'a'.repeat(64)}  netlabor-controller-linux-x64\n${'b'.repeat(64)} *netlabor-agent-linux-x64\n`,
    );
    expect(sums.get('netlabor-controller-linux-x64')).toBe('a'.repeat(64));
    expect(sums.get('netlabor-agent-linux-x64')).toBe('b'.repeat(64));
  });

  test('ignores malformed lines', () => {
    expect(parseChecksums('not a checksum line\n').size).toBe(0);
  });
});
