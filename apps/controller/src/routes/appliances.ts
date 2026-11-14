/** OS image repository and appliance build routes. */

import { AppError } from '@netlabor/contract';
import type { Implementer } from '../implementer.ts';
import {
  adoptOsImage,
  cancelBuild,
  clearBuildLog,
  createBuild,
  createOsImage,
  createTemplateFromBuild,
  deleteOsImage,
  downloadOsImage,
  getBuild,
  listBuilds,
  listOsImages,
  updateOsImage,
} from '../services/appliances.ts';
import type { JobService } from '../services/jobs.ts';

export function applianceRoutes(os: Implementer, jobs: JobService) {
  return {
    appliances: {
      os: {
        list: os.appliances.os.list.handler(async ({ input, context }) =>
          listOsImages(context.db, input),
        ),
        create: os.appliances.os.create.handler(async ({ input, context }) =>
          createOsImage(context, input),
        ),
        update: os.appliances.os.update.handler(async ({ input, context }) =>
          updateOsImage(context, input),
        ),
        delete: os.appliances.os.delete.handler(async ({ input, context }) => {
          await deleteOsImage(context, context.auth.user?.id ?? null, input.id);
          return { ok: true as const };
        }),
        download: os.appliances.os.download.handler(async ({ input, context }) =>
          downloadOsImage(context, jobs, { userId: context.auth.user?.id ?? null }, input),
        ),
        adopt: os.appliances.os.adopt.handler(async ({ input, context }) =>
          adoptOsImage(context, input),
        ),
      },
      builds: {
        list: os.appliances.builds.list.handler(async ({ input, context }) =>
          listBuilds(context.db, input),
        ),
        get: os.appliances.builds.get.handler(async ({ input, context }) =>
          getBuild(context.db, input.id),
        ),
        create: os.appliances.builds.create.handler(async ({ input, context }) => {
          const user = context.auth.user;
          if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
          return createBuild(context, jobs, { userId: user.id }, input);
        }),
        cancel: os.appliances.builds.cancel.handler(async ({ input, context }) =>
          cancelBuild(context, jobs, input),
        ),
        clearLog: os.appliances.builds.clearLog.handler(async ({ input, context }) =>
          clearBuildLog(context, input.id),
        ),
        template: os.appliances.builds.template.handler(async ({ input, context }) =>
          createTemplateFromBuild(context, context.auth.user?.id ?? null, input),
        ),
      },
    },
  };
}
