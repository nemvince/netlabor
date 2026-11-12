/** Authentication routes: login, sessions, API keys, and public OIDC list. */

import { AppError, type Privilege } from '@netlabor/contract';
import type { SQL } from 'bun';
import type { Context } from '../context.ts';
import type { Implementer } from '../implementer.ts';
import {
  changePassword,
  clearSessionCookie,
  createApiKey,
  createSession,
  deleteSession,
  listApiKeys,
  listSessions,
  revokeApiKey,
  sessionCookie,
  verifyCredentials,
} from '../services/auth.ts';
import { createBootstrapAdmin } from '../services/bootstrap.ts';
import { createProvider, listProviders, updateProvider } from '../services/oidc.ts';
import { getPreferences } from '../services/rbac.ts';

export async function userRoleNames(db: SQL, userId: string): Promise<string[]> {
  const rows = await db.unsafe<{ name: string }[]>(
    `SELECT DISTINCT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1
     UNION
     SELECT DISTINCT r.name FROM group_members gm
       JOIN group_roles gr ON gr.group_id = gm.group_id
       JOIN roles r ON r.id = gr.role_id
      WHERE gm.user_id = $1
     ORDER BY 1`,
    [userId],
  );
  return rows.map((row) => row.name);
}

export async function buildMe(context: Context) {
  const user = context.auth.user;
  if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
  const [roles, grants, preferences] = await Promise.all([
    userRoleNames(context.db, user.id),
    context.db.unsafe<{ project_id: string; name: string }[]>(
      `SELECT gr.project_id, r.name
         FROM project_grants gr JOIN roles r ON r.id = gr.role_id
        WHERE (gr.subject_type = 'user' AND gr.subject_id = $1)
           OR (gr.subject_type = 'group'
               AND gr.subject_id IN (SELECT group_id FROM group_members WHERE user_id = $1))`,
      [user.id],
    ),
    getPreferences(context.db, user.id),
  ]);
  const privileges = new Set<Privilege>(context.auth.globalPrivileges);
  for (const scoped of context.auth.projectPrivileges.values()) {
    for (const privilege of scoped) privileges.add(privilege);
  }
  return {
    id: user.id,
    username: user.username,
    email: null,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: new Date(0).toISOString(),
    roles,
    privileges: [...privileges].sort(),
    projectGrants: grants.map((grant) => ({ projectId: grant.project_id, role: grant.name })),
    preferences,
  };
}

