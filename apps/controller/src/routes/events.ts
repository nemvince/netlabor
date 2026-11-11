/** Event subscription and job routes. */

import type { Implementer } from '../implementer.ts';
import type { JobService } from '../services/jobs.ts';
import { visibleProjectIds } from '../services/projects.ts';

export function eventRoutes(os: Implementer, jobs: JobService) {
  return {
    events: {
      subscribe: os.events.subscribe.handler(async function* ({ input, context, signal }) {
        const user = context.auth.user;
        if (!user) return;
        const visible = await visibleProjectIds(context.db, context.auth);
        yield* context.events.stream({
          lastEventId: input.lastEventId,
          signal,
          filter: (event) => {
            if (visible === 'all') return true;
            if (event.userId === user.id) return true;
            if (event.projectId && visible.includes(event.projectId)) return true;
            return event.projectId === null && event.userId === null;
          },
        });
      }),
    },
    jobs: {
      list: os.jobs.list.handler(async ({ input }) => jobs.list(input)),
      get: os.jobs.get.handler(async ({ input }) => jobs.get(input.id)),
      cancel: os.jobs.cancel.handler(async ({ input }) => jobs.cancel(input.id)),
    },
  };
}
