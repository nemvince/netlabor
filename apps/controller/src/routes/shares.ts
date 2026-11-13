/** Share-link routes: project-scoped CRUD plus public redemption. */

import { AppError } from '@netlabor/contract';
import type { Implementer } from '../implementer.ts';
import { createSession, sessionCookie } from '../services/auth.ts';
import {
  clampSessionExpiry,
  createShareLink,
  listShareLinks,
  redeemShareLink,
  revokeShareLink,
} from '../services/shares.ts';

export function shareRoutes(os: Implementer) {
  return {
    shares: {
      list: os.shares.list.handler(async ({ input, context }) =>
        listShareLinks(context.db, input.projectId),
      ),
      create: os.shares.create.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return createShareLink(context.db, user.id, input);
      }),
      revoke: os.shares.revoke.handler(async ({ input, context }) => {
        await revokeShareLink(context.db, input.projectId, input.id);
        return { ok: true as const };
      }),
      redeem: os.shares.redeem.handler(async ({ input, context }) => {
        const link = await redeemShareLink(context.db, input.token);
        const session = await createSession(context.db, context.config, link.guestUserId, {
          ip: context.request.ip,
          userAgent: context.request.userAgent,
        });
        await clampSessionExpiry(context.db, session.sessionId, link.expiresAt);
        context.resHeaders.append(
          'set-cookie',
          sessionCookie(session.token, context.config, session.expiresAt),
        );
        return { projectId: link.projectId, projectName: link.projectName };
      }),
    },
  };
}
