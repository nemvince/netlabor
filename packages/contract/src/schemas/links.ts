/** Links: rows, styles, filters, capture state, and markers. */

import { z } from 'zod';
import { CaptureDlt, Id, LaneType, LinkStatus, LinkType, Timestamp } from './common.ts';

export const LinkStyle = z.object({
  color: z.string().optional(),
  width: z.number().optional(),
  dash: z.string().nullable().optional(),
  // GNS3/Packet Tracer draw point-to-point straight lines; that's the default.
  type: z.enum(['straight', 'bezier', 'orthogonal']).default('straight'),
  label: z.string().optional(),
  labelPosition: z.enum(['top', 'bottom', 'center']).optional(),
  sourceArrow: z.boolean().optional(),
  targetArrow: z.boolean().optional(),
});
export type LinkStyle = z.infer<typeof LinkStyle>;

export const LinkFilters = z.object({
  delayMs: z.number().int().min(0).max(32767).optional(),
  jitterMs: z.number().int().min(0).max(32767).optional(),
  lossPct: z.number().min(0).max(100).optional(),
  corruptPct: z.number().min(0).max(100).optional(),
  frequencyDrop: z.number().int().min(-1).max(32767).optional(),
  /** Bandwidth cap; kernel dataplane only (tc netem rate). */
  rateKbps: z.number().int().min(1).max(10_000_000).optional(),
  bpf: z.string().max(4096).optional(),
});
export type LinkFilters = z.infer<typeof LinkFilters>;

export const EMPTY_FILTERS: LinkFilters = {};

export function filtersAreEmpty(filters: LinkFilters): boolean {
  return (
    filters.delayMs === undefined &&
    filters.jitterMs === undefined &&
    filters.lossPct === undefined &&
    filters.corruptPct === undefined &&
    filters.frequencyDrop === undefined &&
    filters.rateKbps === undefined &&
    filters.bpf === undefined
  );
}

export const CaptureState = z.object({
  active: z.boolean(),
  path: z.string(),
  sizeBytes: z.number(),
  dlt: CaptureDlt,
  captureNodeId: Id.nullable(),
  startedAt: Timestamp.nullable(),
});
export type CaptureState = z.infer<typeof CaptureState>;

export const LinkDataplane = z.object({
  mode: z.enum(['kernel', 'relay']),
  captureNodeId: Id.nullable(),
  filterSide: Id.nullable(),
  endpoints: z.array(
    z.object({
      computeId: Id,
      anchor: z.string(),
      lport: z.number().int().nullable(),
      anchorKind: z.enum(['tap', 'veth', 'udp']).nullable(),
    }),
  ),
  peer: z.object({ computeId: Id, ip: z.string(), port: z.number().int() }).nullable(),
});
export type LinkDataplane = z.infer<typeof LinkDataplane>;

export const LinkRow = z.object({
  id: Id,
  projectId: Id,
  linkType: LinkType,
  nodeAId: Id,
  nodeAName: z.string(),
  adapterA: z.number().int(),
  portA: z.number().int(),
  nodeBId: Id,
  nodeBName: z.string(),
  adapterB: z.number().int(),
  portB: z.number().int(),
  suspend: z.boolean(),
  status: LinkStatus,
  style: LinkStyle,
  filters: LinkFilters,
  capture: CaptureState.nullable(),
  dataplane: LinkDataplane.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type LinkRow = z.infer<typeof LinkRow>;

export const LinkCreateInput = z.object({
  projectId: Id,
  nodeAId: Id,
  adapterA: z.number().int().min(0),
  portA: z.number().int().min(0),
  nodeBId: Id,
  adapterB: z.number().int().min(0),
  portB: z.number().int().min(0),
  style: LinkStyle.partial().optional(),
});

export const LinkUpdateInput = z.object({
  id: Id,
  style: LinkStyle.partial().optional(),
  suspend: z.boolean().optional(),
});

export const FiltersInput = z.object({ linkId: Id, filters: LinkFilters });

export const CaptureStartInput = z.object({ linkId: Id, dlt: CaptureDlt.optional() });

export const CaptureTicketOutput = z.object({
  ticket: z.string(),
  wsUrl: z.string(),
  pcapUrl: z.string(),
});

export const MarkerRow = z.object({
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
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type MarkerRow = z.infer<typeof MarkerRow>;

export const MarkerInput = z.object({
  linkId: Id,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, 'letters, digits, dot, dash, underscore only'),
  bpf: z.string().min(1).max(4096),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  highlightDuration: z.number().int().min(100).max(60_000).default(1000),
  direction: z.enum(['tx', 'rx']).nullable().default(null),
  enabled: z.boolean().default(true),
});

export const MarkerUpdateInput = MarkerInput.partial().extend({
  id: Id,
  paused: z.boolean().optional(),
});

export const DrawingType = z.enum(['rect', 'ellipse', 'line', 'text', 'note', 'image']);

export const DrawingStyle = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  dash: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  fontSize: z.number().optional(),
  fontWeight: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  /** Stable identity used by declarative project apply. */
  applyKey: z.string().max(128).optional(),
});

export const DrawingRow = z.object({
  id: Id,
  projectId: Id,
  type: DrawingType,
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
  style: DrawingStyle,
});
export type DrawingRow = z.infer<typeof DrawingRow>;

export const DrawingCreateInput = z.object({
  projectId: Id,
  type: DrawingType,
  x: z.number(),
  y: z.number(),
  width: z.number().default(100),
  height: z.number().default(100),
  rotation: z.number().default(0),
  z: z.number().int().default(0),
  layer: z.string().default('default'),
  text: z.string().nullable().optional(),
  svg: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  style: DrawingStyle.default({}),
});

export const DrawingUpdateInput = DrawingCreateInput.partial().extend({ id: Id });

export const LaneKind = LaneType;
