/** Controller router assembly: one handler per contract procedure. */

import { type AppDeps, createImplementer } from './implementer.ts';
import { adminRoutes } from './routes/admin.ts';
import { applianceRoutes } from './routes/appliances.ts';
import { authRoutes } from './routes/auth.ts';
import { computeRoutes } from './routes/computes.ts';
import { drawingRoutes } from './routes/drawings.ts';
import { eventRoutes } from './routes/events.ts';
import { faultRoutes } from './routes/faults.ts';
import { imageRoutes } from './routes/images.ts';
import { linkRoutes } from './routes/links.ts';
import { nodeRoutes } from './routes/nodes.ts';
import { packetRoutes } from './routes/packet.ts';
import { projectRoutes } from './routes/projects.ts';
import { secretRoutes } from './routes/secrets.ts';
import { snapshotRoutes } from './routes/snapshots.ts';
import { symbolRoutes } from './routes/symbols.ts';
import { templateRoutes } from './routes/templates.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { userRoutes } from './routes/users.ts';

export type { AppDeps };

export function createAppRouter(deps: AppDeps) {
  const os = createImplementer(deps);
  const jobs = deps.jobs;

  return {
    health: {
      ping: os.health.ping.handler(async ({ context }) => {
        await context.db.unsafe('SELECT 1');
        return {
          status: 'ok' as const,
          version: deps.config.version,
          time: new Date().toISOString(),
        };
      }),
    },
    auth: authRoutes(os),
    ...computeRoutes(os),
    ...projectRoutes(os, deps, jobs),
    ...nodeRoutes(os),
    ...linkRoutes(os, deps),
    ...drawingRoutes(os, deps),
    ...packetRoutes(os),
    ...faultRoutes(os),
    ...templateRoutes(os),
    ...imageRoutes(os, jobs),
    ...applianceRoutes(os, jobs),
    ...symbolRoutes(os),
    ...uploadRoutes(os),
    ...userRoutes(os),
    ...adminRoutes(os),
    ...eventRoutes(os, jobs),
    ...secretRoutes(deps),
    ...snapshotRoutes(os, deps, jobs),
  };
}
