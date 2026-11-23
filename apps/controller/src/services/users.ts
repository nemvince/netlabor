/** User administration. */

import type { UserRow } from '@netlabor/contract';
import { AppError } from '@netlabor/contract';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';

interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: Date;
}

async function loadRolesAndGroups(
  db: SQL,
  userIds: string[],
): Promise<{
  roles: Map<string, { id: string; name: string }[]>;
  groups: Map<string, { id: string; name: string }[]>;
}> {
  const roles = new Map<string, { id: string; name: string }[]>();
  const groups = new Map<string, { id: string; name: string }[]>();
  if (userIds.length === 0) return { roles, groups };

  const roleRows = await db.unsafe<{ user_id: string; id: string; name: string }[]>(
    `SELECT ur.user_id, r.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ANY($1::uuid[])`,
    [userIds],
  );
  for (const row of roleRows) {
    const list = roles.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name });
    roles.set(row.user_id, list);
  }

  const groupRows = await db.unsafe<{ user_id: string; id: string; name: string }[]>(
    `SELECT gm.user_id, g.id, g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = ANY($1::uuid[])`,
    [userIds],
  );
  for (const row of groupRows) {
    const list = groups.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name });
    groups.set(row.user_id, list);
  }
  return { roles, groups };
}

function toUserRow(
  record: UserRecord,
  roles: { id: string; name: string }[],
  groups: { id: string; name: string }[],
): UserRow {
  return {
    id: record.id,
    username: record.username,
    email: record.email,
    displayName: record.display_name,
    isActive: record.is_active,
    createdAt: record.created_at.toISOString(),
    roles,
    groups,
  };
}

export async function listUsers(
  db: SQL,
  options: { search?: string; limit: number; offset: number },
): Promise<UserRow[]> {
  const records = await db.unsafe<UserRecord[]>(
    `SELECT id, username, email, display_name, is_active, created_at
       FROM users
      WHERE ($1::text IS NULL OR username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')
      ORDER BY username ASC LIMIT $2 OFFSET $3`,
    [options.search ?? null, options.limit, options.offset],
  );
  const { roles, groups } = await loadRolesAndGroups(
    db,
    records.map((record) => record.id),
  );
  return records.map((record) =>
    toUserRow(record, roles.get(record.id) ?? [], groups.get(record.id) ?? []),
  );
}

export async function getUser(db: SQL, id: string): Promise<UserRow> {
  const records = await db.unsafe<UserRecord[]>(
    'SELECT id, username, email, display_name, is_active, created_at FROM users WHERE id = $1',
    [id],
  );
  const record = records[0];
  if (!record) throw new AppError('NOT_FOUND', 'user not found');
  const { roles, groups } = await loadRolesAndGroups(db, [record.id]);
  return toUserRow(record, roles.get(record.id) ?? [], groups.get(record.id) ?? []);
}

async function replaceRoles(db: SQL, userId: string, roleIds: string[]): Promise<void> {
  await db.unsafe('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  for (const roleId of roleIds) {
    await db.unsafe(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, roleId],
    );
  }
}

/** `pending` is a waiting room, not a role to combine with real ones. */
async function exclusivePendingRole(db: SQL, roleIds: string[]): Promise<string[]> {
  if (roleIds.length < 2) return roleIds;
  const rows = await db.unsafe<{ id: string }[]>("SELECT id FROM roles WHERE name = 'pending'");
  const pending = rows[0]?.id;
  return pending ? roleIds.filter((id) => id !== pending) : roleIds;
}

async function replaceGroups(db: SQL, userId: string, groupIds: string[]): Promise<void> {
  await db.unsafe('DELETE FROM group_members WHERE user_id = $1', [userId]);
  for (const groupId of groupIds) {
    await db.unsafe(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [groupId, userId],
    );
  }
}

export async function createUser(
  db: SQL,
  input: {
    username: string;
    password: string;
    email?: string | null;
    displayName?: string | null;
    isActive: boolean;
    roleIds: string[];
    groupIds: string[];
  },
): Promise<UserRow> {
  if (input.password.length < 12)
    throw new AppError('BAD_REQUEST', 'password must be at least 12 characters');
  const username = input.username.toLowerCase();
  const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM users WHERE username = $1', [
    username,
  ]);
  if (existing[0]) throw new AppError('CONFLICT', 'username already exists');

  const id = newId();
  const passwordHash = await Bun.password.hash(input.password, { algorithm: 'argon2id' });
  const roleIds = await exclusivePendingRole(db, input.roleIds);
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe(
      `INSERT INTO users (id, username, email, display_name, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, input.email ?? null, input.displayName ?? null, passwordHash, input.isActive],
    );
    await replaceRoles(sql, id, roleIds);
    await replaceGroups(sql, id, input.groupIds);
  });
  return getUser(db, id);
}

export async function updateUser(
  db: SQL,
  input: {
    id: string;
    email?: string | null;
    displayName?: string | null;
    isActive?: boolean;
    roleIds?: string[];
    groupIds?: string[];
  },
): Promise<UserRow> {
  const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM users WHERE id = $1', [
    input.id,
  ]);
  if (!existing[0]) throw new AppError('NOT_FOUND', 'user not found');
  const roleIds =
    input.roleIds === undefined ? undefined : await exclusivePendingRole(db, input.roleIds);

  await db.begin(async (tx) => {
    const sql = tx as SQL;
    if (input.email !== undefined) {
      await sql.unsafe('UPDATE users SET email = $2, updated_at = now() WHERE id = $1', [
        input.id,
        input.email,
      ]);
    }
    if (input.displayName !== undefined) {
      await sql.unsafe('UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1', [
        input.id,
        input.displayName,
      ]);
    }
    if (input.isActive !== undefined) {
      await sql.unsafe('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [
        input.id,
        input.isActive,
      ]);
      if (!input.isActive) await sql.unsafe('DELETE FROM sessions WHERE user_id = $1', [input.id]);
    }
    if (roleIds !== undefined) await replaceRoles(sql, input.id, roleIds);
    if (input.groupIds !== undefined) await replaceGroups(sql, input.id, input.groupIds);
  });
  return getUser(db, input.id);
}

export async function deleteUser(db: SQL, id: string): Promise<void> {
  const owned = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM projects WHERE owner_id = $1 LIMIT 1',
    [id],
  );
  if (owned[0]) {
    throw new AppError('CONFLICT', 'user owns projects; transfer ownership first');
  }
  const rows = await db.unsafe<{ id: string }[]>('DELETE FROM users WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'user not found');
}

/** Active accounts only; this is the directory other users can invite from. */
export async function lookupUsers(
  db: SQL,
  input: { search?: string; limit: number },
): Promise<Array<{ id: string; username: string; displayName: string | null }>> {
  const rows = await db.unsafe<{ id: string; username: string; display_name: string | null }[]>(
    `SELECT id, username, display_name FROM users
      WHERE is_active = true
        AND ($1::text IS NULL OR username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')
      ORDER BY display_name NULLS LAST, username ASC
      LIMIT $2`,
    [input.search ?? null, input.limit],
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  }));
}

export async function setUserPassword(db: SQL, id: string, password: string): Promise<void> {
  if (password.length < 12)
    throw new AppError('BAD_REQUEST', 'password must be at least 12 characters');
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  const rows = await db.unsafe<{ id: string }[]>(
    'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id',
    [id, hash],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'user not found');
  await db.unsafe('DELETE FROM sessions WHERE user_id = $1', [id]);
}
