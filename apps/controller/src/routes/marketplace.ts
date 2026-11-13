/** Marketplace routes: browse the catalog and install an appliance. */

import type { Implementer } from '../implementer.ts';
import { installMarketplace, listMarketplace } from '../services/marketplace.ts';

export function marketplaceRoutes(os: Implementer, deps: Parameters<typeof installMarketplace>[0]) {
  return {
    marketplace: {
      list: os.marketplace.list.handler(async ({ input, context }) =>
        listMarketplace(context.db, input),
      ),
      install: os.marketplace.install.handler(async ({ input, context }) =>
        installMarketplace(deps, context.jobs, { userId: context.auth.user?.id ?? null }, input),
      ),
    },
  };
}