export function authRoutes(os: Implementer) {
  return {
    setup: {
      status: os.auth.setup.status.handler(async ({ context }) => {
        const rows = await context.db.unsafe<{ count: string }[]>(
          'SELECT count(*)::text AS count FROM users',
        );
        return { needsSetup: Number(rows[0]?.count ?? '0') === 0 };
      }),
      createAdmin: os.auth.setup.createAdmin.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<{ count: string }[]>(
          'SELECT count(*)::text AS count FROM users',
        );
        if (Number(rows[0]?.count ?? '0') > 0) {
          throw new AppError('FORBIDDEN', 'setup is already completed');
        }
        const username = input.username.toLowerCase();
        const userId = await createBootstrapAdmin(context.db, username, input.password);
        const session = await createSession(context.db, context.config, userId, {
          ip: context.request.ip,
          userAgent: context.request.userAgent,
        });
        context.resHeaders.append(
          'set-cookie',
          sessionCookie(session.token, context.config, session.expiresAt),
        );
        await context.events.publish({
          type: 'log',
          userId,
          payload: { action: 'auth.setup', username },
        });
        const created = await context.db.unsafe<
          {
            id: string;
            username: string;
            is_active: boolean;
            created_at: Date;
          }[]
        >('SELECT id, username, is_active, created_at FROM users WHERE id = $1', [userId]);
        const user = created[0];
        if (!user) throw new AppError('INTERNAL', 'admin creation failed');
        return {
          user: {
            id: user.id,
            username: user.username,
            email: null,
            displayName: 'Administrator',
            isActive: user.is_active,
            createdAt: user.created_at.toISOString(),
          },
          expiresAt: session.expiresAt.toISOString(),
        };
      }),
    },

    login: os.auth.login.handler(async ({ input, context }) => {
      const user = await verifyCredentials(context.db, input.username, input.password);
      const session = await createSession(context.db, context.config, user.id, {
        ip: context.request.ip,
        userAgent: context.request.userAgent,
      });
      context.resHeaders.append(
        'set-cookie',
        sessionCookie(session.token, context.config, session.expiresAt),
      );
      await context.events.publish({
        type: 'log',
        userId: user.id,
        payload: { action: 'auth.login', username: user.username },
      });
      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
          isActive: user.is_active,
          createdAt: user.created_at.toISOString(),
        },
        expiresAt: session.expiresAt.toISOString(),
      };
    }),

    logout: os.auth.logout.handler(async ({ context }) => {
      if (context.auth.sessionId) await deleteSession(context.db, context.auth.sessionId);
      context.resHeaders.append('set-cookie', clearSessionCookie(context.config));
      return { ok: true as const };
    }),

    me: os.auth.me.handler(async ({ context }) => buildMe(context)),

    password: {
      change: os.auth.password.change.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await changePassword(context.db, user.id, input.current, input.next);
        context.resHeaders.append('set-cookie', clearSessionCookie(context.config));
        return { ok: true as const };
      }),
    },

    sessions: {
      list: os.auth.sessions.list.handler(async ({ context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return listSessions(context.db, user.id, context.auth.sessionId);
      }),
      revoke: os.auth.sessions.revoke.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        const rows = await context.db.unsafe<{ id: string }[]>(
          'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
          [input.id, user.id],
        );
        if (!rows[0]) throw new AppError('NOT_FOUND', 'session not found');
        return { ok: true as const };
      }),
    },

    apiKeys: {
      list: os.auth.apiKeys.list.handler(async ({ context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return listApiKeys(context.db, user.id);
      }),
      create: os.auth.apiKeys.create.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        // A key can never exceed its owner's current privileges.
        const excessive = input.scopes.filter((scope) => !context.auth.globalPrivileges.has(scope));
        if (!context.auth.isAdmin && excessive.length > 0) {
          throw new AppError('BAD_REQUEST', 'key scopes exceed the user privileges', {
            details: excessive,
          });
        }
        return createApiKey(context.db, user.id, {
          name: input.name,
          scopes: input.scopes,
          ...(input.projectIds ? { projectIds: input.projectIds } : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        });
      }),
      revoke: os.auth.apiKeys.revoke.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await revokeApiKey(context.db, user.id, input.id);
        return { ok: true as const };
      }),
    },

    oidc: {
      publicProviders: os.auth.oidc.publicProviders.handler(async ({ context }) => {
        const rows = await context.db.unsafe<{ id: string; name: string }[]>(
          'SELECT id, name FROM oidc_providers WHERE enabled = true ORDER BY name ASC',
        );
        return rows;
      }),
      list: os.auth.oidc.list.handler(async ({ context }) => listProviders(context.db)),
      create: os.auth.oidc.create.handler(async ({ input, context }) =>
        createProvider(context.db, context.config, input),
      ),
      update: os.auth.oidc.update.handler(async ({ input, context }) =>
        updateProvider(context.db, context.config, input),
      ),
      delete: os.auth.oidc.delete.handler(async ({ input, context }) => {
        await context.db.unsafe('DELETE FROM oidc_providers WHERE id = $1', [input.id]);
        return { ok: true as const };
      }),
      identities: os.auth.oidc.identities.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<
          { provider_id: string; provider_name: string; subject: string; email: string | null }[]
        >(
          `SELECT ui.provider_id, p.name AS provider_name, ui.subject, ui.email
             FROM user_identities ui JOIN oidc_providers p ON p.id = ui.provider_id
            WHERE ui.user_id = $1 ORDER BY p.name ASC`,
          [input.userId],
        );
        return rows.map((row) => ({
          providerId: row.provider_id,
          providerName: row.provider_name,
          subject: row.subject,
          email: row.email,
        }));
      }),
    },
  };
}
