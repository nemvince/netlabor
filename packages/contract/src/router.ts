/**
 * Controller API contract. This file is the single source of truth for the API:
 * the server implementation, the browser client, OpenAPI, and MCP tools all
 * derive from it. Every procedure carries `authz` and `openapi` metadata.
 */

import type { Route } from '@orpc/contract';
import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { type AuthzMeta, authz, PUBLIC, SESSION } from './authz.ts';
import { EventEnvelope } from './events.ts';
import * as appliances from './schemas/appliances.ts';
import * as apply from './schemas/apply.ts';
import * as auth from './schemas/auth.ts';
import { FileResponse, Id, Ok, Timestamp } from './schemas/common.ts';
import * as computes from './schemas/computes.ts';
import * as links from './schemas/links.ts';
import * as misc from './schemas/misc.ts';
import * as nodes from './schemas/nodes.ts';
import * as projects from './schemas/projects.ts';

export interface McpToolMeta {
  /** Tool name exposed through MCP, e.g. `project_list`. */
  name: string;
  title: string;
  readOnly: boolean;
  destructive: boolean;
}

export interface ProcedureMeta {
  authz: AuthzMeta;
  openapi: { summarize: string; tags?: string[] };
  mcp?: McpToolMeta;
}

const base = oc.$meta<ProcedureMeta>({
  authz: { mode: 'public' },
  openapi: { summarize: 'unspecified' },
});

function proc(
  summary: string,
  authzMeta: AuthzMeta,
  extra?: { tags?: string[]; mcp?: McpToolMeta; route?: Route },
) {
  const meta: ProcedureMeta = {
    authz: authzMeta,
    openapi: { summarize: summary, ...(extra?.tags ? { tags: extra.tags } : {}) },
    ...(extra?.mcp ? { mcp: extra.mcp } : {}),
  };
  const builder = base.meta(meta);
  return extra?.route ? builder.route(extra.route) : builder;
}

const noInput = z.object({});

/* ---------------------------------------------------------------- health --- */

const health = {
  ping: proc('Liveness probe with database check', PUBLIC)
    .input(noInput)
    .output(z.object({ status: z.literal('ok'), version: z.string(), time: Timestamp })),
};

/* ------------------------------------------------------------------ auth --- */

const authRouter = {
  login: proc('Sign in with a local account', PUBLIC)
    .input(auth.LoginInput)
    .output(auth.LoginOutput),
  logout: proc('Sign out of the current session', SESSION).input(noInput).output(Ok),
  me: proc('Current user, roles, privileges, and project grants', SESSION)
    .input(noInput)
    .output(auth.MeOutput),
  password: {
    change: proc('Change the current user password', authz({ mode: 'session', sessionOnly: true }))
      .input(auth.ChangePasswordInput)
      .output(Ok),
  },
  sessions: {
    list: proc(
      'List active sessions for the current user',
      authz({ mode: 'session', sessionOnly: true }),
    )
      .input(noInput)
      .output(z.array(auth.SessionRow)),
    revoke: proc(
      'Revoke one of the current user sessions',
      authz({ mode: 'session', sessionOnly: true }),
    )
      .input(z.object({ id: Id }))
      .output(Ok),
  },
  setup: {
    status: proc('Whether first-run setup is needed (no user accounts exist)', PUBLIC)
      .input(noInput)
      .output(auth.SetupStatus),
    createAdmin: proc('Create the first admin account and sign in', PUBLIC)
      .input(auth.SetupAdminInput)
      .output(auth.LoginOutput),
  },
  apiKeys: {
    list: proc('List API keys of the current user', authz({ mode: 'session' }))
      .input(noInput)
      .output(z.array(auth.ApiKeyRow)),
    create: proc(
      'Create an API key; the plaintext is returned once',
      authz({ mode: 'session', sessionOnly: true }),
    )
      .input(auth.ApiKeyCreateInput)
      .output(auth.ApiKeyCreated),
    revoke: proc('Revoke an API key', authz({ mode: 'session' }))
      .input(z.object({ id: Id }))
      .output(Ok),
  },
  oidc: {
    publicProviders: proc('List enabled OIDC providers for the login page', PUBLIC)
      .input(noInput)
      .output(z.array(auth.OidcPublicProvider)),
    list: proc(
      'List OIDC provider configuration',
      authz({ mode: 'any', privilege: 'settings.write' }),
    )
      .input(noInput)
      .output(z.array(auth.OidcProviderRow)),
    create: proc('Create an OIDC provider', authz({ mode: 'any', privilege: 'settings.write' }))
      .input(auth.OidcProviderInput)
      .output(auth.OidcProviderRow),
    update: proc('Update an OIDC provider', authz({ mode: 'any', privilege: 'settings.write' }))
      .input(auth.OidcProviderInput.extend({ id: Id }))
      .output(auth.OidcProviderRow),
    delete: proc('Delete an OIDC provider', authz({ mode: 'any', privilege: 'settings.write' }))
      .input(z.object({ id: Id }))
      .output(Ok),
    identities: proc(
      'List external identities of a user',
      authz({ mode: 'any', privilege: 'user.read' }),
    )
      .input(auth.IdentityListInput)
      .output(z.array(auth.IdentityRow)),
  },
};

