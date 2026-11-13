/** Global OS image repository and appliance builds from it. */

import { z } from 'zod';
import { Id, Timestamp } from './common.ts';
import { JobRow } from './misc.ts';

export const OS_FAMILIES = ['debian', 'ubuntu', 'rocky', 'alpine'] as const;
export const OsFamily = z.enum(OS_FAMILIES);
export type OsFamily = z.infer<typeof OsFamily>;

export const OS_ARCHES = ['amd64', 'arm64'] as const;
export const OsArch = z.enum(OS_ARCHES);
export type OsArch = z.infer<typeof OsArch>;

/** Desktop environments a build can install on top of the base image. */
export const DESKTOPS = ['none', 'xfce', 'gnome', 'kde', 'lxqt'] as const;
export const Desktop = z.enum(DESKTOPS);
export type Desktop = z.infer<typeof Desktop>;

export const OsImageStatus = z.enum(['available', 'downloading', 'error']);
export type OsImageStatus = z.infer<typeof OsImageStatus>;

export const ApplianceBuildStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ApplianceBuildStatus = z.infer<typeof ApplianceBuildStatus>;

/** One base cloud image of the global repository. */
export const OsImageRow = z.object({
  id: Id,
  name: z.string(),
  family: OsFamily,
  release: z.string(),
  arch: OsArch,
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  filename: z.string(),
  sha256: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  status: OsImageStatus,
  error: z.string().nullable(),
  /** Library image that holds the verified artifact, once downloaded or adopted. */
  imageId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type OsImageRow = z.infer<typeof OsImageRow>;

export const OsImageListInput = z.object({
  family: OsFamily.optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

export const OsImageCreateInput = z.object({
  name: z.string().min(1).max(120),
  family: OsFamily,
  release: z.string().min(1).max(80),
  arch: OsArch.default('amd64'),
  description: z.string().max(500).nullable().optional(),
  /** Direct URL of the cloud image (qcow2/img); null for upload-then-adopt flows. */
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  filename: z.string().min(1).max(200),
});
export type OsImageCreateInput = z.infer<typeof OsImageCreateInput>;

export const OsImageUpdateInput = OsImageCreateInput.partial().extend({ id: Id });

export const OsImageTargetInput = z.object({
  id: Id,
  /** Compute that should hold the base image for builds; defaults to a compute with free capacity. */
  computeId: Id.optional(),
});

export const OsImageAdoptInput = z.object({ id: Id, imageId: Id });

/** A downloadable base image resolved to its library image row. */
export const OsImageResolved = z.object({
  osImage: OsImageRow,
  image: z.object({
    id: Id,
    name: z.string(),
    filename: z.string(),
    sha256: z.string(),
    sizeBytes: z.number(),
  }),
});
export type OsImageResolved = z.infer<typeof OsImageResolved>;

export const ApplianceBuildInput = z.object({
  /** Name of the resulting library image, e.g. debian-13-xfce-lab. */
  name: z.string().min(1).max(120),
  osImageId: Id,
  desktop: Desktop.default('none'),
  /** Extra packages installed with apt inside the build VM. */
  packages: z.array(z.string().min(1).max(120)).max(200).default([]),
  diskGb: z.number().int().min(2).max(200).default(12),
  memoryMb: z.number().int().min(512).max(65536).default(2048),
  cpus: z.number().int().min(1).max(16).default(2),
  computeId: Id.optional(),
  /** Extra shell commands appended to the provisioning script. */
  commands: z.array(z.string().max(2000)).max(50).default([]),
});
export type ApplianceBuildInput = z.infer<typeof ApplianceBuildInput>;

export const ApplianceBuildRow = z.object({
  id: Id,
  name: z.string(),
  osImageId: Id,
  osImageName: z.string(),
  desktop: Desktop,
  packages: z.array(z.string()),
  diskGb: z.number().int(),
  memoryMb: z.number().int(),
  cpus: z.number().int(),
  computeId: Id.nullable(),
  computeName: z.string().nullable(),
  status: ApplianceBuildStatus,
  progress: z.number(),
  message: z.string().nullable(),
  log: z.string().nullable(),
  imageId: Id.nullable(),
  error: z.string().nullable(),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ApplianceBuildRow = z.infer<typeof ApplianceBuildRow>;

export const ApplianceBuildListInput = z.object({
  status: ApplianceBuildStatus.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const ApplianceBuildGetInput = z.object({ id: Id });

/** A freshly queued build plus the job that follows it. */
export const ApplianceBuildCreated = z.object({ build: ApplianceBuildRow, job: JobRow });
export type ApplianceBuildCreated = z.infer<typeof ApplianceBuildCreated>;

/** Turn a finished build into a device template that uses its image. */
export const ApplianceTemplateInput = z.object({
  buildId: Id,
  name: z.string().min(1).max(128),
  category: z.string().min(1).max(64).default('Appliances'),
  symbol: z.string().min(1).max(128).default('pc'),
  /** Template lives inside this project; omitted means a global template. */
  projectId: Id.nullable().optional(),
  /** Template defaults: NICs, memory, vCPUs, and auto-login on first boot. */
  adapters: z.number().int().min(0).max(32).default(1),
  ram: z.number().int().min(256).max(65536).default(2048),
  cpus: z.number().int().min(1).max(16).default(2),
  cloudInitAutoLogin: z.boolean().default(true),
});
export type ApplianceTemplateInput = z.infer<typeof ApplianceTemplateInput>;
