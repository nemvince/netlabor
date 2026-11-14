/** Projects, slots, project files, project templates, and snapshots. */

import { z } from 'zod';
import { Id, LaneType, Timestamp } from './common.ts';

export const PROJECT_STATUSES = ['closed', 'opened'] as const;
export const ProjectStatus = z.enum(PROJECT_STATUSES);

export const ProjectRow = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  status: ProjectStatus,
  locked: z.boolean(),
  ownerId: Id,
  ownerName: z.string(),
  poolId: Id.nullable(),
  variables: z.record(z.string(), z.string()),
  scene: z.record(z.string(), z.unknown()),
  autoOpen: z.boolean(),
  autoClose: z.boolean(),
  autoStart: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  nodeCount: z.number().int(),
  linkCount: z.number().int(),
});
export type ProjectRow = z.infer<typeof ProjectRow>;

export type ProjectListInput = z.infer<typeof ProjectListInput>;

export const ProjectListInput = z.object({
  search: z.string().optional(),
  status: ProjectStatus.optional(),
  includeClosed: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const ProjectCreateInput = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
  poolId: Id.nullable().optional(),
  variables: z.record(z.string(), z.string()).default({}),
  autoOpen: z.boolean().default(false),
  autoClose: z.boolean().default(false),
  autoStart: z.boolean().default(false),
});

export const ProjectUpdateInput = z.object({
  id: Id,
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  ownerId: Id.optional(),
  poolId: Id.nullable().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  scene: z.record(z.string(), z.unknown()).optional(),
  autoOpen: z.boolean().optional(),
  autoClose: z.boolean().optional(),
  autoStart: z.boolean().optional(),
});

export const ProjectSlot = z.object({
  computeId: Id,
  slot: z.number().int(),
  netns: z.string(),
  projectIp: z.string(),
  ubridgeSocket: z.string().nullable(),
});
export type ProjectSlot = z.infer<typeof ProjectSlot>;

export type ProjectStats = z.infer<typeof ProjectStats>;

export const ProjectStats = z.object({
  nodeCount: z.number().int(),
  linkCount: z.number().int(),
  drawingCount: z.number().int(),
  nodesByStatus: z.record(z.string(), z.number().int()),
  slots: z.array(ProjectSlot),
});

export const ProjectExportOutput = z.object({ downloadUrl: z.string(), jobId: Id });

export const ProjectImportInput = z.object({
  uploadId: Id,
  name: z.string().min(1).max(128).optional(),
});

export type ProjectFileEntry = z.infer<typeof ProjectFileEntry>;

export const ProjectFileEntry = z.object({
  path: z.string(),
  sizeBytes: z.number(),
  mtime: Timestamp,
  directory: z.boolean(),
});

export const ProjectFileWriteInput = z.object({
  projectId: Id,
  path: z.string().min(1).max(1_024),
  content: z.string().max(32 * 1024 * 1024),
  /** When 'base64', content decodes to raw bytes; text (utf8) otherwise. */
  encoding: z.enum(['base64']).optional(),
});

export type ProjectFileReadOutput = z.infer<typeof ProjectFileReadOutput>;

export const ProjectFileReadOutput = z.object({
  path: z.string(),
  content: z.string(),
  sizeBytes: z.number(),
});

export const ProjectTemplateRow = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
});
export type ProjectTemplateRow = z.infer<typeof ProjectTemplateRow>;

export const ProjectTemplateCreateInput = z.object({
  projectId: Id,
  name: z.string().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
});

export const ProjectTemplateApplyInput = z.object({
  templateId: Id,
  name: z.string().min(1).max(128),
  poolId: Id.nullable().optional(),
});

export type NodeSnapshot = z.infer<typeof NodeSnapshot>;

export const NodeSnapshot = z.object({
  id: Id,
  projectId: Id,
  computeId: Id,
  name: z.string(),
  symbol: z.string(),
  nodeType: z.string(),
  templateId: Id.nullable(),
  x: z.number(),
  y: z.number(),
  z: z.number().int(),
  layer: z.string(),
  locked: z.boolean(),
  isolated: z.boolean(),
  consolePort: z.number().int().nullable(),
  consoleType: z.string(),
  consoleAutoStart: z.boolean(),
  properties: z.record(z.string(), z.unknown()),
  status: z.string(),
});

export type LinkSnapshot = z.infer<typeof LinkSnapshot>;

export const LinkSnapshot = z.object({
  id: Id,
  projectId: Id,
  linkType: LaneType,
  nodeAId: Id,
  adapterA: z.number().int(),
  portA: z.number().int(),
  nodeBId: Id,
  adapterB: z.number().int(),
  portB: z.number().int(),
  suspend: z.boolean(),
  status: z.string(),
  style: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  capture: z.record(z.string(), z.unknown()).nullable(),
  dataplane: z.record(z.string(), z.unknown()).nullable(),
});

export type DrawingSnapshot = z.infer<typeof DrawingSnapshot>;

export const DrawingSnapshot = z.object({
  id: Id,
  projectId: Id,
  type: z.string(),
  svg: z.string().nullable(),
  text: z.string().nullable(),
  filePath: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  z: z.number().int(),
  layer: z.string(),
  locked: z.boolean(),
  style: z.record(z.string(), z.unknown()),
});

export type MarkerSnapshot = z.infer<typeof MarkerSnapshot>;

export const MarkerSnapshot = z.object({
  id: Id,
  projectId: Id,
  linkId: Id,
  name: z.string(),
  bpf: z.string(),
  tag: z.number().int(),
  color: z.string(),
  highlightDuration: z.number().int(),
  direction: z.enum(['tx', 'rx']).nullable(),
  enabled: z.boolean(),
  paused: z.boolean(),
});

/** `netlabor.project/1` manifest. */
export const ProjectManifest = z.object({
  format: z.literal('netlabor.project/1'),
  createdAt: Timestamp,
  project: z.object({
    name: z.string(),
    description: z.string().nullable(),
    variables: z.record(z.string(), z.string()),
    scene: z.record(z.string(), z.unknown()),
  }),
  nodes: z.array(NodeSnapshot),
  links: z.array(LinkSnapshot),
  drawings: z.array(DrawingSnapshot),
  markers: z.array(MarkerSnapshot),
  templates: z.array(z.record(z.string(), z.unknown())),
  /** nodeId -> computeId, so import can route files per agent. */
  nodeComputes: z.record(z.string(), Id),
});
export type ProjectManifest = z.infer<typeof ProjectManifest>;

export const SnapshotRow = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  description: z.string().nullable(),
  sha256: z.string(),
  sizeBytes: z.number(),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
});
export type SnapshotRow = z.infer<typeof SnapshotRow>;

export const SnapshotCreateInput = z.object({
  projectId: Id,
  name: z.string().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
});

export const ProjectDuplicateInput = z.object({
  id: Id,
  name: z.string().min(1).max(128),
  includeFiles: z.boolean().default(true),
});
