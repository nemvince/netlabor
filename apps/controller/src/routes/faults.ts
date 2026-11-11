/** Fault injection routes. */

import { AppError } from '@netlabor/contract';
import type { Implementer } from '../implementer.ts';
import { clearFaults, faultCatalog, injectFaults, listFaults } from '../services/faults.ts';

export function faultRoutes(os: Implementer) {
  return {
    faults: {
      list: os.faults.list.handler(async ({ input, context }) =>
        listFaults(context, input.projectId),
      ),
      inject: os.faults.inject.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return injectFaults(context, user.id, {
          projectId: input.projectId,
          count: input.count,
          ...(input.target ? { target: input.target } : {}),
          ...(input.faultIds ? { faultIds: input.faultIds } : {}),
        });
      }),
      clear: os.faults.clear.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return clearFaults(context, user.id, {
          projectId: input.projectId,
          ...(input.faultIds ? { faultIds: input.faultIds } : {}),
        });
      }),
    },
  };
}

export { faultCatalog };
