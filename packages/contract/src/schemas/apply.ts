/** Declarative project apply manifest and result. */

import { z } from 'zod';
import { Id, LinkType, NodeStatus, NodeType } from './common.ts';
import { DrawingStyle, DrawingType, LinkStyle } from './links.ts';
import { ProjectRow } from './projects.ts';

export const ProjectApplyFile = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const ProjectApplyNode = z.object({
  name: z.string().min(1).max(128),
  template: z.string().min(1).optional(),
  templateId: Id.optional(),
  nodeType: NodeType.optional(),
  computeId: Id.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().int().optional(),
  layer: z.string().optional(),
  symbol: z.string().optional(),
  locked: z.boolean().optional(),
  consoleAutoStart: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  files: z.array(ProjectApplyFile).default([]),
});

export const ProjectApplyLink = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  /** Exact port names from NodeRow.ports, e.g. Ethernet0 or Ethernet0/0. */
  aPort: z.string().min(1).optional(),
  bPort: z.string().min(1).optional(),
  type: LinkType.default('ethernet'),
  style: LinkStyle.partial().optional(),
});

export const ProjectApplyDrawing = z.object({
  /** Stable identity for reapply and pruning. Stored as style.applyKey. */
  key: z.string().min(1).max(128),
  type: DrawingType,
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(100),
  height: z.number().default(100),
  rotation: z.number().default(0),
  z: z.number().int().default(0),
  layer: z.string().default('default'),
  text: z.string().nullable().optional(),
  svg: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  style: DrawingStyle.partial().default({}),
});

export const ProjectApplyInput = z.object({
  /** Existing project. If omitted, name is used to find or create one. */
  projectId: Id.optional(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  scene: z.record(z.string(), z.unknown()).optional(),
  nodes: z.array(ProjectApplyNode).default([]),
  links: z.array(ProjectApplyLink).default([]),
  drawings: z.array(ProjectApplyDrawing).default([]),
  /** Delete unlisted nodes, links, and keyed drawings. Default false. */
  prune: z.boolean().default(false),
  /** Start every node in the manifest after applying. Default false. */
  start: z.boolean().default(false),
});

export const ProjectApplyNodeResult = z.object({
  name: z.string(),
  id: Id,
  status: NodeStatus,
  created: z.boolean(),
  updated: z.boolean(),
});

export const ProjectApplyLinkResult = z.object({
  id: Id,
  a: z.string(),
  b: z.string(),
  created: z.boolean(),
  updated: z.boolean(),
});

export const ProjectApplyDrawingResult = z.object({
  id: Id,
  key: z.string(),
  created: z.boolean(),
  updated: z.boolean(),
});

export const ProjectApplyResult = z.object({
  projectId: Id,
  project: ProjectRow,
  nodes: z.array(ProjectApplyNodeResult),
  links: z.array(ProjectApplyLinkResult),
  drawings: z.array(ProjectApplyDrawingResult),
  deleted: z.object({
    nodes: z.array(z.string()),
    links: z.array(Id),
    drawings: z.array(Id),
  }),
  started: z.array(z.string()),
});

export type ProjectApplyInput = z.infer<typeof ProjectApplyInput>;
export type ProjectApplyResult = z.infer<typeof ProjectApplyResult>;
export type ProjectApplyNodeInput = z.infer<typeof ProjectApplyNode>;
export type ProjectApplyLinkInput = z.infer<typeof ProjectApplyLink>;
export type ProjectApplyDrawingInput = z.infer<typeof ProjectApplyDrawing>;
