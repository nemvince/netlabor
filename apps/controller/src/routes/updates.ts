/** Controller update checks and installation. */

import type { AppDeps, Implementer } from '../implementer.ts';
import { applyUpdate, checkUpdate } from '../services/updates.ts';

export function updateRoutes(os: Implementer, deps: AppDeps) {
  return {
    updates: {
      check: os.updates.check.handler(async () => (await checkUpdate(deps)).status),
      apply: os.updates.apply.handler(async () => applyUpdate(deps)),
    },
  };
}
