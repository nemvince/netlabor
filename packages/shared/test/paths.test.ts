import { describe, expect, test } from 'bun:test';
import { assertSafeRelative, PathEscapeError, resolveWithin } from '../src/paths.ts';

describe('paths', () => {
  test('resolves inside the root', () => {
    expect(resolveWithin('/srv/projects/p1', 'nodes/n1/startup.cfg')).toBe(
      '/srv/projects/p1/nodes/n1/startup.cfg',
    );
  });

  test('rejects traversal', () => {
    expect(() => resolveWithin('/srv/projects/p1', '../../etc/passwd')).toThrow(PathEscapeError);
    expect(resolveWithin('/srv/projects/p1', '/etc/passwd')).toBe('/srv/projects/p1/etc/passwd');
  });

  test('assertSafeRelative', () => {
    expect(() => assertSafeRelative('a/b.txt')).not.toThrow();
    expect(() => assertSafeRelative('../b.txt')).toThrow(PathEscapeError);
    expect(() => assertSafeRelative('/abs')).toThrow(PathEscapeError);
    expect(() => assertSafeRelative('a/../../b')).toThrow(PathEscapeError);
  });
});
