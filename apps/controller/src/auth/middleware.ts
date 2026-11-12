/**
 * Authorization, CSRF, and audit middleware. One middleware serves every
 * procedure: the contract's `authz` metadata is the only source of policy.
 */

import {
  AppError,
  type AuthzMeta,
  AuthzMetaSchema,
  type Privilege,
  ProcedureMetaSchema,
  type ProjectScopeResolver,
} from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import type { AnyMiddleware } from '@orpc/server';
import { ORPCError } from '@orpc/server';
import type { Context } from '../context.ts';
import { hasPrivilege } from './principal.ts';

interface MiddlewareDeps {
  logger: Logger;
}

/** Procedures keep contract metadata under `~orpc.meta`. */
function procedureMeta(procedure: unknown): unknown {
  if (typeof procedure !== 'object' || procedure === null || !('~orpc' in procedure))
    return undefined;
  const def = procedure['~orpc'];
  if (typeof def !== 'object' || def === null || !('meta' in def)) return undefined;
  return def.meta;
}

/** Validate procedure metadata; malformed metadata denies access. */
function readMeta(procedure: unknown): { authz: AuthzMeta } | null {
  const parsed = ProcedureMetaSchema.safeParse(procedureMeta(procedure));
  if (!parsed.success) return null;
  return { authz: parsed.data.authz };
}

const MUTATING_SEGMENT =
  /^(create|update|delete|set|setPrivileges|start|stop|suspend|reload|reset|resetConsole|lock|unlock|open|close|duplicate|import|export|apply|inject|clear|revoke|rotate|rotateToken|prune|sync|write|restore|isolate|unisolate|cancel|complete|pull|ensure|exec)$/;

function isMutation(path: readonly string[]): boolean {
  const last = path[path.length - 1] ?? '';
  return MUTATING_SEGMENT.test(last);
}

const REDACT_KEYS = /password|secret|token|key|authorization/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACT_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

