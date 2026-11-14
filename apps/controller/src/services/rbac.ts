/** Roles, groups, project grants, audit rows, and settings. */

import type { AuditRow, GrantRow, GroupRow, RoleRow, SettingsPatch } from '@netlabor/contract';
import { AppError, GLOBAL_ROLE_NAMES } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';

/* ------------------------------------------------------------------ roles --- */

export async function listRoles(db: SQL): Promise<RoleRow[]> {
  const rows = await db.unsafe<
    {
      id: string;
      name: string;
      description: string | null;
      builtin: boolean;
      created_at: Date;
      privileges: string[] | null;
    }[]
  >(
    `SELECT r.id, r.name, r.description, r.builtin, r.created_at,
            COALESCE(array_agg(rp.privilege ORDER BY rp.privilege) FILTER (WHERE rp.privilege IS NOT NULL), '{}') AS privileges
       FROM roles r LEFT JOIN role_privileges rp ON rp.role_id = r.id
      GROUP BY r.id ORDER BY r.builtin DESC, r.name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    builtin: row.builtin,
    privileges: (row.privileges ?? []) as RoleRow['privileges'],
    createdAt: row.created_at.toISOString(),
  }));
}

async function getRole(db: SQL, id: string): Promise<RoleRow> {
  const all = await listRoles(db);
  const role = all.find((entry) => entry.id === id);
  if (!role) throw new AppError('NOT_FOUND', 'role not found');
  return role;
}

export async function createRole(
  db: SQL,
  input: { name: string; description?: string | null; privileges: string[] },
): Promise<RoleRow> {
  const id = newId();
  const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM roles WHERE name = $1', [
    input.name,
  ]);
  if (existing[0]) throw new AppError('CONFLICT', 'role name already exists');
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe(
      'INSERT INTO roles (id, name, description, builtin) VALUES ($1, $2, $3, false)',
      [id, input.name, input.description ?? null],
    );
    for (const privilege of input.privileges) {
      await sql.unsafe(
        'INSERT INTO role_privileges (role_id, privilege) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, privilege],
      );
    }
  });
  return getRole(db, id);
}

export async function updateRole(
  db: SQL,
  input: { id: string; name: string; description?: string | null; privileges: string[] },
): Promise<RoleRow> {
  const rows = await db.unsafe<{ builtin: boolean }[]>('SELECT builtin FROM roles WHERE id = $1', [
    input.id,
  ]);
  const role = rows[0];
  if (!role) throw new AppError('NOT_FOUND', 'role not found');
  if (role.builtin) throw new AppError('CONFLICT', 'built-in roles cannot be modified');
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe('UPDATE roles SET name = $2, description = $3 WHERE id = $1', [
      input.id,
      input.name,
      input.description ?? null,
    ]);
    await sql.unsafe('DELETE FROM role_privileges WHERE role_id = $1', [input.id]);
    for (const privilege of input.privileges) {
      await sql.unsafe(
        'INSERT INTO role_privileges (role_id, privilege) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [input.id, privilege],
      );
    }
  });
  return getRole(db, input.id);
}

export async function deleteRole(db: SQL, id: string): Promise<void> {
  const rows = await db.unsafe<{ builtin: boolean; name: string }[]>(
    'SELECT builtin, name FROM roles WHERE id = $1',
    [id],
  );
  const role = rows[0];
  if (!role) throw new AppError('NOT_FOUND', 'role not found');
  if (role.builtin) throw new AppError('CONFLICT', 'built-in roles cannot be deleted');
  await db.unsafe('DELETE FROM roles WHERE id = $1', [id]);
}

export async function setRolePrivileges(
  db: SQL,
  roleId: string,
  privileges: string[],
): Promise<RoleRow> {
  const rows = await db.unsafe<{ builtin: boolean }[]>('SELECT builtin FROM roles WHERE id = $1', [
    roleId,
  ]);
  const role = rows[0];
  if (!role) throw new AppError('NOT_FOUND', 'role not found');
  if (role.builtin) throw new AppError('CONFLICT', 'built-in roles cannot be modified');
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe('DELETE FROM role_privileges WHERE role_id = $1', [roleId]);
    for (const privilege of privileges) {
      await sql.unsafe(
        'INSERT INTO role_privileges (role_id, privilege) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [roleId, privilege],
      );
    }
  });
  return getRole(db, roleId);
}

export function assertGlobalRoleAssignable(roleName: string): void {
  if (!GLOBAL_ROLE_NAMES.includes(roleName as (typeof GLOBAL_ROLE_NAMES)[number])) {
    throw new AppError('BAD_REQUEST', `role ${roleName} cannot be assigned globally`);
  }
}

/* ----------------------------------------------------------------- groups --- */

export async function listGroups(db: SQL): Promise<GroupRow[]> {
  const rows = await db.unsafe<
    {
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      member_count: string;
      roles: { id: string; name: string }[] | null;
    }[]
  >(
    `SELECT g.id, g.name, g.description, g.created_at,
            (SELECT count(*) FROM group_members gm WHERE gm.group_id = g.id)::text AS member_count,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
                        FROM group_roles gr JOIN roles r ON r.id = gr.role_id WHERE gr.group_id = g.id), '[]'::json) AS roles
       FROM groups g ORDER BY g.name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    memberCount: Number(row.member_count),
    roles: row.roles ?? [],
  }));
}

