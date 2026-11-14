/** Curated appliance marketplace: catalog rows and one-click install. */

import { z } from 'zod';
import { Id } from './common.ts';

export const MarketplaceListInput = z.object({
  search: z.string().max(200).optional(),
});
export type MarketplaceListInput = z.infer<typeof MarketplaceListInput>;

export const MarketplaceApplianceRow = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  category: z.string(),
  description: z.string(),
  status: z.enum(['stable', 'experimental']),
  nodeType: z.enum(['qemu', 'docker']),
  symbol: z.string(),
  arch: z.string(),
  version: z.string().nullable(),
  imageFilename: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  registryFile: z.string(),
  /** A template with this appliance's name already exists. */
  installed: z.boolean(),
  templateId: Id.nullable(),
});
export type MarketplaceApplianceRow = z.infer<typeof MarketplaceApplianceRow>;

export const MarketplaceInstallInput = z.object({ applianceId: z.string().min(1).max(128) });
export type MarketplaceInstallInput = z.infer<typeof MarketplaceInstallInput>;
