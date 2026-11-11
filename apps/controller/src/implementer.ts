/** oRPC implementer bound to the controller contract and request context. */

import { type AppRouter, router as contract } from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import { implement } from '@orpc/server';
import type { SQL } from 'bun';
import { createAuthzMiddleware } from './auth/middleware.ts';
import type { ControllerConfig } from './config.ts';
import type { Context } from './context.ts';
import type { EventBus } from './realtime/events.ts';
import type { AgentRegistry } from './services/agents.ts';
import type { JobService } from './services/jobs.ts';

export interface AppDeps {
  db: SQL;
  config: ControllerConfig;
  logger: Logger;
  events: EventBus;
  agents: AgentRegistry;
  jobs: JobService;
}

const base = implement<AppRouter, Context>(contract);

/** Type anchor: the wrapped implementer type route modules receive. */
const typeAnchor = base.use(async (options, _input, output) =>
  output((await options.next()).output),
);

export type Implementer = typeof typeAnchor;

export function createImplementer(deps: AppDeps): Implementer {
  return base.use(createAuthzMiddleware({ logger: deps.logger }));
}
