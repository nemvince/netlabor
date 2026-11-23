/** User, group, role, and grant administration routes. */

import { AppError } from '@netlabor/contract';
import { hasPrivilege } from '../auth/principal.ts';
import type { Context } from '../context.ts';
import type { Implementer } from '../implementer.ts';
import {
  createGrant,
  createRole,
  deleteGrant,
  deleteGroup,
  deleteRole,
  listGrants,
  listGroupMembers,
  listGroups,
  listRoles,
  setRolePrivileges,
  updateRole,
  upsertGroup,
} from '../services/rbac.ts';
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  lookupUsers,
  setUserPassword,
  updateUser,
} from '../services/users.ts';

function groupActor(context: Context): {
  userId: string;
  canManageAll: boolean;
  canAssignRoles: boolean;
} {
  const userId = context.auth.user?.id;
  if (!userId) throw new AppError('UNAUTHORIZED', 'authentication required');
  if (context.auth.pending) throw new AppError('FORBIDDEN', 'account is awaiting approval');
  const canManage = hasPrivilege(context.auth, 'user.write', null);
  return { userId, canManageAll: canManage, canAssignRoles: canManage };
}

export function userRoutes(os: Implementer) {
  return {
    users: {
      list: os.users.list.handler(async ({ input, context }) =>
        listUsers(context.db, {
          ...(input.search ? { search: input.search } : {}),
          limit: input.limit,
          offset: input.offset,
        }),
      ),
      get: os.users.get.handler(async ({ input, context }) => getUser(context.db, input.id)),
      create: os.users.create.handler(async ({ input, context }) =>
        createUser(context.db, {
          username: input.username,
          password: input.password,
          email: input.email ?? null,
          displayName: input.displayName ?? null,
          isActive: input.isActive,
          roleIds: input.roleIds,
          groupIds: input.groupIds,
        }),
      ),
      update: os.users.update.handler(async ({ input, context }) =>
        updateUser(context.db, {
          id: input.id,
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.roleIds !== undefined ? { roleIds: input.roleIds } : {}),
          ...(input.groupIds !== undefined ? { groupIds: input.groupIds } : {}),
        }),
      ),
      delete: os.users.delete.handler(async ({ input, context }) => {
        await deleteUser(context.db, input.id);
        return { ok: true as const };
      }),
      setPassword: os.users.setPassword.handler(async ({ input, context }) => {
        await setUserPassword(context.db, input.id, input.password);
        return { ok: true as const };
      }),
      lookup: os.users.lookup.handler(async ({ input, context }) => lookupUsers(context.db, input)),
    },

    groups: {
      list: os.groups.list.handler(async ({ context }) => listGroups(context.db)),
      create: os.groups.create.handler(async ({ input, context }) =>
        upsertGroup(context.db, groupActor(context), {
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.memberIds ? { memberIds: input.memberIds } : {}),
          ...(input.roleIds ? { roleIds: input.roleIds } : {}),
        }),
      ),
      update: os.groups.update.handler(async ({ input, context }) =>
        upsertGroup(context.db, groupActor(context), {
          id: input.id,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.memberIds ? { memberIds: input.memberIds } : {}),
          ...(input.roleIds ? { roleIds: input.roleIds } : {}),
        }),
      ),
      delete: os.groups.delete.handler(async ({ input, context }) => {
        await deleteGroup(context.db, groupActor(context), input.id);
        return { ok: true as const };
      }),
      members: os.groups.members.handler(async ({ input, context }) =>
        listGroupMembers(context.db, groupActor(context), input.id),
      ),
    },

    roles: {
      list: os.roles.list.handler(async ({ context }) => listRoles(context.db)),
      create: os.roles.create.handler(async ({ input, context }) =>
        createRole(context.db, {
          name: input.name,
          description: input.description ?? null,
          privileges: input.privileges,
        }),
      ),
      update: os.roles.update.handler(async ({ input, context }) =>
        updateRole(context.db, {
          id: input.id,
          name: input.name,
          description: input.description ?? null,
          privileges: input.privileges,
        }),
      ),
      delete: os.roles.delete.handler(async ({ input, context }) => {
        await deleteRole(context.db, input.id);
        return { ok: true as const };
      }),
      setPrivileges: os.roles.setPrivileges.handler(async ({ input, context }) =>
        setRolePrivileges(context.db, input.roleId, input.privileges),
      ),
    },

    grants: {
      list: os.grants.list.handler(async ({ input, context }) =>
        listGrants(context.db, input.projectId),
      ),
      create: os.grants.create.handler(async ({ input, context }) => {
        const roles = await listRoles(context.db);
        const role = roles.find((entry) => entry.id === input.roleId);
        if (!role) throw new AppError('NOT_FOUND', 'role not found');
        if (role.name === 'admin')
          throw new AppError('BAD_REQUEST', 'admin cannot be granted per project');
        return createGrant(context.db, input);
      }),
      delete: os.grants.delete.handler(async ({ input, context }) => {
        await deleteGrant(context.db, input.projectId, input.id);
        return { ok: true as const };
      }),
    },
  };
}