async function getGroup(db: SQL, id: string): Promise<GroupRow> {
  const groups = await listGroups(db);
  const group = groups.find((entry) => entry.id === id);
  if (!group) throw new AppError('NOT_FOUND', 'group not found');
  return group;
}

export async function upsertGroup(
  db: SQL,
  input: {
    id?: string;
    name: string;
    description?: string | null;
    memberIds?: string[];
    roleIds?: string[];
  },
): Promise<GroupRow> {
  const id = input.id ?? newId();
  const duplicate = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM groups WHERE name = $1 AND id <> $2',
    [input.name, id],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'group name already exists');

  await db.begin(async (tx) => {
    const sql = tx as SQL;
    if (input.id) {
      const rows = await sql.unsafe<{ id: string }[]>(
        'UPDATE groups SET name = $2, description = $3 WHERE id = $1 RETURNING id',
        [id, input.name, input.description ?? null],
      );
      if (!rows[0]) throw new AppError('NOT_FOUND', 'group not found');
    } else {
      await sql.unsafe('INSERT INTO groups (id, name, description) VALUES ($1, $2, $3)', [
        id,
        input.name,
        input.description ?? null,
      ]);
    }
    if (input.memberIds) {
      await sql.unsafe('DELETE FROM group_members WHERE group_id = $1', [id]);
      for (const userId of input.memberIds) {
        await sql.unsafe(
          'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, userId],
        );
      }
    }
    if (input.roleIds) {
      await sql.unsafe('DELETE FROM group_roles WHERE group_id = $1', [id]);
      for (const roleId of input.roleIds) {
        await sql.unsafe(
          'INSERT INTO group_roles (group_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, roleId],
        );
      }
    }
  });
  return getGroup(db, id);
}

