/** Read-only, expiring share links for a project. */

import { z } from 'zod';
import { Id, Timestamp } from './common.ts';

/** Share duration choices offered by the UI, in hours. */
export const SHARE_TTL_HOURS = [1, 24, 72, 168] as const;

export const ShareLinkCreateInput = z.object({
  projectId: Id,
  ttlHours: z.number().int().min(1).max(720).default(24),
});
export type ShareLinkCreateInput = z.infer<typeof ShareLinkCreateInput>;

export const ShareLinkCreated = z.object({
  id: Id,
  /** Bearer token; returned once and never stored in plaintext. */
  token: z.string(),
  /** Same-origin path that redeems the token. */
  path: z.string(),
  expiresAt: Timestamp,
});
export type ShareLinkCreated = z.infer<typeof ShareLinkCreated>;

export const ShareLinkRow = z.object({
  id: Id,
  projectId: Id,
  projectName: z.string(),
  createdByName: z.string().nullable(),
  expiresAt: Timestamp,
  createdAt: Timestamp,
});
export type ShareLinkRow = z.infer<typeof ShareLinkRow>;

export const ShareLinkRedeemInput = z.object({ token: z.string().min(20).max(200) });
export type ShareLinkRedeemInput = z.infer<typeof ShareLinkRedeemInput>;

export const ShareLinkRedeemOutput = z.object({ projectId: Id, projectName: z.string() });
export type ShareLinkRedeemOutput = z.infer<typeof ShareLinkRedeemOutput>;
