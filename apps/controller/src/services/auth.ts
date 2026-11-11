/** Sessions, passwords, API keys, and cookie handling. */

import type { ApiKeyRow, SessionRow } from '@netlabor/contract';
import { AppError } from '@netlabor/contract';
import { generateApiKey, newId, randomToken, sha256Hex } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { ControllerConfig } from '../config.ts';
import { isSecureOrigin } from '../config.ts';

const MIN_PASSWORD_LENGTH = 12;

export interface SessionCreated {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function verifyCredentials(
  db: SQL,
  username: string,
  password: string,
): Promise<{
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: Date;
}> {
  const rows = await db.unsafe<
    {
      id: string;
      username: string;
      email: string | null;
      display_name: string | null;
      is_active: boolean;
      created_at: Date;
      password_hash: string | null;
    }[]
  >(
    'SELECT id, username, email, display_name, is_active, created_at, password_hash FROM users WHERE username = $1',
    [username.toLowerCase()],
  );
  const user = rows[0];
  if (!user?.password_hash) throw new AppError('UNAUTHORIZED', 'invalid username or password');
  const ok = await Bun.password.verify(password, user.password_hash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'invalid username or password');
  if (!user.is_active) throw new AppError('FORBIDDEN', 'account is disabled');
  return user;
}

export async function createSession(
  db: SQL,
  config: ControllerConfig,
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SessionCreated> {
  const token = randomToken(32);
  const sessionId = newId();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  await db.unsafe(
    `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, sha256Hex(token), meta.ip, meta.userAgent, expiresAt],
  );
  return { token, sessionId, expiresAt };
}

export function sessionCookie(token: string, config: ControllerConfig, expiresAt: Date): string {
  const parts = [
    `nb_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isSecureOrigin(config)) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(config: ControllerConfig): string {
  const parts = ['nb_session=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isSecureOrigin(config)) parts.push('Secure');
  return parts.join('; ');
}

export async function deleteSession(db: SQL, sessionId: string): Promise<void> {
  await db.unsafe('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function changePassword(
  db: SQL,
  userId: string,
  current: string,
  next: string,
): Promise<void> {
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      'BAD_REQUEST',
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  const rows = await db.unsafe<{ password_hash: string | null }[]>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );
  const hash = rows[0]?.password_hash;
  if (!hash) throw new AppError('BAD_REQUEST', 'this account has no local password');
  if (!(await Bun.password.verify(current, hash))) {
    throw new AppError('UNAUTHORIZED', 'current password is wrong');
  }
  const nextHash = await Bun.password.hash(next, { algorithm: 'argon2id' });
  await db.unsafe('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
    userId,
    nextHash,
  ]);
  // Other sessions are invalidated by a password change.
  await db.unsafe('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function listSessions(
  db: SQL,
  userId: string,
  currentSessionId: string | null,
): Promise<SessionRow[]> {
  const rows = await db.unsafe<
    {
      id: string;
      ip: string | null;
      user_agent: string | null;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }[]
  >(
    `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
       FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    current: row.id === currentSessionId,
  }));
}

export async function listApiKeys(db: SQL, userId: string): Promise<ApiKeyRow[]> {
  const rows = await db.unsafe<
    {
      id: string;
      name: string;
      prefix: string;
      scopes: string[] | null;
      project_ids: string[] | null;
      created_at: Date;
      expires_at: Date | null;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }[]
  >(
    `SELECT id, name, prefix, scopes, project_ids, created_at, expires_at, last_used_at, revoked_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: (row.scopes ?? []) as ApiKeyRow['scopes'],
    projectIds: row.project_ids ?? [],
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  }));
}

export async function createApiKey(
  db: SQL,
  userId: string,
  input: { name: string; scopes: ApiKeyRow['scopes']; projectIds?: string[]; expiresAt?: string },
): Promise<{ key: ApiKeyRow; plaintext: string }> {
  const material = generateApiKey();
  const id = newId();
  const rows = await db.unsafe<{ created_at: Date; expires_at: Date | null }[]>(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, project_ids, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8)
     RETURNING created_at, expires_at`,
    [
      id,
      userId,
      input.name,
      material.prefix,
      material.hash,
      input.scopes,
      input.projectIds ?? [],
      input.expiresAt ? new Date(input.expiresAt) : null,
    ],
  );
  return {
    key: {
      id,
      name: input.name,
      prefix: material.prefix,
      scopes: input.scopes,
      projectIds: input.projectIds ?? [],
      createdAt: (rows[0]?.created_at ?? new Date()).toISOString(),
      expiresAt: rows[0]?.expires_at?.toISOString() ?? null,
      lastUsedAt: null,
      revokedAt: null,
    },
    plaintext: material.plaintext,
  };
}

export async function revokeApiKey(db: SQL, userId: string, id: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>(
    'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [id, userId],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'API key not found');
}
