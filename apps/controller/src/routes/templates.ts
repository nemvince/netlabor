/** Template, base-config, and catalog routes. */

import type { Implementer } from '../implementer.ts';
import {
  catalogTemplates,
  createTemplate,
  deleteBaseConfig,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listBaseConfigs,
  listTemplates,
  readBaseConfig,
  updateTemplate,
  writeBaseConfig,
} from '../services/templates.ts';

export function templateRoutes(os: Implementer) {
  return {
    templates: {
      list: os.templates.list.handler(async ({ input, context }) =>
        listTemplates(context.db, input),
      ),
      get: os.templates.get.handler(async ({ input, context }) =>
        getTemplate(context.db, input.id),
      ),
      create: os.templates.create.handler(async ({ input, context }) =>
        createTemplate(context.db, context.auth.user?.id ?? null, input),
      ),
      update: os.templates.update.handler(async ({ input, context }) =>
        updateTemplate(context.db, { ...input, id: input.id }),
      ),
      delete: os.templates.delete.handler(async ({ input, context }) => {
        await deleteTemplate(context.db, input.id);
        return { ok: true as const };
      }),
      duplicate: os.templates.duplicate.handler(async ({ input, context }) =>
        duplicateTemplate(context.db, context.auth.user?.id ?? null, input.id, input.name),
      ),
      baseConfigs: {
        list: os.templates.baseConfigs.list.handler(async ({ input, context }) =>
          listBaseConfigs(context.db, input.templateId),
        ),
        read: os.templates.baseConfigs.read.handler(async ({ input, context }) =>
          readBaseConfig(context.db, input.templateId, input.filename),
        ),
        write: os.templates.baseConfigs.write.handler(async ({ input, context }) =>
          writeBaseConfig(context.db, input.templateId, input.filename, input.content),
        ),
        delete: os.templates.baseConfigs.delete.handler(async ({ input, context }) => {
          await deleteBaseConfig(context.db, input.templateId, input.filename);
          return { ok: true as const };
        }),
      },
      catalog: os.templates.catalog.handler(async ({ context }) => catalogTemplates(context.db)),
    },
  };
}
