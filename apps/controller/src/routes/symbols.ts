/** Symbol routes: list, sanitized upload, and delete. */

import type { Implementer } from '../implementer.ts';
import { deleteSymbol, listSymbols, uploadSymbol } from '../services/symbols.ts';

export function symbolRoutes(os: Implementer) {
  return {
    symbols: {
      list: os.symbols.list.handler(async ({ context }) => listSymbols(context.db)),
      upload: os.symbols.upload.handler(async ({ input, context }) =>
        uploadSymbol(context.db, input),
      ),
      delete: os.symbols.delete.handler(async ({ input, context }) => {
        await deleteSymbol(context.db, input.id);
        return { ok: true as const };
      }),
    },
  };
}
