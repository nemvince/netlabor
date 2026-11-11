/**
 * Controller startup: advisory lock, migrations, built-in seeding, and
 * first-run admin creation. Runs before the HTTP server starts listening.
 */

import { seedCatalog } from '@netlabor/catalog';
import { BUILTIN_ROLES, type Privilege } from '@netlabor/contract';
import { migrate } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../app.ts';

const ADVISORY_LOCK_KEY = 0x6e65746c;

export class ControllerLockError extends Error {
  constructor() {
    super('another controller instance holds the advisory lock');
    this.name = 'ControllerLockError';
  }
}

export async function acquireControllerLock(db: SQL): Promise<() => Promise<void>> {
  const rows = await db.unsafe<{ locked: boolean }[]>('SELECT pg_try_advisory_lock($1) AS locked', [
    ADVISORY_LOCK_KEY,
  ]);
  if (rows[0]?.locked !== true) throw new ControllerLockError();
  return async () => {
    await db.unsafe('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  };
}

async function seedRoles(db: SQL): Promise<void> {
  for (const [name, privileges] of Object.entries(BUILTIN_ROLES)) {
    const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM roles WHERE name = $1', [
      name,
    ]);
    const roleId = existing[0]?.id ?? newId();
    if (!existing[0]) {
      await db.unsafe(
        'INSERT INTO roles (id, name, description, builtin) VALUES ($1, $2, $3, true)',
        [roleId, name, `built-in ${name} role`],
      );
    }
    // Built-in privilege sets are authoritative.
    await db.unsafe('DELETE FROM role_privileges WHERE role_id = $1', [roleId]);
    for (const privilege of privileges as readonly Privilege[]) {
      await db.unsafe(
        'INSERT INTO role_privileges (role_id, privilege) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [roleId, privilege],
      );
    }
  }
}

async function seedAdmin(deps: AppDeps): Promise<void> {
  const { db, config, logger } = deps;
  const users = await db.unsafe<{ count: string }[]>('SELECT count(*)::text AS count FROM users');
  if (Number(users[0]?.count ?? '0') > 0) return;

  const password = config.adminPassword;
  if (!password) {
    logger.warn('no users exist and NB_ADMIN_PASSWORD is unset; local login stays disabled');
    return;
  }
  if (password.length < 12) {
    throw new Error('NB_ADMIN_PASSWORD must be at least 12 characters');
  }
  const roleRows = await db.unsafe<{ id: string }[]>("SELECT id FROM roles WHERE name = 'admin'");
  const adminRoleId = roleRows[0]?.id;
  if (!adminRoleId) throw new Error('admin role missing after seeding');

  const userId = newId();
  const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  await db.begin(async (tx) => {
    const sql = tx as SQL;
    await sql.unsafe(
      'INSERT INTO users (id, username, email, display_name, password_hash, is_active) VALUES ($1, $2, NULL, $3, $4, true)',
      [userId, config.adminUser, 'Administrator', passwordHash],
    );
    await sql.unsafe('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [
      userId,
      adminRoleId,
    ]);
  });
  logger.info('bootstrap administrator created', { username: config.adminUser });
}

export async function bootstrap(deps: AppDeps): Promise<() => Promise<void>> {
  const { db, logger } = deps;
  const releaseLock = await acquireControllerLock(db);
  const result = await migrate(db);
  if (result.applied.length > 0) logger.info('migrations applied', { applied: result.applied });

  await seedRoles(db);
  await seedCatalog(db, { logger });
  await seedAdmin(deps);

  await db.unsafe(
    `UPDATE jobs SET state = 'failed', error = 'controller restarted', updated_at = now() WHERE state = 'running'`,
  );
  await db.unsafe(
    `UPDATE appliance_builds SET status = 'failed', error = 'controller restarted', updated_at = now()
      WHERE status IN ('running', 'queued')`,
  );
  await db.unsafe(`UPDATE computes SET status = 'offline', updated_at = now()`);

  return releaseLock;
}

export async function waitForDatabase(db: SQL, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await db.unsafe('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(1000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('database unavailable');
}