const preferences = {
  get: proc('Read user preferences', SESSION).input(noInput).output(misc.SettingsPatch),
  update: proc('Replace user preferences', SESSION)
    .input(auth.PreferencesInput)
    .output(misc.SettingsPatch),
};

/* ------------------------------------------------------- users and groups --- */

const users = {
  list: proc('List users', authz({ mode: 'any', privilege: 'user.read' }))
    .input(auth.UserListInput)
    .output(z.array(auth.UserRow)),
  get: proc('Read one user', authz({ mode: 'any', privilege: 'user.read' }))
    .input(z.object({ id: Id }))
    .output(auth.UserRow),
  create: proc('Create a local user', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.UserCreateInput)
    .output(auth.UserRow),
  update: proc('Update a user, roles, and groups', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.UserUpdateInput)
    .output(auth.UserRow),
  delete: proc('Delete a user', authz({ mode: 'any', privilege: 'user.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  setPassword: proc('Set a user password', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.SetPasswordInput)
    .output(Ok),
};

const groups = {
  list: proc('List groups', authz({ mode: 'any', privilege: 'user.read' }))
    .input(noInput)
    .output(z.array(auth.GroupRow)),
  create: proc('Create a group', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.GroupUpsertInput)
    .output(auth.GroupRow),
  update: proc('Update a group and its members', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.GroupUpsertInput.extend({ id: Id }))
    .output(auth.GroupRow),
  delete: proc('Delete a group', authz({ mode: 'any', privilege: 'user.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
};

const roles = {
  list: proc('List roles with privileges', authz({ mode: 'any', privilege: 'user.read' }))
    .input(noInput)
    .output(z.array(auth.RoleRow)),
  create: proc('Create a role', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.RoleInput)
    .output(auth.RoleRow),
  update: proc('Update a role', authz({ mode: 'any', privilege: 'user.write' }))
    .input(auth.RoleInput.extend({ id: Id }))
    .output(auth.RoleRow),
  delete: proc('Delete a role', authz({ mode: 'any', privilege: 'user.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  setPrivileges: proc(
    'Replace a role privilege set',
    authz({ mode: 'any', privilege: 'user.write' }),
  )
    .input(auth.SetPrivilegesInput)
    .output(auth.RoleRow),
};

const grants = {
  list: proc(
    'List project grants',
    authz({ mode: 'any', privilege: 'project.members', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(auth.GrantRow)),
  create: proc(
    'Grant a user or group a project role',
    authz({ mode: 'any', privilege: 'project.members', project: 'input.projectId' }),
  )
    .input(auth.GrantInput)
    .output(auth.GrantRow),
  delete: proc(
    'Remove a project grant',
    authz({ mode: 'any', privilege: 'project.members', project: 'input.projectId' }),
  )
    .input(z.object({ id: Id, projectId: Id }))
    .output(Ok),
};

const audit = {
  list: proc('List audit log rows', authz({ mode: 'any', privilege: 'audit.read' }))
    .input(auth.AuditListInput)
    .output(z.array(auth.AuditRow)),
};

/* -------------------------------------------------------------- computes --- */

const computesRouter = {
  list: proc('List compute servers', authz({ mode: 'any', privilege: 'compute.read' }))
    .input(noInput)
    .output(z.array(computes.ComputeRow)),
  get: proc('Read one compute server', authz({ mode: 'any', privilege: 'compute.read' }))
    .input(z.object({ id: Id }))
    .output(computes.ComputeRow),
  create: proc(
    'Register a compute server and return its agent token',
    authz({ mode: 'any', privilege: 'compute.write' }),
  )
    .input(computes.ComputeCreateInput)
    .output(computes.ComputeCreated),
  update: proc('Update a compute server', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(computes.ComputeUpdateInput)
    .output(computes.ComputeRow),
  delete: proc('Delete a compute server', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  rotateToken: proc(
    'Rotate the agent token of a compute',
    authz({ mode: 'any', privilege: 'compute.write' }),
  )
    .input(z.object({ id: Id }))
    .output(computes.ComputeTokenRotated),
  ping: proc('Contact a compute agent', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(z.object({ id: Id }))
    .output(computes.ComputePingResult),
  stats: proc(
    'Read CPU, memory, and disk statistics of a compute',
    authz({ mode: 'any', privilege: 'compute.read' }),
  )
    .input(z.object({ id: Id }))
    .output(computes.ComputeStats),
  dockerImages: {
    list: proc(
      'List Docker images available on a compute',
      authz({ mode: 'any', privilege: 'compute.read' }),
    )
      .input(z.object({ id: Id }))
      .output(z.array(computes.DockerImageInfo)),
    pull: proc('Pull a Docker image on a compute', authz({ mode: 'any', privilege: 'image.write' }))
      .input(z.object({ id: Id, image: z.string().min(1) }))
      .output(misc.JobRow),
  },
  dynamipsIdlepcProposals: proc(
    'Propose idle-PC values for a Dynamips platform image',
    authz({ mode: 'any', privilege: 'compute.read' }),
  )
    .input(z.object({ id: Id, platform: z.string(), imageId: Id }))
    .output(z.array(nodes.IdlepcProposal)),
};

const pools = {
  list: proc('List compute pools', authz({ mode: 'any', privilege: 'compute.read' }))
    .input(noInput)
    .output(z.array(computes.PoolRow)),
  create: proc('Create a compute pool', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(computes.PoolInput)
    .output(computes.PoolRow),
  update: proc('Update a compute pool', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(computes.PoolInput.extend({ id: Id }))
    .output(computes.PoolRow),
  delete: proc('Delete a compute pool', authz({ mode: 'any', privilege: 'compute.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
};

/* ---------------------------------------------------------------- images --- */

const images = {
  list: proc('List images and their replicas', authz({ mode: 'any', privilege: 'image.read' }))
    .input(misc.ImageListInput)
    .output(z.array(misc.ImageRow)),
  get: proc('Read one image', authz({ mode: 'any', privilege: 'image.read' }))
    .input(z.object({ id: Id }))
    .output(misc.ImageRow),
  createFromUpload: proc(
    'Create an image from a completed upload',
    authz({ mode: 'any', privilege: 'image.write' }),
  )
    .input(misc.ImageCreateInput)
    .output(misc.ImageRow),
  update: proc('Rename an image', authz({ mode: 'any', privilege: 'image.write' }))
    .input(z.object({ id: Id, name: z.string().min(1).max(200) }))
    .output(misc.ImageRow),
  delete: proc('Delete an image and its replicas', authz({ mode: 'any', privilege: 'image.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  sync: proc('Replicate an image to computes', authz({ mode: 'any', privilege: 'image.sync' }))
    .input(misc.ImageSyncInput)
    .output(misc.JobRow),
  prune: proc(
    'Remove unreferenced image replicas',
    authz({ mode: 'any', privilege: 'image.write' }),
  )
    .input(misc.ImagePruneInput)
    .output(misc.JobRow),
  replicas: proc('List image replicas', authz({ mode: 'any', privilege: 'image.read' }))
    .input(z.object({ imageId: Id }))
    .output(misc.ImageRow.shape.replicas),
  blob: proc(
    'Download an image blob (Range capable)',
    authz({ mode: 'any', privilege: 'image.read' }),
    { route: { method: 'GET', path: '/blobs/{sha256}/{filename}', outputStructure: 'detailed' } },
  )
    .input(
      z.object({
        sha256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex sha256 required'),
        filename: z.string().min(1),
      }),
    )
    .output(FileResponse),
};

const uploads = {
  start: proc('Start a chunked upload', authz({ mode: 'any', privilege: 'image.write' }), {
    route: { method: 'POST', path: '/uploads' },
  })
    .input(misc.UploadStartInput)
    .output(misc.UploadStartOutput),
  status: proc('Read upload progress', authz({ mode: 'any', privilege: 'image.write' }), {
    route: { method: 'GET', path: '/uploads/{uploadId}' },
  })
    .input(z.object({ uploadId: Id }))
    .output(misc.UploadStatus),
  chunk: proc('Append one chunk to an upload', authz({ mode: 'any', privilege: 'image.write' }), {
    route: { method: 'PUT', path: '/uploads/{uploadId}' },
  })
    .input(
      z.object({
        uploadId: Id,
        offset: z.coerce.number().int().min(0),
        chunk: z.file(),
      }),
    )
    .output(misc.UploadStatus),
  complete: proc(
    'Finish a chunked upload and verify its bytes',
    authz({ mode: 'any', privilege: 'image.write' }),
    { route: { method: 'POST', path: '/uploads/{uploadId}/complete' } },
  )
    .input(z.object({ uploadId: Id }))
    .output(misc.UploadStatus),
  cancel: proc('Cancel an upload', authz({ mode: 'any', privilege: 'image.write' }), {
    route: { method: 'DELETE', path: '/uploads/{uploadId}' },
  })
    .input(z.object({ uploadId: Id }))
    .output(Ok),
};

/* ------------------------------------------------------------- templates --- */

const templates = {
  list: proc(
    "List device templates, optionally with a project's own templates",
    authz({ mode: 'any', privilege: 'template.read', project: 'input.projectId' }),
  )
    .input(misc.TemplateListInput)
    .output(z.array(misc.TemplateRow)),
  get: proc('Read one device template', authz({ mode: 'any', privilege: 'template.read' }))
    .input(z.object({ id: Id }))
    .output(misc.TemplateRow),
  create: proc(
    'Create a device template',
    authz({ mode: 'any', privilege: 'template.write', project: 'input.projectId' }),
  )
    .input(misc.TemplateInput)
    .output(misc.TemplateRow),
  update: proc(
    'Update a device template',
    authz({ mode: 'any', privilege: 'template.write', project: 'template' }),
  )
    .input(misc.TemplateInput.extend({ id: Id }))
    .output(misc.TemplateRow),
  delete: proc(
    'Delete a device template',
    authz({ mode: 'any', privilege: 'template.write', project: 'template' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  duplicate: proc(
    'Duplicate a device template',
    authz({ mode: 'any', privilege: 'template.write', project: 'template' }),
  )
    .input(misc.TemplateDuplicateInput)
    .output(misc.TemplateRow),
  baseConfigs: {
    list: proc(
      'List base configuration files of a template',
      authz({ mode: 'any', privilege: 'template.read' }),
    )
      .input(misc.BaseConfigListInput)
      .output(z.array(misc.BaseConfigFile)),
    read: proc('Read a base configuration file', authz({ mode: 'any', privilege: 'template.read' }))
      .input(misc.BaseConfigReadInput)
      .output(misc.BaseConfigFile),
    write: proc(
      'Write a base configuration file',
      authz({ mode: 'any', privilege: 'template.write' }),
    )
      .input(misc.BaseConfigWriteInput)
      .output(misc.BaseConfigFile),
    delete: proc(
      'Delete a base configuration file',
      authz({ mode: 'any', privilege: 'template.write' }),
    )
      .input(misc.BaseConfigReadInput)
      .output(Ok),
  },
  catalog: proc(
    'Read the seeded device catalog',
    authz({ mode: 'any', privilege: 'template.read' }),
  )
    .input(noInput)
    .output(z.array(misc.TemplateRow)),
};

const symbols = {
  list: proc('List node symbols', authz({ mode: 'any', privilege: 'template.read' }))
    .input(noInput)
    .output(z.array(misc.SymbolRow)),
  upload: proc('Upload an SVG symbol', authz({ mode: 'any', privilege: 'template.write' }))
    .input(misc.SymbolUploadInput)
    .output(misc.SymbolRow),
  delete: proc('Delete an uploaded symbol', authz({ mode: 'any', privilege: 'template.write' }))
    .input(z.object({ id: z.string().min(1) }))
    .output(Ok),
};

/* -------------------------------------------------------------- projects --- */

const projectsRouter = {
  list: proc('List visible projects', authz({ mode: 'any', privilege: 'project.read' }))
    .input(projects.ProjectListInput)
    .output(z.array(projects.ProjectRow)),
  get: proc(
    'Read one project',
    authz({ mode: 'any', privilege: 'project.read', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectRow),
  create: proc('Create a project', authz({ mode: 'any', privilege: 'project.write' }))
    .input(projects.ProjectCreateInput)
    .output(projects.ProjectRow),
  update: proc(
    'Update project metadata',
    authz({ mode: 'any', privilege: 'project.write', project: 'input.id' }),
  )
    .input(projects.ProjectUpdateInput)
    .output(projects.ProjectRow),
  delete: proc(
    'Delete a project, its dataplane, and files',
    authz({ mode: 'any', privilege: 'project.delete', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  open: proc(
    'Open a project and create its dataplane',
    authz({ mode: 'any', privilege: 'project.open', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectRow),
  close: proc(
    'Close a project and remove its dataplane',
    authz({ mode: 'any', privilege: 'project.open', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectRow),
  lock: proc(
    'Lock project topology editing',
    authz({ mode: 'any', privilege: 'project.write', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectRow),
  unlock: proc(
    'Unlock project topology editing',
    authz({ mode: 'any', privilege: 'project.write', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectRow),
  duplicate: proc(
    'Duplicate a project',
    authz({ mode: 'any', privilege: 'project.write', project: 'input.id' }),
  )
    .input(projects.ProjectDuplicateInput)
    .output(misc.JobRow),
  export: proc(
    'Export a project as a netlabor.project/1 archive',
    authz({ mode: 'any', privilege: 'project.export', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectExportOutput),
  exportArchive: proc(
    'Download the exported project archive',
    authz({ mode: 'any', privilege: 'project.export', project: 'input.id' }),
    { route: { method: 'GET', path: '/projects/{id}/export' } },
  )
    .input(z.object({ id: Id }))
    .output(z.file()),
  import: proc(
    'Import a netlabor.project/1 archive',
    authz({ mode: 'any', privilege: 'project.write' }),
  )
    .input(projects.ProjectImportInput)
    .output(misc.JobRow),
  apply: proc(
    'Create or update a project from a declarative manifest',
    authz({ mode: 'any', privilege: 'project.write', project: 'input.projectId' }),
  )
    .input(apply.ProjectApplyInput)
    .output(apply.ProjectApplyResult),
  stats: proc(
    'Project counters and compute slots',
    authz({ mode: 'any', privilege: 'project.read', project: 'input.id' }),
  )
    .input(z.object({ id: Id }))
    .output(projects.ProjectStats),
  events: proc(
    'Stream project events',
    authz({ mode: 'any', privilege: 'project.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id, lastEventId: z.number().int().optional() }))
    .output(eventIterator(EventEnvelope)),
  files: {
    list: proc(
      'List project files',
      authz({ mode: 'any', privilege: 'project.read', project: 'input.projectId' }),
    )
      .input(z.object({ projectId: Id, path: z.string().default('') }))
      .output(z.array(projects.ProjectFileEntry)),
    read: proc(
      'Read a project file',
      authz({ mode: 'any', privilege: 'node.files', project: 'input.projectId' }),
    )
      .input(
        z.object({
          projectId: Id,
          path: z.string().min(1),
          /** When 'base64', content returns as base64 of the raw bytes. */
          encoding: z.enum(['base64']).optional(),
        }),
      )
      .output(projects.ProjectFileReadOutput),
    write: proc(
      'Write a project file',
      authz({ mode: 'any', privilege: 'node.files', project: 'input.projectId' }),
    )
      .input(projects.ProjectFileWriteInput)
      .output(projects.ProjectFileReadOutput),
    delete: proc(
      'Delete a project file',
      authz({ mode: 'any', privilege: 'project.write', project: 'input.projectId' }),
    )
      .input(z.object({ projectId: Id, path: z.string().min(1) }))
      .output(Ok),
  },
  templates: {
    list: proc('List project templates', authz({ mode: 'any', privilege: 'project.read' }))
      .input(noInput)
      .output(z.array(projects.ProjectTemplateRow)),
    create: proc(
      'Capture a project template from a project',
      authz({ mode: 'any', privilege: 'project.write', project: 'input.projectId' }),
    )
      .input(projects.ProjectTemplateCreateInput)
      .output(projects.ProjectTemplateRow),
    delete: proc('Delete a project template', authz({ mode: 'any', privilege: 'project.write' }))
      .input(z.object({ id: Id }))
      .output(Ok),
    apply: proc(
      'Create a project from a project template',
      authz({ mode: 'any', privilege: 'project.write' }),
    )
      .input(projects.ProjectTemplateApplyInput)
      .output(projects.ProjectRow),
  },
};

/* ----------------------------------------------------------------- nodes --- */

const nodesRouter = {
  list: proc(
    'List project nodes with ports',
    authz({ mode: 'any', privilege: 'node.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(nodes.NodeRow)),
  get: proc('Read one node', authz({ mode: 'any', privilege: 'node.read', project: 'node' }))
    .input(z.object({ id: Id }))
    .output(nodes.NodeRow),
  create: proc(
    'Create a node from a template',
    authz({ mode: 'any', privilege: 'node.create', project: 'input.projectId' }),
  )
    .input(nodes.NodeCreateInput)
    .output(nodes.NodeRow),
  update: proc(
    'Update node properties or position',
    authz({ mode: 'any', privilege: 'node.update', project: 'node' }),
  )
    .input(nodes.NodeUpdateInput)
    .output(nodes.NodeRow),
  delete: proc(
    'Delete a node and its links',
    authz({ mode: 'any', privilege: 'node.delete', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  duplicate: proc(
    'Duplicate a node',
    authz({ mode: 'any', privilege: 'node.create', project: 'node' }),
  )
    .input(nodes.NodeDuplicateInput)
    .output(nodes.NodeRow),
  start: proc('Start a node', authz({ mode: 'any', privilege: 'node.control', project: 'node' }))
    .input(z.object({ id: Id }))
    .output(nodes.NodeActionOutput),
  stop: proc('Stop a node', authz({ mode: 'any', privilege: 'node.control', project: 'node' }))
    .input(z.object({ id: Id }))
    .output(nodes.NodeActionOutput),
  suspend: proc(
    'Suspend a node',
    authz({ mode: 'any', privilege: 'node.control', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(nodes.NodeActionOutput),
  reload: proc(
    'Stop then start a node',
    authz({ mode: 'any', privilege: 'node.control', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(nodes.NodeActionOutput),
  isolate: proc(
    'Detach a node from all links',
    authz({ mode: 'any', privilege: 'node.control', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  unisolate: proc(
    'Reattach an isolated node',
    authz({ mode: 'any', privilege: 'node.control', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  resetConsole: proc(
    'Reset the console connection of a node',
    authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
  )
    .input(z.object({ id: Id }))
    .output(Ok),
  consoleTicket: proc(
    'Issue a console or VNC ticket',
    authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
  )
    .input(nodes.ConsoleTicketInput)
    .output(nodes.ConsoleTicketOutput),
  console: {
    exec: proc(
      'Run console commands and return the transcript',
      authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
    )
      .input(nodes.ConsoleExecInput)
      .output(nodes.ConsoleExecOutput),
    /** Reverse proxy of a node's web console; see `webProxy` in the schemas. */
    get: proc(
      'Proxy a GET request to a node web console',
      authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
      {
        route: {
          method: 'GET',
          path: '/nodes/{nodeId}/console/{+rest}',
          inputStructure: 'detailed',
          outputStructure: 'detailed',
        },
      },
    )
      .input(nodes.WebProxyInput)
      .output(nodes.WebProxyOutputSchema),
    post: proc(
      'Proxy a POST request to a node web console',
      authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
      {
        route: {
          method: 'POST',
          path: '/nodes/{nodeId}/console/{+rest}',
          inputStructure: 'detailed',
          outputStructure: 'detailed',
        },
      },
    )
      .input(nodes.WebProxyInput)
      .output(nodes.WebProxyOutputSchema),
    // The catch-all segment never matches an empty remainder, so the console
    // root page gets its own route.
    getRoot: proc(
      'Proxy the console root page',
      authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
      {
        route: {
          method: 'GET',
          path: '/nodes/{nodeId}/console',
          inputStructure: 'detailed',
          outputStructure: 'detailed',
        },
      },
    )
      .input(nodes.WebProxyRootInput)
      .output(nodes.WebProxyOutputSchema),
    postRoot: proc(
      'Proxy a POST to the console root page',
      authz({ mode: 'any', privilege: 'node.console', project: 'node' }),
      {
        route: {
          method: 'POST',
          path: '/nodes/{nodeId}/console',
          inputStructure: 'detailed',
          outputStructure: 'detailed',
        },
      },
    )
      .input(nodes.WebProxyRootInput)
      .output(nodes.WebProxyOutputSchema),
  },
  files: {
    list: proc('List node files', authz({ mode: 'any', privilege: 'node.files', project: 'node' }))
      .input(z.object({ nodeId: Id, path: z.string().default('') }))
      .output(z.array(nodes.NodeFileEntry)),
    read: proc('Read a node file', authz({ mode: 'any', privilege: 'node.files', project: 'node' }))
      .input(z.object({ nodeId: Id, path: z.string().min(1) }))
      .output(nodes.NodeFileReadOutput),
    write: proc(
      'Write a node file',
      authz({ mode: 'any', privilege: 'node.files', project: 'node' }),
    )
      .input(nodes.NodeFileWriteInput)
      .output(nodes.NodeFileReadOutput),
    delete: proc(
      'Delete a node file',
      authz({ mode: 'any', privilege: 'node.files', project: 'node' }),
    )
      .input(z.object({ nodeId: Id, path: z.string().min(1) }))
      .output(Ok),
    download: proc(
      'Download a node file',
      authz({ mode: 'any', privilege: 'node.files', project: 'node' }),
      { route: { method: 'GET', path: '/nodes/{nodeId}/files/{+path}' } },
    )
      .input(z.object({ nodeId: Id, path: z.string().min(1) }))
      .output(z.file()),
  },
  qemu: {
    diskImage: {
      create: proc(
        'Create a QEMU disk image',
        authz({ mode: 'any', privilege: 'node.update', project: 'node' }),
      )
        .input(nodes.DiskImageInput)
        .output(nodes.DiskImageOutput),
      delete: proc(
        'Delete a QEMU disk image',
        authz({ mode: 'any', privilege: 'node.update', project: 'node' }),
      )
        .input(nodes.DiskImageInput)
        .output(Ok),
      resize: proc(
        'Resize a QEMU disk image',
        authz({ mode: 'any', privilege: 'node.update', project: 'node' }),
      )
        .input(nodes.DiskImageResizeInput)
        .output(nodes.DiskImageOutput),
    },
  },
  dynamips: {
    idlepc: proc(
      'Apply an idle-PC value to a Dynamips node',
      authz({ mode: 'any', privilege: 'node.update', project: 'node' }),
    )
      .input(nodes.IdlepcInput)
      .output(Ok),
  },
};

/* ----------------------------------------------------------------- links --- */

const linksRouter = {
  list: proc(
    'List project links',
    authz({ mode: 'any', privilege: 'link.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(links.LinkRow)),
  get: proc('Read one link', authz({ mode: 'any', privilege: 'link.read', project: 'link' }))
    .input(z.object({ id: Id }))
    .output(links.LinkRow),
  create: proc(
    'Create a link between two ports',
    authz({ mode: 'any', privilege: 'link.write', project: 'input.projectId' }),
  )
    .input(links.LinkCreateInput)
    .output(links.LinkRow),
  update: proc(
    'Update link style or suspend state',
    authz({ mode: 'any', privilege: 'link.write', project: 'link' }),
  )
    .input(links.LinkUpdateInput)
    .output(links.LinkRow),
  delete: proc('Delete a link', authz({ mode: 'any', privilege: 'link.write', project: 'link' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  reset: proc(
    'Recreate a link dataplane',
    authz({ mode: 'any', privilege: 'link.write', project: 'link' }),
  )
    .input(z.object({ id: Id }))
    .output(links.LinkRow),
  filters: {
    get: proc(
      'Read link impairment filters',
      authz({ mode: 'any', privilege: 'link.read', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(links.LinkFilters),
    set: proc(
      'Apply link impairment filters',
      authz({ mode: 'any', privilege: 'link.write', project: 'link' }),
    )
      .input(links.FiltersInput)
      .output(links.LinkFilters),
    clear: proc(
      'Clear link impairment filters',
      authz({ mode: 'any', privilege: 'link.write', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(links.LinkFilters),
  },
  capture: {
    start: proc(
      'Start a pcap capture on a link',
      authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
    )
      .input(links.CaptureStartInput)
      .output(links.CaptureState),
    stop: proc(
      'Stop the pcap capture on a link',
      authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(links.CaptureState),
    status: proc(
      'Read capture state of a link',
      authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(links.CaptureState),
    ticket: proc(
      'Issue a Web Wireshark ticket for a link',
      authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(links.CaptureTicketOutput),
    download: proc(
      'Download the captured pcap of a link',
      authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
      { route: { method: 'GET', path: '/links/{linkId}/capture.pcap' } },
    )
      .input(z.object({ linkId: Id }))
      .output(z.any()),
  },
  markers: {
    list: proc(
      'List markers of a link',
      authz({ mode: 'any', privilege: 'link.read', project: 'link' }),
    )
      .input(z.object({ linkId: Id }))
      .output(z.array(links.MarkerRow)),
    create: proc(
      'Create a packet marker on a link',
      authz({ mode: 'any', privilege: 'link.write', project: 'link' }),
    )
      .input(links.MarkerInput)
      .output(links.MarkerRow),
    update: proc('Update or pause a marker', authz({ mode: 'any', privilege: 'link.write' }))
      .input(links.MarkerUpdateInput)
      .output(links.MarkerRow),
    delete: proc('Delete a marker', authz({ mode: 'any', privilege: 'link.write' }))
      .input(z.object({ id: Id }))
      .output(Ok),
    hits: proc('Read recent marker hits for a link', authz({ mode: 'any', privilege: 'link.read' }))
      .input(z.object({ linkId: Id }))
      .output(z.array(z.record(z.string(), z.unknown()))),
  },
};

const drawings = {
  list: proc(
    'List project drawings',
    authz({ mode: 'any', privilege: 'link.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(links.DrawingRow)),
  create: proc(
    'Create a drawing',
    authz({ mode: 'any', privilege: 'drawing.write', project: 'input.projectId' }),
  )
    .input(links.DrawingCreateInput)
    .output(links.DrawingRow),
  update: proc('Update a drawing', authz({ mode: 'any', privilege: 'drawing.write' }))
    .input(links.DrawingUpdateInput)
    .output(links.DrawingRow),
  delete: proc('Delete a drawing', authz({ mode: 'any', privilege: 'drawing.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
};

/* ------------------------------------------------------------- snapshots --- */

const snapshots = {
  list: proc(
    'List project snapshots',
    authz({ mode: 'any', privilege: 'snapshot.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(projects.SnapshotRow)),
  create: proc(
    'Create a project snapshot',
    authz({ mode: 'any', privilege: 'snapshot.write', project: 'input.projectId' }),
  )
    .input(projects.SnapshotCreateInput)
    .output(misc.JobRow),
  restore: proc('Restore a project snapshot', authz({ mode: 'any', privilege: 'snapshot.write' }))
    .input(z.object({ id: Id }))
    .output(misc.JobRow),
  delete: proc('Delete a snapshot', authz({ mode: 'any', privilege: 'snapshot.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
  download: proc('Download a snapshot archive', authz({ mode: 'any', privilege: 'snapshot.read' }))
    .input(z.object({ id: Id }))
    .output(z.object({ downloadUrl: z.string() })),
  downloadArchive: proc(
    'Download the snapshot archive file',
    authz({ mode: 'any', privilege: 'snapshot.read', project: 'snapshot' }),
    { route: { method: 'GET', path: '/snapshots/{id}/download' } },
  )
    .input(z.object({ id: Id }))
    .output(z.file()),
};

/* ------------------------------------------------ settings, events, misc --- */

const settings = {
  get: proc('Read global settings', authz({ mode: 'any', privilege: 'settings.read' }))
    .input(noInput)
    .output(misc.SettingsPatch),
  update: proc('Update global settings', authz({ mode: 'any', privilege: 'settings.write' }))
    .input(misc.SettingsPatch)
    .output(misc.SettingsPatch),
};

const secrets = {
  list: proc('List encrypted secrets by name', authz({ mode: 'any', privilege: 'settings.read' }))
    .input(noInput)
    .output(z.array(misc.SecretRow)),
  create: proc('Create an encrypted secret', authz({ mode: 'any', privilege: 'settings.write' }))
    .input(misc.SecretInput)
    .output(misc.SecretRow),
  delete: proc('Delete an encrypted secret', authz({ mode: 'any', privilege: 'settings.write' }))
    .input(z.object({ id: Id }))
    .output(Ok),
};

const events = {
  subscribe: proc('Stream controller events visible to the caller', SESSION)
    .input(z.object({ lastEventId: z.number().int().optional() }))
    .output(eventIterator(EventEnvelope)),
};

const faults = {
  list: proc(
    'List faults of a project',
    authz({ mode: 'any', privilege: 'node.read', project: 'input.projectId' }),
  )
    .input(z.object({ projectId: Id }))
    .output(z.array(misc.FaultRow)),
  inject: proc(
    'Inject link or device faults',
    authz({ mode: 'any', privilege: 'fault.write', project: 'input.projectId' }),
  )
    .input(misc.FaultInjectInput)
    .output(z.array(misc.FaultRow)),
  clear: proc(
    'Clear active faults',
    authz({ mode: 'any', privilege: 'fault.write', project: 'input.projectId' }),
  )
    .input(misc.FaultClearInput)
    .output(z.array(misc.FaultRow)),
};

const packet = {
  analyze: proc(
    'Analyze captured packets with tshark',
    authz({ mode: 'any', privilege: 'link.capture', project: 'link' }),
  )
    .input(misc.PacketAnalyzeInput)
    .output(misc.PacketAnalyzeOutput),
  fields: proc(
    'Search the tshark field registry',
    authz({ mode: 'any', privilege: 'link.capture' }),
  )
    .input(misc.PacketFieldsInput)
    .output(z.array(misc.PacketFieldRow)),
};

const jobs = {
  list: proc('List background jobs', authz({ mode: 'any', privilege: 'project.read' }))
    .input(misc.JobsListInput)
    .output(z.array(misc.JobRow)),
  get: proc('Read one background job', authz({ mode: 'any', privilege: 'project.read' }))
    .input(z.object({ id: Id }))
    .output(misc.JobRow),
  cancel: proc('Cancel a background job', authz({ mode: 'any', privilege: 'project.write' }))
    .input(z.object({ id: Id }))
    .output(misc.JobRow),
};

/* ------------------------------------------------------------ appliances --- */

const appliancesRouter = {
  os: {
    list: proc('List the OS image repository', authz({ mode: 'any', privilege: 'image.read' }))
      .input(appliances.OsImageListInput)
      .output(z.array(appliances.OsImageRow)),
    create: proc(
      'Add an OS image to the repository',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(appliances.OsImageCreateInput)
      .output(appliances.OsImageRow),
    update: proc('Edit an OS image entry', authz({ mode: 'any', privilege: 'image.write' }))
      .input(appliances.OsImageUpdateInput)
      .output(appliances.OsImageRow),
    delete: proc(
      'Delete an OS image entry and its artifact',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(z.object({ id: Id }))
      .output(Ok),
    download: proc(
      'Download an OS image from its upstream URL into the library',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(appliances.OsImageTargetInput)
      .output(misc.JobRow),
    adopt: proc(
      'Point an OS image entry at an existing library image',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(appliances.OsImageAdoptInput)
      .output(appliances.OsImageRow),
  },
  builds: {
    list: proc('List appliance builds', authz({ mode: 'any', privilege: 'image.read' }))
      .input(appliances.ApplianceBuildListInput)
      .output(z.array(appliances.ApplianceBuildRow)),
    get: proc('Read one appliance build', authz({ mode: 'any', privilege: 'image.read' }))
      .input(appliances.ApplianceBuildGetInput)
      .output(appliances.ApplianceBuildRow),
    create: proc(
      'Build an appliance image online from the OS repository',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(appliances.ApplianceBuildInput)
      .output(appliances.ApplianceBuildCreated),
    cancel: proc(
      'Cancel a running appliance build',
      authz({ mode: 'any', privilege: 'image.write' }),
    )
      .input(appliances.ApplianceBuildGetInput)
      .output(appliances.ApplianceBuildRow),
    template: proc(
      'Create a device template from a finished appliance build',
      authz({
        mode: 'any',
        privilege: 'template.write',
        also: ['image.read'],
        project: 'input.projectId',
      }),
    )
      .input(appliances.ApplianceTemplateInput)
      .output(misc.TemplateRow),
  },
};

export const router = {
  health,
  auth: authRouter,
  preferences,
  users,
  groups,
  roles,
  grants,
  audit,
  computes: computesRouter,
  pools,
  images,
  uploads,
  templates,
  symbols,
  projects: projectsRouter,
  nodes: nodesRouter,
  links: linksRouter,
  drawings,
  snapshots,
  settings,
  secrets,
  events,
  faults,
  packet,
  jobs,
  appliances: appliancesRouter,
};

export type AppRouter = typeof router;

function isProcedureNode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('~orpc' in value)) return false;
  const def = value['~orpc'];
  return typeof def === 'object' && def !== null && ('inputSchema' in def || 'outputSchema' in def);
}

/** Convenience for tests, docs, and MCP registration: every procedure path. */
export function procedurePaths(routerObject: unknown = router, prefix: string[] = []): string[] {
  if (typeof routerObject !== 'object' || routerObject === null) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(routerObject)) {
    if (key === '~orpc') continue;
    const path = [...prefix, key];
    if (isProcedureNode(value)) paths.push(path.join('.'));
    else paths.push(...procedurePaths(value, path));
  }
  return paths;
}