function fieldOf(input: unknown, field: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const direct = (input as Record<string, unknown>)[field];
  if (typeof direct === 'string') return direct;
  // Detailed input structure nests path params under `params`.
  const params = (input as Record<string, unknown>).params;
  if (params && typeof params === 'object') {
    const nested = (params as Record<string, unknown>)[field];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

/** Resolve the project a procedure operates on, for project-scoped checks. */
async function resolveProjectId(
  context: Context,
  resolver: ProjectScopeResolver | undefined,
  input: unknown,
): Promise<string | null> {
  switch (resolver) {
    case undefined:
    case 'none':
      return null;
    case 'input.projectId':
      return fieldOf(input, 'projectId');
    case 'input.id':
      return fieldOf(input, 'id');
    case 'node':
      return lookupProject(context, 'nodes', fieldOf(input, 'nodeId') ?? fieldOf(input, 'id'));
    case 'link':
      return lookupProject(context, 'links', fieldOf(input, 'linkId') ?? fieldOf(input, 'id'));
    case 'drawing':
      return lookupProject(context, 'drawings', fieldOf(input, 'id'));
    case 'marker':
      return lookupProject(context, 'markers', fieldOf(input, 'id'));
    case 'snapshot':
      return lookupProject(context, 'snapshots', fieldOf(input, 'id'));
    case 'template':
      return lookupProject(context, 'templates', fieldOf(input, 'id'));
    default:
      return null;
  }
}

const PROJECT_TABLES: Record<string, true> = {
  nodes: true,
  links: true,
  drawings: true,
  markers: true,
  snapshots: true,
  templates: true,
};

async function lookupProject(
  context: Context,
  table: string,
  id: string | null,
): Promise<string | null> {
  if (!id || PROJECT_TABLES[table] !== true) return null;
  const rows = await context.db.unsafe<{ project_id: string }[]>(
    `SELECT project_id FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.project_id ?? null;
}

/**
 * A mutation may come from the configured public origin or from the very host
 * the browser used to reach us (`Host`), so localhost, a hostname, or a LAN
 * address all work without widening the check: a hostile page's Origin cannot
 * equal our own Host. `x-forwarded-*` is deliberately not consulted here.
 */
export function mutationOriginAllowed(input: {
  origin: string | null;
  host: string | null;
  publicUrl: string;
}): boolean {
  const { origin, host, publicUrl } = input;
  // Non-browser clients (CLI, tests, agents) send no Origin and cannot be CSRF'd.
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === origin && parsed.origin === new URL(publicUrl).origin) return true;
  if (host && parsed.host === host) return true;
  return false;
}

function cookieCsrfViolation(context: Context): boolean {
  // Browsers always send at least one of these on mutating requests; requests
  // with neither are non-browser clients (CLI, tests) and cannot be CSRF'd.
  if (context.auth.type !== 'session') return false;
  const { origin, host, secFetchSite } = context.request;
  if (!mutationOriginAllowed({ origin, host, publicUrl: context.config.publicUrl })) {
    return true;
  }
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') return true;
  return false;
}

async function auditDeny(
  context: Context,
  path: readonly string[],
  reason: string,
  privilege: string | null,
): Promise<void> {
  await context.db.unsafe(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, project_id, data, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      context.auth.user?.id ?? null,
      `${path.join('.')} denied`,
      path[0] ?? 'rpc',
      null,
      null,
      { reason, privilege },
      context.request.ip,
    ],
  );
}

export function createAuthzMiddleware(deps: MiddlewareDeps): AnyMiddleware {
  return (async (options, input) => {
    // The oRPC middleware generics do not carry our concrete Context type
    // through `AnyMiddleware`; the controller only registers this middleware on
    // a router implemented with `Context`, so the cast is sound.
    const context = options.context as Context;
    const meta = readMeta(options.procedure);
    if (!meta) {
      deps.logger.error('procedure without valid authz metadata', { path: options.path });
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'procedure metadata is missing' });
    }
    const { authz: policy } = meta;
    const mode = policy.mode ?? 'any';

    if (mode === 'public') return options.next();

    if (!context.auth.user) {
      throw new ORPCError('UNAUTHORIZED', { message: 'authentication required' });
    }
    if (policy.sessionOnly && context.auth.type !== 'session') {
      await auditDeny(
        context,
        options.path,
        'api key not allowed for session-only procedure',
        policy.privilege ?? null,
      );
      throw new ORPCError('FORBIDDEN', {
        message: 'this procedure requires an interactive session',
      });
    }
    if (mode === 'session' && context.auth.type !== 'session') {
      throw new ORPCError('FORBIDDEN', {
        message: 'this procedure requires an interactive session',
      });
    }
    if (isMutation(options.path) && cookieCsrfViolation(context)) {
      throw new ORPCError('FORBIDDEN', { message: 'cross-origin request rejected' });
    }

    const projectId = await resolveProjectId(context, policy.project, input);
    if (policy.privilege && !hasPrivilege(context.auth, policy.privilege, projectId)) {
      await auditDeny(context, options.path, 'missing privilege', policy.privilege);
      throw new ORPCError('FORBIDDEN', {
        message: `missing privilege ${policy.privilege}`,
        data: { privilege: policy.privilege, projectId },
      });
    }
    for (const extra of policy.also ?? []) {
      if (!hasPrivilege(context.auth, extra as Privilege, projectId)) {
        await auditDeny(context, options.path, 'missing additional privilege', extra);
        throw new ORPCError('FORBIDDEN', { message: `missing privilege ${extra}` });
      }
    }

    const { output: value, context: downstream } = await options.next();
    if (isMutation(options.path)) {
      await context.db
        .unsafe(
          `INSERT INTO audit_log (user_id, action, resource_type, resource_id, project_id, data, ip)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            context.auth.user.id,
            options.path.join('.'),
            options.path[0] ?? 'rpc',
            fieldOf(input, 'id'),
            projectId,
            { input: redact(input) },
            context.request.ip,
          ],
        )
        .catch((err: unknown) => deps.logger.warn('audit insert failed', { err }));
    }
    return { output: value, context: downstream };
  }) as AnyMiddleware;
}

/** Re-exported so tests can assert the schema used for metadata parsing. */
export const AUTHZ_META_SCHEMA = AuthzMetaSchema;

export function requirePrivilege(
  context: Context,
  privilege: Privilege,
  projectId: string | null,
): void {
  if (!hasPrivilege(context.auth, privilege, projectId)) {
    throw new AppError('FORBIDDEN', `missing privilege ${privilege}`);
  }
}
