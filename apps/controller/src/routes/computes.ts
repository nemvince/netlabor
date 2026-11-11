/** Compute and pool routes. */

import { AppError, type ComputePingResult } from '@netlabor/contract';
import type { Implementer } from '../implementer.ts';
import {
  agentEnvironment,
  computeStats,
  createCompute,
  deleteCompute,
  deletePool,
  getCompute,
  listComputes,
  listPools,
  rotateToken,
  setComputeStatus,
  updateCompute,
  upsertPool,
} from '../services/computes.ts';

export function computeRoutes(os: Implementer) {
  return {
    computes: {
      list: os.computes.list.handler(async ({ context }) => listComputes(context.db)),
      get: os.computes.get.handler(async ({ input, context }) => getCompute(context.db, input.id)),
      create: os.computes.create.handler(async ({ input, context }) => {
        const created = await createCompute(
          { ...context },
          {
            name: input.name,
            url: input.url,
            underlayHost: input.underlayHost,
            poolIds: input.poolIds,
          },
        );
        return {
          ...created,
          environment: agentEnvironment(context, created.compute, created.token),
        };
      }),
      update: os.computes.update.handler(async ({ input, context }) =>
        updateCompute(
          { ...context },
          {
            id: input.id,
            ...(input.name ? { name: input.name } : {}),
            ...(input.url ? { url: input.url } : {}),
            ...(input.underlayHost ? { underlayHost: input.underlayHost } : {}),
            ...(input.poolIds ? { poolIds: input.poolIds } : {}),
          },
        ),
      ),
      delete: os.computes.delete.handler(async ({ input, context }) => {
        await deleteCompute({ ...context }, input.id);
        return { ok: true as const };
      }),
      rotateToken: os.computes.rotateToken.handler(async ({ input, context }) => {
        const token = await rotateToken({ ...context }, input.id);
        const compute = await getCompute(context.db, input.id);
        return { token, environment: agentEnvironment(context, compute, token) };
      }),
      ping: os.computes.ping.handler(async ({ input, context }): Promise<ComputePingResult> => {
        const started = performance.now();
        try {
          const info = await context.agents.call(input.id, (agent) => agent.info({}));
          const capabilities = await context.agents.call(input.id, (agent) =>
            agent.capabilities({}),
          );
          await setComputeStatus(context.db, input.id, 'online', {
            version: info.version,
            capabilities,
          });
          return {
            status: 'online',
            version: info.version,
            latencyMs: performance.now() - started,
          };
        } catch (error) {
          await setComputeStatus(context.db, input.id, 'offline');
          if (error instanceof AppError && error.code === 'AGENT_UNAVAILABLE') {
            return { status: 'offline', version: null, latencyMs: performance.now() - started };
          }
          throw error;
        }
      }),
      stats: os.computes.stats.handler(async ({ input, context }) =>
        computeStats({ ...context }, input.id),
      ),
      dockerImages: {
        list: os.computes.dockerImages.list.handler(async ({ input, context }) => {
          const images = await context.agents.call(input.id, (agent) =>
            agent.docker.images.list({}),
          );
          return images;
        }),
        pull: os.computes.dockerImages.pull.handler(async ({ input, context }) => {
          const job = await context.jobs.create('docker.pull', {
            computeId: input.id,
            image: input.image,
          });
          void (async () => {
            try {
              await context.agents.call(input.id, (agent) =>
                agent.docker.images.pull({ image: input.image, jobId: job.id }),
              );
              await context.jobs.complete(job.id, { image: input.image });
            } catch (error) {
              await context.jobs.fail(
                job.id,
                error instanceof Error ? error.message : String(error),
              );
            }
          })();
          return context.jobs.get(job.id);
        }),
      },
      dynamipsIdlepcProposals: os.computes.dynamipsIdlepcProposals.handler(async () => {
        throw new AppError(
          'CAPABILITY_UNSUPPORTED',
          'idle-PC proposals arrive with the Dynamips milestone',
        );
      }),
    },

    pools: {
      list: os.pools.list.handler(async ({ context }) => listPools(context.db)),
      create: os.pools.create.handler(async ({ input, context }) =>
        upsertPool(context.db, {
          name: input.name,
          description: input.description ?? null,
          computeIds: input.computeIds,
        }),
      ),
      update: os.pools.update.handler(async ({ input, context }) =>
        upsertPool(context.db, {
          id: input.id,
          name: input.name,
          description: input.description ?? null,
          computeIds: input.computeIds,
        }),
      ),
      delete: os.pools.delete.handler(async ({ input, context }) => {
        await deletePool(context.db, input.id);
        return { ok: true as const };
      }),
    },
  };
}
