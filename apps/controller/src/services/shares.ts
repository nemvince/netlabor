/** Share links: create, list, revoke, and redeem read-only lab links. */

import { AppError, type ShareLinkCreated, type ShareLinkRow } from '@netlabor/contract';
import { newId, sha256Hex } from '@netlabor/shared';
import type { SQL } from 'bun';

/** Bearer token: 32 random bytes, URL-safe. */
function newShareToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

function tokenHash(token: string): string {
  return sha256Hex(token);
}

/** Drop expired links and the guest users (and grants, sessions) they own. */
async function sweepExpired(db: SQL): Promise<void> {
  await db.unsafe(
    `DELETE FROM project_grants g USING share_links s
      WHERE g.subject_type = 'user' AND g.subject_id = s.guest_user_id AND s.expires_at < now()`,
  );
  await db.unsafe(
    `DELETE FROM users u USING share_links s
      WHERE u.id = s.guest_user_id AND s.expires_at < now()`,
  );
}

async function deleteGuest(db: SQL, guestUserId: string): Promise<void> {
  await db.unsafe("DELETE FROM project_grants WHERE subject_type = 'user' AND subject_id = $1", [
    guestUserId,
  ]);
  await db.unsafe('DELETE FROM users WHERE id = $1', [guestUserId]);
}

export async function createShareLink(
  db: SQL,
  createdBy: string,
  input: { projectId: string; ttlHours: number },
): Promise<ShareLinkCreated> {
  const role = await db.unsafe<{ id: string }[]>("SELECT id FROM roles WHERE name = 'viewer'");
  const viewerRoleId = role[0]?.id;
  if (!viewerRoleId) throw new AppError('INTERNAL', 'viewer role is missing');
  const project = await db.unsafe<{ id: string }[]>('SELECT id FROM projects WHERE id = $1', [
    input.projectId,
  ]);
  if (!project[0]) throw new AppError('NOT_FOUND', 'project not found');

  const token = newShareToken();
  const guestUserId = newId();
  const linkId = newId();
  const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);
  // An unguessable password keeps the guest account unusable for password login.
  const password = await Bun.password.hash(newShareToken(), { algorithm: 'argon2id' });

  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe(
      `INSERT INTO users (id, username, email, display_name, password_hash, is_active)
       VALUES ($1, $2, NULL, $3, $4, true)`,
      [guestUserId, `share-${guestUserId.slice(-12)}`, 'Shared lab guest', password],
    );
    await sql.unsafe(
      `INSERT INTO project_grants (id, project_id, subject_type, subject_id, role_id)
       VALUES ($1, $2, 'user', $3, $4)`,
      [newId(), input.projectId, guestUserId, viewerRoleId],
    );
    await sql.unsafe(
      `INSERT INTO share_links (id, project_id, token_hash, guest_user_id, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [linkId, input.projectId, tokenHash(token), guestUserId, createdBy, expiresAt],
    );
  });

  return {
    id: linkId,
    token,
    path: `/s/${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function listShareLinks(db: SQL, projectId: string): Promise<ShareLinkRow[]> {
  await sweepExpired(db);
  const rows = await db.unsafe<
    {
      id: string;
      project_id: string;
      project_name: string;
      created_by_name: string | null;
      expires_at: Date;
      created_at: Date;
    }[]
  >(
    `SELECT s.id, s.project_id, p.name AS project_name, u.username AS created_by_name,
            s.expires_at, s.created_at
       FROM share_links s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.project_id = $1 AND s.expires_at > now()
      ORDER BY s.created_at DESC`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    createdByName: row.created_by_name,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function revokeShareLink(db: SQL, projectId: string, id: string): Promise<void> {
  const rows = await db.unsafe<{ guest_user_id: string }[]>(
    'SELECT guest_user_id FROM share_links WHERE id = $1 AND project_id = $2',
    [id, projectId],
  );
  const link = rows[0];
  if (!link) throw new AppError('NOT_FOUND', 'share link not found');
  await deleteGuest(db, link.guest_user_id);
}

/** Resolve a token to its guest user and project; expired links are removed. */
export async function redeemShareLink(
  db: SQL,
  token: string,
): Promise<{ projectId: string; projectName: string; guestUserId: string; expiresAt: Date }> {
  await sweepExpired(db);
  const rows = await db.unsafe<
    { guest_user_id: string; project_id: string; name: string; expires_at: Date }[]
  >(
    `SELECT s.guest_user_id, s.project_id, p.name, s.expires_at
       FROM share_links s JOIN projects p ON p.id = s.project_id
      WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  const link = rows[0];
  if (!link) throw new AppError('NOT_FOUND', 'this share link is invalid or has expired');
  return {
    projectId: link.project_id,
    projectName: link.name,
    guestUserId: link.guest_user_id,
    expiresAt: link.expires_at,
  };
}

/** Clamp a guest session to the link's expiry. */
export async function clampSessionExpiry(
  db: SQL,
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  await db.unsafe('UPDATE sessions SET expires_at = LEAST(expires_at, $2) WHERE id = $1', [
    sessionId,
    expiresAt,
  ]);
}
