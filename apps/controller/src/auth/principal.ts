/** Authentication and privilege resolution. */

import type { Privilege } from '@netlabor/contract';
import { sha256Hex } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AuthenticatedUser, AuthInfo } from '../context.ts';
import { anonymousAuth } from '../context.ts';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
}

interface RoleRow {
  role_name: string;
  privilege: string | null;
}

interface SessionRow extends UserRow {
  session_id: string;
  expires_at: Date;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  scopes: string[] | null;
  project_ids: string[] | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

interface GrantRow {
  project_id: string;
  privilege: string;
}

export interface Credentials {
  sessionToken: string | null;
  apiKey: string | null;
  /** Present only for cookie-authenticated requests; used for CSRF checks. */
  isCookieAuth: boolean;
}

export function readCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

export function extractCredentials(request: Request): Credentials {
  const cookies = readCookies(request.headers.get('cookie'));
  const sessionToken = cookies.get('nb_session') ?? null;
  const authorization = request.headers.get('authorization');
  const apiKey =
    authorization?.startsWith('Bearer nbk_') === true
      ? authorization.slice('Bearer '.length).trim()
      : null;
  return { sessionToken, apiKey, isCookieAuth: sessionToken !== null && apiKey === null };
}

async function loadUserPrivileges(
  db: SQL,
  userId: string,
): Promise<{ roles: string[]; privileges: Set<Privilege> }> {
  const rows = await db.unsafe<RoleRow[]>(
    `SELECT r.name AS role_name, rp.privilege
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_privileges rp ON rp.role_id = r.id
      WHERE ur.user_id = $1
     UNION ALL
     SELECT r.name AS role_name, rp.privilege
       FROM group_members gm
       JOIN group_roles gr ON gr.group_id = gm.group_id
       JOIN roles r ON r.id = gr.role_id
       LEFT JOIN role_privileges rp ON rp.role_id = r.id
      WHERE gm.user_id = $1`,
    [userId],
  );
  const privileges = new Set<Privilege>();
  const roles = new Set<string>();
  for (const row of rows) {
    roles.add(row.role_name);
    if (row.privilege) privileges.add(row.privilege as Privilege);
  }
  return { roles: [...roles], privileges };
}

async function loadProjectPrivileges(
  db: SQL,
  userId: string,
): Promise<Map<string, Set<Privilege>>> {
  const grants = await db.unsafe<GrantRow[]>(
    `SELECT pg.project_id, rp.privilege
       FROM project_grants pg
       JOIN role_privileges rp ON rp.role_id = pg.role_id
      WHERE (pg.subject_type = 'user' AND pg.subject_id = $1)
         OR (pg.subject_type = 'group'
             AND pg.subject_id IN (SELECT group_id FROM group_members WHERE user_id = $1))`,
    [userId],
  );
  const owned = await db.unsafe<{ project_id: string; privilege: string }[]>(
    `SELECT p.id AS project_id, rp.privilege
       FROM projects p
       JOIN roles r ON r.name = 'owner'
       JOIN role_privileges rp ON rp.role_id = r.id
      WHERE p.owner_id = $1`,
    [userId],
  );
  const map = new Map<string, Set<Privilege>>();
  for (const row of [...grants, ...owned]) {
    const set = map.get(row.project_id) ?? new Set<Privilege>();
    set.add(row.privilege as Privilege);
    map.set(row.project_id, set);
  }
  return map;
}

/** Resolve a session token or API key into a principal. Never throws. */
export async function resolveAuth(db: SQL, credentials: Credentials): Promise<AuthInfo> {
  if (credentials.apiKey) {
    const rows = await db.unsafe<ApiKeyRow[]>(
      `SELECT id, user_id, scopes, project_ids, expires_at, revoked_at FROM api_keys WHERE key_hash = $1`,
      [sha256Hex(credentials.apiKey)],
    );
    const key = rows[0];
    if (!key) return anonymousAuth();
    if (key.revoked_at || (key.expires_at && key.expires_at.getTime() < Date.now()))
      return anonymousAuth();

    const users = await db.unsafe<UserRow[]>(
      'SELECT id, username, display_name, is_active FROM users WHERE id = $1',
      [key.user_id],
    );
    const user = users[0];
    if (!user?.is_active) return anonymousAuth();

    const { roles, privileges } = await loadUserPrivileges(db, user.id);
    const projectPrivileges = await loadProjectPrivileges(db, user.id);
    void db
      .unsafe(
        "UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 hour')",
        [key.id],
      )
      .catch(() => undefined);

    return {
      type: 'apikey',
      user: toUser(user),
      globalPrivileges: privileges,
      projectPrivileges,
      isAdmin: roles.includes('admin'),
      sessionId: null,
      apiKey: {
        id: key.id,
        scopes: new Set((key.scopes ?? []) as Privilege[]),
        projectIds: key.project_ids ?? [],
      },
    };
  }

  if (credentials.sessionToken) {
    const rows = await db.unsafe<SessionRow[]>(
      `SELECT s.id AS session_id, s.expires_at,
              u.id, u.username, u.display_name, u.is_active
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [sha256Hex(credentials.sessionToken)],
    );
    const row = rows[0];
    if (!row) return anonymousAuth();
    if (row.expires_at.getTime() < Date.now() || !row.is_active) return anonymousAuth();

    const { roles, privileges } = await loadUserPrivileges(db, row.id);
    const projectPrivileges = await loadProjectPrivileges(db, row.id);
    void db
      .unsafe(
        "UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'",
        [row.session_id],
      )
      .catch(() => undefined);

    return {
      type: 'session',
      user: toUser(row),
      globalPrivileges: privileges,
      projectPrivileges,
      isAdmin: roles.includes('admin'),
      sessionId: row.session_id,
      apiKey: null,
    };
  }

  return anonymousAuth();
}

function toUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
  };
}

/**
 * Effective privileges: global roles, plus granted project roles, intersected
 * with an API key's scopes when the principal is a key.
 */
export function hasPrivilege(
  auth: AuthInfo,
  privilege: Privilege,
  projectId: string | null,
): boolean {
  if (!auth.user) return false;
  if (auth.apiKey && !auth.apiKey.scopes.has(privilege)) return false;
  if (
    auth.apiKey &&
    projectId &&
    auth.apiKey.projectIds.length > 0 &&
    !auth.apiKey.projectIds.includes(projectId)
  ) {
    return false;
  }
  if (auth.isAdmin) return true;
  if (auth.globalPrivileges.has(privilege)) return true;
  if (projectId) {
    const scoped = auth.projectPrivileges.get(projectId);
    if (scoped?.has(privilege)) return true;
  }
  return false;
}
