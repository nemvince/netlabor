import { z } from 'zod';

/** Privileges, built-in roles, and procedure authorization metadata. */

export const PRIVILEGES = [
  'project.read',
  'project.write',
  'project.delete',
  'project.members',
  'project.open',
  'project.export',
  'node.read',
  'node.create',
  'node.update',
  'node.delete',
  'node.control',
  'node.console',
  'node.files',
  'link.read',
  'link.write',
  'link.capture',
  'drawing.write',
  'template.read',
  'template.write',
  'image.read',
  'image.write',
  'image.sync',
  'compute.read',
  'compute.write',
  'snapshot.read',
  'snapshot.write',
  'fault.write',
  'settings.read',
  'settings.write',
  'user.read',
  'user.write',
  'audit.read',
  'mcp.use',
] as const;

export type Privilege = (typeof PRIVILEGES)[number];

export const ROLE_NAMES = ['admin', 'operator', 'editor', 'owner', 'viewer', 'auditor'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const READ_PRIVILEGES = PRIVILEGES.filter((p) => p.endsWith('.read'));

export const BUILTIN_ROLES: Record<RoleName, readonly Privilege[]> = {
  admin: PRIVILEGES,
  operator: [
    ...READ_PRIVILEGES,
    'node.control',
    'node.console',
    'link.capture',
    'snapshot.write',
    'fault.write',
    'image.sync',
    'image.write',
    'mcp.use',
  ],
  editor: [
    'project.read',
    'project.write',
    'project.open',
    'project.export',
    'node.read',
    'node.create',
    'node.update',
    'node.delete',
    'node.control',
    'node.console',
    'node.files',
    'link.read',
    'link.write',
    'link.capture',
    'drawing.write',
    'template.read',
    'template.write',
    'image.read',
    'compute.read',
    'snapshot.read',
    'snapshot.write',
    'fault.write',
    'mcp.use',
  ],
  owner: [
    'project.read',
    'project.write',
    'project.delete',
    'project.members',
    'project.open',
    'project.export',
    'node.read',
    'node.create',
    'node.update',
    'node.delete',
    'node.control',
    'node.console',
    'node.files',
    'link.read',
    'link.write',
    'link.capture',
    'drawing.write',
    'template.read',
    'template.write',
    'image.read',
    'compute.read',
    'snapshot.read',
    'snapshot.write',
    'fault.write',
    'mcp.use',
  ],
  viewer: [
    'project.read',
    'node.read',
    'link.read',
    'template.read',
    'image.read',
    'compute.read',
    'snapshot.read',
  ],
  auditor: [
    'project.read',
    'node.read',
    'link.read',
    'template.read',
    'image.read',
    'compute.read',
    'snapshot.read',
    'settings.read',
    'user.read',
    'audit.read',
  ],
};

/** Roles assignable globally (owner only exists on project grants). */
export const GLOBAL_ROLE_NAMES: readonly RoleName[] = [
  'admin',
  'operator',
  'editor',
  'viewer',
  'auditor',
];
export const PROJECT_ROLE_NAMES: readonly RoleName[] = [
  'operator',
  'editor',
  'owner',
  'viewer',
  'auditor',
];

export type AuthMode = 'public' | 'session' | 'any';

/** How a procedure finds the project it operates on, for project-scoped checks. */
export type ProjectScopeResolver =
  | 'none'
  | 'input.projectId'
  | 'input.id'
  | 'node'
  | 'link'
  | 'drawing'
  | 'marker'
  | 'snapshot'
  | 'template';

export interface AuthzMeta {
  /** Defaults to `any`: privilege presence decides, authentication is implied. */
  mode?: AuthMode;
  privilege?: Privilege;
  project?: ProjectScopeResolver;
  /** Additional privileges the caller must hold (MCP tool filtering uses these). */
  also?: Privilege[];
  /** API keys are refused for these procedures even when scoped correctly. */
  sessionOnly?: boolean;
}

export const AuthzMetaSchema = z.object({
  mode: z.enum(['public', 'session', 'any']).optional(),
  privilege: z.enum(PRIVILEGES).optional(),
  project: z
    .enum([
      'none',
      'input.projectId',
      'input.id',
      'node',
      'link',
      'drawing',
      'marker',
      'snapshot',
      'template',
    ])
    .optional(),
  also: z.array(z.enum(PRIVILEGES)).optional(),
  sessionOnly: z.boolean().optional(),
});

export const ProcedureMetaSchema = z.object({
  authz: AuthzMetaSchema,
  openapi: z.object({ summarize: z.string(), tags: z.array(z.string()).optional() }).optional(),
  mcp: z
    .object({
      name: z.string(),
      title: z.string(),
      readOnly: z.boolean(),
      destructive: z.boolean(),
    })
    .optional(),
});

/** Build authorization metadata, defaulting to `any` (authenticated + privilege). */
export function authz(meta: AuthzMeta): AuthzMeta {
  return { mode: 'any', ...meta };
}

export const PUBLIC: AuthzMeta = { mode: 'public' };
export const SESSION: AuthzMeta = { mode: 'session' };
export const ANY: AuthzMeta = { mode: 'any' };

export function isPrivilege(value: string): value is Privilege {
  return (PRIVILEGES as readonly string[]).includes(value);
}

export function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}
