/** Images, uploads, templates, symbols, settings, jobs, faults, and packets. */

import { z } from 'zod';
import { CaptureDlt, Id, NodeType, Timestamp } from './common.ts';

export const IMAGE_KINDS = ['qemu', 'iou', 'dynamips', 'docker', 'firmware'] as const;
export const ImageKind = z.enum(IMAGE_KINDS);
export type ImageKind = z.infer<typeof ImageKind>;

export const ReplicaState = z.enum(['present', 'syncing', 'missing']);

export const ImageRow = z.object({
  id: Id,
  name: z.string(),
  kind: ImageKind,
  filename: z.string(),
  sha256: z.string(),
  sizeBytes: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
  replicas: z.array(
    z.object({
      computeId: Id,
      computeName: z.string(),
      state: ReplicaState,
      path: z.string().nullable(),
      verifiedAt: Timestamp.nullable(),
    }),
  ),
});
export type ImageRow = z.infer<typeof ImageRow>;

export type ImageListInput = z.infer<typeof ImageListInput>;

export const ImageListInput = z.object({
  kind: ImageKind.optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const ImageCreateInput = z.object({
  uploadId: Id,
  name: z.string().min(1).max(200),
  kind: ImageKind,
});

export type ImageSyncInput = z.infer<typeof ImageSyncInput>;

export const ImageSyncInput = z.object({
  imageId: Id,
  computeIds: z.array(Id).min(1),
});

export type ImagePruneInput = z.infer<typeof ImagePruneInput>;

export const ImagePruneInput = z.object({ dryRun: z.boolean().default(true) });

export const UploadStartInput = z.object({
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export type UploadStartOutput = z.infer<typeof UploadStartOutput>;

export const UploadStartOutput = z.object({
  uploadId: Id,
  chunkSize: z.number().int(),
  receivedBytes: z.number().int(),
});

export type UploadStatus = z.infer<typeof UploadStatus>;

export const UploadStatus = z.object({
  uploadId: Id,
  filename: z.string(),
  sha256: z.string().nullable(),
  sizeBytes: z.number(),
  receivedBytes: z.number(),
  state: z.enum(['pending', 'complete', 'cancelled']),
});

export const RequiredImage = z.object({
  name: z.string(),
  kind: ImageKind,
  filenamePattern: z.string(),
  sha256: z.string().optional(),
});

export const TemplateFault = z.object({
  id: z.string(),
  label: z.string(),
  params: z.array(z.string()).default([]),
  commands: z.array(z.string()),
  recovery: z.array(z.string()),
  prompt: z.string().optional(),
  requires: z.array(z.string()).default([]),
});
export type TemplateFault = z.infer<typeof TemplateFault>;

export const TemplateRow = z.object({
  id: Id,
  name: z.string(),
  nodeType: NodeType,
  category: z.string(),
  symbol: z.string(),
  defaultNameFormat: z.string(),
  computeId: Id.nullable(),
  poolId: Id.nullable(),
  properties: z.record(z.string(), z.unknown()),
  builtin: z.boolean(),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  requiredImages: z.array(RequiredImage),
  faults: z.array(TemplateFault),
  /** Project the template belongs to; null for the global library. */
  projectId: Id.nullable(),
});
export type TemplateRow = z.infer<typeof TemplateRow>;

export type TemplateListInput = z.infer<typeof TemplateListInput>;

export const TemplateListInput = z.object({
  /** Include this project's templates next to the global library. */
  projectId: Id.optional(),
  nodeType: NodeType.optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});

export const TemplateInput = z.object({
  id: Id.optional(),
  name: z.string().min(1).max(128),
  nodeType: NodeType,
  category: z.string().min(1).max(64).default('General'),
  symbol: z.string().min(1).max(128).default('router'),
  defaultNameFormat: z.string().min(1).max(128).default('{name}-{index}'),
  computeId: Id.nullable().optional(),
  poolId: Id.nullable().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  requiredImages: z.array(RequiredImage).default([]),
  faults: z.array(TemplateFault).default([]),
  /** Restrict the template to one project; null keeps it in the global library. */
  projectId: Id.nullable().optional(),
});

export const TemplateDuplicateInput = z.object({
  id: Id,
  name: z.string().min(1).max(128),
});

export const BaseConfigFile = z.object({ filename: z.string(), content: z.string() });

export const BaseConfigListInput = z.object({ templateId: Id });
export const BaseConfigReadInput = z.object({ templateId: Id, filename: z.string() });
export const BaseConfigWriteInput = z.object({
  templateId: Id,
  filename: z.string().min(1).max(128),
  content: z.string(),
});

export type SymbolRow = z.infer<typeof SymbolRow>;

export const SymbolRow = z.object({
  id: z.string(),
  name: z.string(),
  svg: z.string(),
  theme: z.string().nullable(),
  builtin: z.boolean(),
});

export const SymbolUploadInput = z.object({
  name: z.string().min(1).max(128),
  svg: z
    .string()
    .min(1)
    .max(512 * 1024),
});

export const SettingsPatch = z.record(z.string(), z.unknown());
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export type JobsListInput = z.infer<typeof JobsListInput>;

export const JobsListInput = z.object({
  kind: z.string().optional(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
  projectId: Id.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const JobRow = z.object({
  id: Id,
  kind: z.string(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(100),
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type JobRow = z.infer<typeof JobRow>;

export const FaultTarget = z.object({
  kind: z.enum(['link', 'device']),
  linkIds: z.array(Id).optional(),
  nodeIds: z.array(Id).optional(),
});

export type FaultInjectInput = z.infer<typeof FaultInjectInput>;

export const FaultInjectInput = z.object({
  projectId: Id,
  count: z.union([z.number().int().min(1).max(3), z.literal('random')]).default(1),
  target: FaultTarget.optional(),
  faultIds: z.array(z.string()).optional(),
});

export const FaultRow = z.object({
  id: Id,
  projectId: Id,
  kind: z.enum(['link', 'device']),
  target: z.record(z.string(), z.unknown()),
  params: z.record(z.string(), z.unknown()),
  state: z.enum(['active', 'cleared', 'error']),
  recovery: z.record(z.string(), z.unknown()).nullable(),
  createdAt: Timestamp,
  clearedAt: Timestamp.nullable(),
});
export type FaultRow = z.infer<typeof FaultRow>;

export const FaultClearInput = z.object({ projectId: Id, faultIds: z.array(Id).optional() });

export type PacketAnalyzeInput = z.infer<typeof PacketAnalyzeInput>;

export const PacketAnalyzeInput = z.object({
  linkId: Id,
  displayFilter: z.string().max(4096).optional(),
  fields: z.array(z.string().max(128)).max(32).optional(),
  limit: z.number().int().min(1).max(2000).default(200),
});

export type PacketFrame = z.infer<typeof PacketFrame>;

export const PacketFrame = z.object({
  number: z.number().int(),
  timeRelative: z.number().nullable(),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  protocol: z.string().nullable(),
  info: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()),
});

export type PacketAnalyzeOutput = z.infer<typeof PacketAnalyzeOutput>;

export const PacketAnalyzeOutput = z.object({
  frames: z.array(PacketFrame),
  total: z.number().int(),
  truncated: z.boolean(),
  protocols: z.record(z.string(), z.number().int()),
  dlt: CaptureDlt.nullable(),
});

export const PacketFieldsInput = z.object({ query: z.string().max(128).default('') });

export type PacketFieldRow = z.infer<typeof PacketFieldRow>;

export const PacketFieldRow = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  protocol: z.string(),
});

export const SecretRow = z.object({
  id: Id,
  name: z.string(),
  createdAt: Timestamp,
});
export type SecretRow = z.infer<typeof SecretRow>;

export const SecretInput = z.object({
  name: z.string().min(1).max(128),
  value: z.string().min(1).max(65536),
});
export type SecretInput = z.infer<typeof SecretInput>;