export async function deleteGroup(db: SQL, id: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>('DELETE FROM groups WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'group not found');
  await db.unsafe(`DELETE FROM project_grants WHERE subject_type = 'group' AND subject_id = $1`, [
    id,
  ]);
}

/* ----------------------------------------------------------------- grants --- */

export async function listGrants(db: SQL, projectId: string): Promise<GrantRow[]> {
  const rows = await db.unsafe<
    {
      id: string;
      project_id: string;
      subject_type: 'user' | 'group';
      subject_id: string;
      subject_name: string | null;
      role_id: string;
      role_name: string;
      created_at: Date;
    }[]
  >(
    `SELECT gr.id, gr.project_id, gr.subject_type, gr.subject_id,
            CASE WHEN gr.subject_type = 'user' THEN u.username ELSE g.name END AS subject_name,
            gr.role_id, r.name AS role_name, gr.created_at
       FROM project_grants gr
       JOIN roles r ON r.id = gr.role_id
       LEFT JOIN users u ON gr.subject_type = 'user' AND u.id = gr.subject_id
       LEFT JOIN groups g ON gr.subject_type = 'group' AND g.id = gr.subject_id
      WHERE gr.project_id = $1 ORDER BY gr.created_at ASC`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectName: row.subject_name ?? row.subject_id,
    roleId: row.role_id,
    roleName: row.role_name,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createGrant(
  db: SQL,
  input: { projectId: string; subjectType: 'user' | 'group'; subjectId: string; roleId: string },
): Promise<GrantRow> {
  const roles = await db.unsafe<{ name: string }[]>('SELECT name FROM roles WHERE id = $1', [
    input.roleId,
  ]);
  if (!roles[0]) throw new AppError('NOT_FOUND', 'role not found');
  const id = newId();
  const rows = await db.unsafe<{ id: string }[]>(
    `INSERT INTO project_grants (id, project_id, subject_type, subject_id, role_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, subject_type, subject_id)
     DO UPDATE SET role_id = EXCLUDED.role_id RETURNING id`,
    [id, input.projectId, input.subjectType, input.subjectId, input.roleId],
  );
  const grants = await listGrants(db, input.projectId);
  const grant = grants.find((entry) => entry.id === rows[0]?.id);
  if (!grant) throw new AppError('INTERNAL', 'grant not found after insert');
  return grant;
}

export async function deleteGrant(db: SQL, projectId: string, id: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>(
    'DELETE FROM project_grants WHERE id = $1 AND project_id = $2 RETURNING id',
    [id, projectId],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'grant not found');
}

/* ------------------------------------------------------------------ audit --- */

export async function listAudit(
  db: SQL,
  filters: {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    projectId?: string;
    userId?: string;
    since?: string;
    limit: number;
    offset: number;
  },
): Promise<AuditRow[]> {
  const rows = await db.unsafe<
    {
      id: string | number;
      user_id: string | null;
      username: string | null;
      action: string;
      resource_type: string;
      resource_id: string | null;
      project_id: string | null;
      data: Record<string, unknown>;
      ip: string | null;
      created_at: Date;
    }[]
  >(
    `SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id, a.project_id, a.data, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ($1::text IS NULL OR a.action = $1)
        AND ($2::text IS NULL OR a.resource_type = $2)
        AND ($3::text IS NULL OR a.resource_id = $3)
        AND ($4::uuid IS NULL OR a.project_id = $4)
        AND ($5::uuid IS NULL OR a.user_id = $5)
        AND ($6::timestamptz IS NULL OR a.created_at >= $6)
      ORDER BY a.id DESC LIMIT $7 OFFSET $8`,
    [
      filters.action ?? null,
      filters.resourceType ?? null,
      filters.resourceId ?? null,
      filters.projectId ?? null,
      filters.userId ?? null,
      filters.since ? new Date(filters.since) : null,
      filters.limit,
      filters.offset,
    ],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id,
    username: row.username,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    projectId: row.project_id,
    data: parseJsonColumn(row.data, {}),
    ip: row.ip,
    createdAt: row.created_at.toISOString(),
  }));
}

/* --------------------------------------------------------------- settings --- */

const DEFAULT_SETTINGS: SettingsPatch = {
  'ui.defaultConsoleRows': 24,
  'ui.defaultConsoleCols': 80,
  'project.autoCloseIdleMinutes': 10,
  'update.channel': 'stable',
};

export async function getSettings(db: SQL): Promise<SettingsPatch> {
  const rows = await db.unsafe<{ key: string; value: unknown }[]>(
    'SELECT key, value FROM settings',
  );
  const out: SettingsPatch = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = parseJsonColumn(row.value, row.value);
  return out;
}

export async function updateSettings(db: SQL, patch: SettingsPatch): Promise<SettingsPatch> {
  for (const [key, value] of Object.entries(patch)) {
    // Bind JSON text: Bun binds JS numbers as int params, and Postgres cannot
    // cast an int parameter to jsonb, so a numeric setting used to 500.
    await db.unsafe(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value ?? null)],
    );
  }
  return getSettings(db);
}

/* ----------------------------------------------------------- preferences --- */

export async function getPreferences(db: SQL, userId: string): Promise<Record<string, unknown>> {
  const rows = await db.unsafe<{ value: Record<string, unknown> }[]>(
    'SELECT value FROM user_preferences WHERE user_id = $1',
    [userId],
  );
  return parseJsonColumn(rows[0]?.value, {});
}

export async function setPreferences(
  db: SQL,
  userId: string,
  value: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await db.unsafe(
    `INSERT INTO user_preferences (user_id, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET value = EXCLUDED.value`,
    [userId, JSON.stringify(value)],
  );
  return value;
}
