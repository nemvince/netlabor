/** Shared primitive schemas used by every contract module. */

import { z } from 'zod';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** Timestamps serialise as ISO-8601 strings on the wire. */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

export const Pagination = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

/**
 * OpenAPI "detailed" output for file downloads: the generator requires a
 * literal success status per variant, so full (200) and ranged (206) responses
 * are a union of objects.
 */
export const FileResponse = z.union([
  z.object({
    status: z.literal(200),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any(),
  }),
  z.object({
    status: z.literal(206),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any(),
  }),
]);
export type FileResponse = z.infer<typeof FileResponse>;

export const NODE_TYPES = [
  'qemu',
  'iou',
  'dynamips',
  'vpcs',
  'docker',
  'cloud',
  'nat',
  'ethernet_switch',
  'ethernet_hub',
  'atm_switch',
  'frame_relay_switch',
] as const;
export const NodeType = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeType>;

export const CONSOLE_TYPES = ['telnet', 'none', 'vnc', 'http', 'https'] as const;
export const ConsoleType = z.enum(CONSOLE_TYPES);
export type ConsoleType = z.infer<typeof ConsoleType>;

export const NODE_STATUSES = ['stopped', 'started', 'suspended', 'error'] as const;
export const NodeStatus = z.enum(NODE_STATUSES);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const LINK_TYPES = ['ethernet', 'serial', 'atm', 'frame_relay'] as const;
export const LinkType = z.enum(LINK_TYPES);
export type LinkType = z.infer<typeof LinkType>;

export const LINK_STATUSES = ['pending', 'active', 'suspended', 'error'] as const;
export const LinkStatus = z.enum(LINK_STATUSES);
export type LinkStatus = z.infer<typeof LinkStatus>;

export const CAPTURE_DLTS = [
  'DLT_EN10MB',
  'DLT_C_HDLC',
  'DLT_PPP_SERIAL',
  'DLT_FRELAY',
  'DLT_ATM_RFC1483',
] as const;
export const CaptureDlt = z.enum(CAPTURE_DLTS);
export type CaptureDlt = z.infer<typeof CaptureDlt>;

export const LaneType = z.enum(['ethernet', 'serial', 'atm', 'frame_relay']);
export type LaneType = z.infer<typeof LaneType>;

export const NodePort = z.object({
  adapter: z.number().int().min(0),
  port: z.number().int().min(0),
  name: z.string(),
  type: LaneType,
  /** For Dynamips and switch mappings the source template adapter id. */
  adapterType: z.string().optional(),
});
export type NodePort = z.infer<typeof NodePort>;

export const JsonObject = z.record(z.string(), z.unknown());

export const Vector = z.object({ x: z.number(), y: z.number() });
