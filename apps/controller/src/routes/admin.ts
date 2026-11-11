/** Audit log and global settings routes. */

import type { Implementer } from '../implementer.ts';
import {
  getPreferences,
  getSettings,
  listAudit,
  setPreferences,
  updateSettings,
} from '../services/rbac.ts';

export function adminRoutes(os: Implementer) {
  return {
    audit: {
      list: os.audit.list.handler(async ({ input, context }) =>
        listAudit(context.db, {
          ...(input.action ? { action: input.action } : {}),
          ...(input.resourceType ? { resourceType: input.resourceType } : {}),
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.since ? { since: input.since } : {}),
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    },
    settings: {
      get: os.settings.get.handler(async ({ context }) => getSettings(context.db)),
      update: os.settings.update.handler(async ({ input, context }) =>
        updateSettings(context.db, input),
      ),
    },
    preferences: {
      get: os.preferences.get.handler(async ({ context }) => {
        const user = context.auth.user;
        if (!user) return {};
        return getPreferences(context.db, user.id);
      }),
      update: os.preferences.update.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) return {};
        return setPreferences(context.db, user.id, input.value);
      }),
    },
  };
}
