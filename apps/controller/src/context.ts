/** Request context shared by every oRPC procedure and HTTP route. */

import type { Privilege } from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import type { SQL } from 'bun';
import { extractCredentials, resolveAuth } from './auth/principal.ts';
import type { ControllerConfig } from './config.ts';
import type { EventBus } from './realtime/events.ts';
import type { AgentRegistry } from './services/agents.ts';
import type { JobService } from './services/jobs.ts';

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
}

export type AuthType = 'session' | 'apikey' | 'anonymous';

export interface AuthInfo {
  type: AuthType;
  user: AuthenticatedUser | null;
  /** Global role privileges (union of direct and group roles). */
  globalPrivileges: Set<Privilege>;
  /** Project-scoped privileges from grants, keyed by project id. */
  projectPrivileges: Map<string, Set<Privilege>>;
  /** True when the user holds the `admin` role globally. */
  isAdmin: boolean;
  /** Auto-created SSO account that no administrator has approved yet. */
  pending: boolean;
  sessionId: string | null;
  apiKey: { id: string; scopes: Set<Privilege>; projectIds: string[] } | null;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  /** Host the client used to reach the controller (`Host` header). */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  /** `Range` header of the request, for range-capable downloads. */
  range: string | null;
  method: string;
  path: string;
  requestId: string;
}

export interface Context {
  db: SQL;
  /** Response headers the procedure may set (cookies, cache hints). */
  resHeaders: Headers;
  config: ControllerConfig;
  logger: Logger;
  events: EventBus;
  agents: AgentRegistry;
  jobs: JobService;
  auth: AuthInfo;
  request: RequestMeta;
}

export function anonymousAuth(): AuthInfo {
  return {
    type: 'anonymous',
    user: null,
    globalPrivileges: new Set(),
    projectPrivileges: new Map(),
    isAdmin: false,
    pending: false,
    sessionId: null,
    apiKey: null,
  };
}

/**
 * Client address for rate limits and audit rows. Forwarded headers are
 * forgeable, so they are only consulted when the operator declares a proxy.
 */
export function clientAddress(
  request: Request,
  remoteAddress: string | null,
  trustProxy: boolean,
): string | null {
  if (trustProxy) {
    return (
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip')?.trim() ??
      remoteAddress
    );
  }
  return remoteAddress;
}

export function requestMeta(request: Request, ip: string | null = null): RequestMeta {
  const url = new URL(request.url);
  return {
    ip,
    userAgent: request.headers.get('user-agent'),
    host: request.headers.get('host') ?? url.host,
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    range: request.headers.get('range'),
    method: request.method,
    path: url.pathname,
    requestId: crypto.randomUUID(),
  };
}

export interface ContextDeps {
  db: SQL;
  config: ControllerConfig;
  logger: Logger;
  events: EventBus;
  agents: AgentRegistry;
  jobs: JobService;
}

/** Build the context for one HTTP request, resolving authentication first. */
export async function createRequestContext(
  deps: ContextDeps,
  request: Request,
  ip: string | null = null,
): Promise<Context> {
  const auth = await resolveAuth(deps.db, extractCredentials(request));
  const meta = requestMeta(request, ip);
  return {
    db: deps.db,
    config: deps.config,
    logger: deps.logger.child({ requestId: meta.requestId }),
    events: deps.events,
    agents: deps.agents,
    jobs: deps.jobs,
    auth,
    request: meta,
    resHeaders: new Headers(),
  };
}
