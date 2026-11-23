import { describe, expect, test } from 'bun:test';
import { hasPrivilege } from '../src/auth/principal.ts';
import type { AuthInfo } from '../src/context.ts';

function auth(pending: boolean): AuthInfo {
  return {
    type: 'session',
    user: { id: 'user-1', username: 'student', displayName: null, isActive: true },
    globalPrivileges: new Set(),
    projectPrivileges: new Map([['project-1', new Set(['project.read' as const])]]),
    isAdmin: false,
    pending,
    sessionId: 'session-1',
    apiKey: null,
  };
}

describe('pending SSO accounts', () => {
  test('get no privilege even from a project grant', () => {
    expect(hasPrivilege(auth(true), 'project.read', 'project-1')).toBe(false);
  });

  test('gain privileges once the pending role is removed', () => {
    expect(hasPrivilege(auth(false), 'project.read', 'project-1')).toBe(true);
  });
});
