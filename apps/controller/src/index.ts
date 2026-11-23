/** Controller entrypoint: config, database, bootstrap, and HTTP server. */

import { createDb } from '@netlabor/db';
import { createLogger, TicketStore } from '@netlabor/shared';
import { isSecureOrigin, loadControllerConfig } from './config.ts';
import { EventBus } from './realtime/events.ts';
import { startServer } from './server.ts';
import { AgentEventSubscriptions } from './services/agent-events.ts';
import { AgentRegistry } from './services/agents.ts';
import { autoOpenAndStart } from './services/auto-lifecycle.ts';
import { bootstrap, waitForDatabase } from './services/bootstrap.ts';
import { ensureImageStore } from './services/images.ts';
import { JobService } from './services/jobs.ts';
import { ensureStagingDir } from './services/uploads.ts';
import { Maintenance } from './services/maintenance.ts';
import { ComputeMonitor } from './services/monitor.ts';
import { reconcileNodeConsolePorts } from './services/nodes.ts';
import { reconcileOpenProjects } from './services/projects.ts';

const config = loadControllerConfig();
const logger = createLogger({
  service: 'controller',
  level: config.logLevel,
  pretty: config.logPretty,
});
const db = createDb(config.databaseUrl);
const events = new EventBus(db, logger);
const agents = new AgentRegistry(db, config, logger);
const jobs = new JobService(db, events, logger);
const deps = { db, config, logger, events, agents, jobs };

await ensureStagingDir(config);
await ensureImageStore(deps);
await waitForDatabase(db);
const releaseLock = await bootstrap(deps);

await reconcileNodeConsolePorts(deps);
const running = startServer(deps, new TicketStore(config.secretKey));
const monitor = new ComputeMonitor(deps);
await monitor.start();
await reconcileOpenProjects(deps);
await autoOpenAndStart(deps);
const maintenance = new Maintenance(deps, logger);
maintenance.start();
const agentEvents = new AgentEventSubscriptions(deps);
await agentEvents.start();

logger.info('controller listening', {
  url: `http://${running.server.hostname}:${running.server.port}`,
  publicUrl: config.publicUrl,
  secureCookies: isSecureOrigin(config),
  version: config.version,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('controller shutting down', { signal });
  monitor.stop();
  maintenance.stop();
  agentEvents.stop();
  await running.stop();
  await releaseLock();
  await db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
