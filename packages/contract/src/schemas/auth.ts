/** Authentication, sessions, API keys, OIDC providers, and preferences. */

import { z } from 'zod';
import { BUILTIN_ROLES, GLOBAL_ROLE_NAMES, PRIVILEGES, ROLE_NAMES } from '../authz.ts';
import { Id, Timestamp } from './common.ts';

export const PublicUser = z.object({
  id: Id,
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: Timestamp,
});
export type PublicUser = z.infer<typeof PublicUser>;

export const LoginInput = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const LoginOutput = z.object({
  user: PublicUser,
  expiresAt: Timestamp,
});

export const MeOutput = PublicUser.extend({
  roles: z.array(z.string()),
  privileges: z.array(z.enum(PRIVILEGES)),
  projectGrants: z.array(
    z.object({
      projectId: Id,
      role: z.string(),
    }),
  ),
  preferences: z.record(z.string(), z.unknown()),
});
export type MeOutput = z.infer<typeof MeOutput>;

export const ChangePasswordInput = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(12).max(256),
});

export const SessionRow = z.object({
  id: Id,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  expiresAt: Timestamp,
  current: z.boolean(),
});
export type SessionRow = z.infer<typeof SessionRow>;

export const ApiKeyRow = z.object({
  id: Id,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(PRIVILEGES)),
  projectIds: z.array(Id),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  lastUsedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
});
export type ApiKeyRow = z.infer<typeof ApiKeyRow>;

export const ApiKeyCreateInput = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.enum(PRIVILEGES)).min(1),
  projectIds: z.array(Id).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export const ApiKeyCreated = z.object({
  key: ApiKeyRow,
  plaintext: z.string(),
});

export const OidcProviderRow = z.object({
  id: Id,
  name: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  scopes: z.array(z.string()),
  groupClaim: z.string(),
  groupMappings: z.record(z.string(), z.string()),
  defaultRoleId: Id.nullable(),
  autoCreate: z.boolean(),
  enabled: z.boolean(),
  createdAt: Timestamp,
});
export type OidcProviderRow = z.infer<typeof OidcProviderRow>;

export const OidcProviderInput = z.object({
  name: z.string().min(1).max(64),
  issuer: z.url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
  groupClaim: z.string().default('groups'),
  groupMappings: z.record(z.string(), z.string()).default({}),
  defaultRoleId: Id.nullable().optional(),
  autoCreate: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type OidcProviderInput = z.infer<typeof OidcProviderInput>;

export const OidcPublicProvider = z.object({ id: Id, name: z.string() });

export const PreferencesInput = z.object({ value: z.record(z.string(), z.unknown()) });

/** First-run setup state: true while no user accounts exist. */
export const SetupStatus = z.object({ needsSetup: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatus>;

/* ---------------------------------------------------------------- users --- */

export const UserRow = PublicUser.extend({
  roles: z.array(z.object({ id: Id, name: z.string() })),
  groups: z.array(z.object({ id: Id, name: z.string() })),
});
export type UserRow = z.infer<typeof UserRow>;

export const UserCreateInput = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'lowercase letters, digits, dot, dash, underscore only'),
  password: z.string().min(12).max(256),
  email: z.string().email().nullable().optional(),
  displayName: z.string().max(128).nullable().optional(),
  isActive: z.boolean().default(true),
  roleIds: z.array(Id).default([]),
  groupIds: z.array(Id).default([]),
});

/** Claim the first admin account; only valid while no users exist. */
export const SetupAdminInput = z.object({
  username: UserCreateInput.shape.username,
  password: z.string().min(12).max(256),
});
export type SetupAdminInput = z.infer<typeof SetupAdminInput>;

export const UserUpdateInput = z.object({
  id: Id,
  email: z.string().email().nullable().optional(),
  displayName: z.string().max(128).nullable().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(Id).optional(),
  groupIds: z.array(Id).optional(),
});

export const SetPasswordInput = z.object({ id: Id, password: z.string().min(12).max(256) });

export const UserListInput = z.object({
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const GroupRow = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  ownerId: Id.nullable(),
  ownerName: z.string().nullable(),
  createdAt: Timestamp,
  memberCount: z.number().int(),
  roles: z.array(z.object({ id: Id, name: z.string() })),
});
export type GroupRow = z.infer<typeof GroupRow>;

/** Minimal user directory used by self-service groups and project grants. */
export const DirectoryUser = z.object({
  id: Id,
  username: z.string(),
  displayName: z.string().nullable(),
});
export type DirectoryUser = z.infer<typeof DirectoryUser>;

export const DirectoryQuery = z.object({
  search: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const GroupUpsertInput = z.object({
  id: Id.optional(),
  name: z.string().min(1).max(64),
  description: z.string().max(512).nullable().optional(),
  memberIds: z.array(Id).optional(),
  roleIds: z.array(Id).optional(),
});

export const RoleRow = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  builtin: z.boolean(),
  privileges: z.array(z.enum(PRIVILEGES)),
  createdAt: Timestamp,
});
export type RoleRow = z.infer<typeof RoleRow>;

export const RoleInput = z.object({
  id: Id.optional(),
  name: z.string().min(1).max(64),
  description: z.string().max(512).nullable().optional(),
  privileges: z.array(z.enum(PRIVILEGES)).default([]),
});

export const SetPrivilegesInput = z.object({
  roleId: Id,
  privileges: z.array(z.enum(PRIVILEGES)),
});

export const GrantRow = z.object({
  id: Id,
  projectId: Id,
  subjectType: z.enum(['user', 'group']),
  subjectId: Id,
  subjectName: z.string(),
  roleId: Id,
  roleName: z.string(),
  createdAt: Timestamp,
});
export type GrantRow = z.infer<typeof GrantRow>;

export const GrantInput = z.object({
  projectId: Id,
  subjectType: z.enum(['user', 'group']),
  subjectId: Id,
  roleId: Id,
});

export const AuditRow = z.object({
  id: z.number().int(),
  userId: Id.nullable(),
  username: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  projectId: Id.nullable(),
  data: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: Timestamp,
});
export type AuditRow = z.infer<typeof AuditRow>;

export const AuditListInput = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  projectId: Id.optional(),
  userId: Id.optional(),
  since: Timestamp.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const RoleNameSchema = z.enum(ROLE_NAMES);
export const GlobalRoleNameSchema = z.enum(GLOBAL_ROLE_NAMES as [string, ...string[]]);
export const BUILTIN_ROLE_MAP = BUILTIN_ROLES;

export const IdentityRow = z.object({
  providerId: Id,
  providerName: z.string(),
  subject: z.string(),
  email: z.string().nullable(),
});
export const IdentityListInput = z.object({ userId: Id });
