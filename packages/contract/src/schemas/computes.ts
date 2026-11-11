/** Compute servers, pools, agent-visible capability and statistics payloads. */

import { z } from 'zod';
import { Id, Timestamp } from './common.ts';

export const COMPUTE_STATUSES = ['online', 'offline', 'error'] as const;
export const ComputeStatus = z.enum(COMPUTE_STATUSES);

export const AgentCapabilities = z.object({
  kernel: z.string(),
  kernelDataplane: z.boolean(),
  ubridge: z.string().nullable(),
  ubridgeFeatures: z.array(z.string()),
  qemu: z.string().nullable(),
  qemuKvm: z.boolean(),
  docker: z.string().nullable(),
  dynamips: z.string().nullable(),
  iou: z.string().nullable(),
  vpcs: z.string().nullable(),
  sharkd: z.string().nullable(),
  tshark: z.string().nullable(),
  tcpdump: z.string().nullable(),
  netns: z.boolean(),
  /** Host NAT bridge exists (provision-nat-bridge.sh); gates the NAT node. */
  natBridge: z.boolean().optional(),
  /** Allowlisted cloud interfaces (NB_CLOUD_INTERFACES); gates the Cloud node. */
  cloudInterfaces: z.array(z.string()).optional(),
  storageDriver: z.enum(['local', 'nfs']),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilities>;

export const ComputeRow = z.object({
  id: Id,
  name: z.string(),
  url: z.string(),
  underlayIndex: z.number().int(),
  underlayHost: z.string(),
  status: ComputeStatus,
  version: z.string().nullable(),
  capabilities: AgentCapabilities.nullable(),
  lastSeenAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  pools: z.array(z.object({ id: Id, name: z.string() })),
});
export type ComputeRow = z.infer<typeof ComputeRow>;

export const ComputeCreateInput = z.object({
  name: z.string().min(1).max(64),
  url: z.string().url(),
  underlayHost: z.string().min(1),
  poolIds: z.array(Id).default([]),
});
export type ComputeCreateInput = z.infer<typeof ComputeCreateInput>;

export const ComputeUpdateInput = z.object({
  id: Id,
  name: z.string().min(1).max(64).optional(),
  url: z.string().url().optional(),
  underlayHost: z.string().min(1).optional(),
  poolIds: z.array(Id).optional(),
});

export const ComputeCreated = z.object({
  compute: ComputeRow,
  token: z.string(),
  environment: z.string(),
});

export const ComputeTokenRotated = z.object({ token: z.string(), environment: z.string() });

export const ComputeStats = z.object({
  computeId: Id,
  cpuCount: z.number().int(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  memoryTotalBytes: z.number(),
  memoryUsedBytes: z.number(),
  diskTotalBytes: z.number(),
  diskUsedBytes: z.number(),
  processCount: z.number().int(),
  uptimeSeconds: z.number(),
  processes: z.array(
    z.object({
      pid: z.number().int(),
      name: z.string(),
      nodeId: Id.nullable(),
      cpuPercent: z.number(),
      memoryBytes: z.number(),
    }),
  ),
  collectedAt: Timestamp,
});
export type ComputeStats = z.infer<typeof ComputeStats>;

export type ComputePingResult = z.infer<typeof ComputePingResult>;

export const ComputePingResult = z.object({
  status: ComputeStatus,
  version: z.string().nullable(),
  latencyMs: z.number(),
});

export const PoolRow = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  computeIds: z.array(Id),
});
export type PoolRow = z.infer<typeof PoolRow>;

export const PoolInput = z.object({
  id: Id.optional(),
  name: z.string().min(1).max(64),
  description: z.string().max(512).nullable().optional(),
  computeIds: z.array(Id).default([]),
});

export const DockerImageInfo = z.object({
  id: z.string(),
  tags: z.array(z.string()),
  sizeBytes: z.number(),
  createdAt: Timestamp,
});
