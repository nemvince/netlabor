import { type AppDeps, createImplementer } from '../implementer.ts';
import { createSecret, deleteSecret, listSecrets } from '../services/secrets.ts';

export function secretRoutes(deps: AppDeps) {
  const os = createImplementer(deps);
  return {
    secrets: {
      list: os.secrets.list.handler(async ({ context }) => listSecrets(context.db)),
      create: os.secrets.create.handler(async ({ input, context }) => createSecret(context, input)),
      delete: os.secrets.delete.handler(async ({ input, context }) => {
        await deleteSecret(context.db, input.id);
        return { ok: true as const };
      }),
    },
  };
}
