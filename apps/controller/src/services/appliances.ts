/**
 * OS image repository and appliance builds: download upstream cloud images
 * into the library, then provision a desktop or package set inside a throwaway
 * QEMU VM whose result becomes a reusable `images` row.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { catalogOsImages, desktopRecipes } from '@netlabor/catalog';
import {
  AppError,
  type AppErrorCode,
  type ApplianceBuildCreated,
  type ApplianceBuildInput,
  type ApplianceBuildListInput as ApplianceBuildListContract,
  type ApplianceBuildRow,
  type ApplianceBuildSpec,
  type ApplianceBuildStatus,
  type ApplianceBuildStatusOutput,
  type ApplianceTemplateInput,
  type Desktop,
  type JobRow,
  type OsArch,
  type OsFamily,
  type OsImageAdoptInput as OsImageAdoptContract,
  type OsImageCreateInput,
  type OsImageListInput as OsImageListContract,
  type OsImageRow,
  type OsImageStatus,
  type OsImageTargetInput as OsImageTargetContract,
  type OsImageUpdateInput as OsImageUpdateContract,
  type TemplateRow,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { z } from 'zod';
import type { AppDeps } from '../implementer.ts';
import {
  deleteImage,
  ensureOnCompute,
  firstOnlineCompute,
  getComputeTarget,
  getImage,
  listImageReplicas,
  setReplicaState,
  sourceForTarget,
  stageBlob,
  validateArtifact,
} from './images.ts';
import type { JobService } from './jobs.ts';
import { createTemplate } from './templates.ts';

type OsImageListInput = z.infer<typeof OsImageListContract>;
type OsImageUpdateInput = z.infer<typeof OsImageUpdateContract>;
type OsImageAdoptInput = z.infer<typeof OsImageAdoptContract>;
type OsImageTargetInput = z.infer<typeof OsImageTargetContract>;
type ApplianceBuildListInput = z.infer<typeof ApplianceBuildListContract>;

/* ----------------------------------------------------------- os repository --- */

interface OsImageRecord {
  id: string;
  name: string;
  family: OsFamily;
  release: string;
  arch: OsArch;
  description: string | null;
  source_url: string | null;
  filename: string;
  sha256: string | null;
  size_bytes: string | number | null;
  status: OsImageStatus;
  error: string | null;
  image_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const OS_COLUMNS = `
  id, name, family, release, arch, description, source_url, filename, sha256,
  size_bytes, status, error, image_id, created_at, updated_at`;

function toOsImageRow(record: OsImageRecord): OsImageRow {
  return {
    id: record.id,
    name: record.name,
    family: record.family,
    release: record.release,
    arch: record.arch,
    description: record.description,
    sourceUrl: record.source_url,
    filename: record.filename,
    sha256: record.sha256,
    sizeBytes: record.size_bytes === null ? null : Number(record.size_bytes),
    status: record.status,
    error: record.error,
    imageId: record.image_id,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

async function getOsImage(db: SQL, id: string): Promise<OsImageRecord> {
  const rows = await db.unsafe<OsImageRecord[]>(
    `SELECT ${OS_COLUMNS} FROM os_images WHERE id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'OS image not found');
  return record;
}

async function assertOsNameFree(db: SQL, name: string, exceptId: string | null): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM os_images WHERE name = $1 AND ($2::uuid IS NULL OR id <> $2)',
    [name, exceptId],
  );
  if (rows[0]) throw new AppError('CONFLICT', 'an OS image with this name already exists');
}

/** Repository filesystem names must stay inside the blob directory. */
function safeFilename(filename: string): string {
  const base = path.basename(filename);
  if (base !== filename || base === '' || base === '.' || base === '..') {
    throw new AppError('BAD_REQUEST', 'image filename cannot contain path separators');
  }
  if (base.length > 200) throw new AppError('BAD_REQUEST', 'image filename is too long');
  return base;
}

function assertHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('BAD_REQUEST', 'the OS image source is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 'the OS image source must be an http or https URL');
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function publishApplianceUpdated(
  deps: AppDeps,
  payload: {
    scope: 'os' | 'build';
    status: string;
    osImageId?: string;
    buildId?: string;
    imageId?: string;
  },
): Promise<void> {
  await deps.events.publish({ type: 'appliance.updated', payload });
}

export async function listOsImages(db: SQL, input: OsImageListInput): Promise<OsImageRow[]> {
  const records = await db.unsafe<OsImageRecord[]>(
    `SELECT ${OS_COLUMNS}
       FROM os_images
      WHERE ($1::text IS NULL OR family = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR filename ILIKE '%' || $2 || '%')
      ORDER BY family ASC, name ASC
      LIMIT $3 OFFSET $4`,
    [input.family ?? null, input.search ?? null, input.limit, input.offset],
  );
  return records.map(toOsImageRow);
}

export async function createOsImage(deps: AppDeps, input: OsImageCreateInput): Promise<OsImageRow> {
  const name = input.name.trim();
  if (name === '') throw new AppError('BAD_REQUEST', 'OS image name is required');
  const filename = safeFilename(input.filename);
  await assertOsNameFree(deps.db, name, null);
  const id = newId();
  await deps.db.unsafe(
    `INSERT INTO os_images (id, name, family, release, arch, description, source_url, filename)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      name,
      input.family,
      input.release,
      input.arch,
      input.description ?? null,
      input.sourceUrl ?? null,
      filename,
    ],
  );
  const record = await getOsImage(deps.db, id);
  await publishApplianceUpdated(deps, { scope: 'os', osImageId: id, status: record.status });
  return toOsImageRow(record);
}

export async function updateOsImage(deps: AppDeps, input: OsImageUpdateInput): Promise<OsImageRow> {
  const existing = await getOsImage(deps.db, input.id);
  const name = input.name === undefined ? existing.name : input.name.trim();
  if (name === '') throw new AppError('BAD_REQUEST', 'OS image name is required');
  if (name !== existing.name) await assertOsNameFree(deps.db, name, existing.id);
  const filename = input.filename === undefined ? existing.filename : safeFilename(input.filename);
  await deps.db.unsafe(
    `UPDATE os_images SET
       name = $2, family = $3, release = $4, arch = $5, description = $6,
       source_url = $7, filename = $8, updated_at = now()
     WHERE id = $1`,
    [
      existing.id,
      name,
      input.family ?? existing.family,
      input.release ?? existing.release,
      input.arch ?? existing.arch,
      input.description === undefined ? existing.description : input.description,
      input.sourceUrl === undefined ? existing.source_url : input.sourceUrl,
      filename,
    ],
  );
  const record = await getOsImage(deps.db, existing.id);
  await publishApplianceUpdated(deps, {
    scope: 'os',
    osImageId: existing.id,
    status: record.status,
    ...(record.image_id ? { imageId: record.image_id } : {}),
  });
  return toOsImageRow(record);
}

export async function deleteOsImage(
  deps: AppDeps,
  userId: string | null,
  id: string,
): Promise<void> {
  const record = await getOsImage(deps.db, id);
  if (record.status === 'downloading') {
    throw new AppError('CONFLICT', 'the OS image is still downloading');
  }
  const builds = await deps.db.unsafe<{ count: string }[]>(
    'SELECT count(*)::text AS count FROM appliance_builds WHERE os_image_id = $1',
    [id],
  );
  if (Number(builds[0]?.count ?? '0') > 0) {
    throw new AppError('CONFLICT', 'the OS image is used by appliance builds', {
      details: { builds: Number(builds[0]?.count ?? '0') },
    });
  }
  if (record.image_id) {
    const images = await deps.db.unsafe<{ id: string }[]>('SELECT id FROM images WHERE id = $1', [
      record.image_id,
    ]);
    if (images[0]) await deleteImage(deps, userId, record.image_id);
  }
  await deps.db.unsafe('DELETE FROM os_images WHERE id = $1', [id]);
  await publishApplianceUpdated(deps, { scope: 'os', osImageId: id, status: 'deleted' });
}

/** Point an entry at an artifact that is already in the library. */
export async function adoptOsImage(deps: AppDeps, input: OsImageAdoptInput): Promise<OsImageRow> {
  const record = await getOsImage(deps.db, input.id);
  const image = await getImage(deps.db, input.imageId);
  if (image.kind !== 'qemu') {
    throw new AppError('BAD_REQUEST', 'only QEMU disk images can back an OS entry');
  }
  await deps.db.unsafe(
    `UPDATE os_images SET
       sha256 = $2, size_bytes = $3, image_id = $4, status = 'available',
       error = NULL, updated_at = now()
     WHERE id = $1`,
    [record.id, image.sha256, image.sizeBytes, image.id],
  );
  const updated = await getOsImage(deps.db, record.id);
  await publishApplianceUpdated(deps, {
    scope: 'os',
    osImageId: record.id,
    status: 'available',
    imageId: image.id,
  });
  return toOsImageRow(updated);
}

/* ---------------------------------------------------------------- download --- */

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

interface StreamedFile {
  sha256: string;
  sizeBytes: number;
}

/**
 * Stream a URL to `target` while hashing it. Used for upstream cloud images
 * and for pulling a finished build artifact from a compute agent.
 */
async function downloadToFile(
  url: string,
  target: string,
  options: {
    token?: string | null;
    failureCode?: AppErrorCode;
    timeoutMs?: number;
    onProgress?: (received: number, total: number) => void;
  } = {},
): Promise<StreamedFile> {
  const failureCode = options.failureCode ?? 'AGENT_UNAVAILABLE';
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: options.token ? { authorization: `Bearer ${options.token}` } : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(failureCode, 'download failed', {
      details: { url, err: errorMessage(error) },
      retryable: true,
    });
  }
  if (!response.ok || !response.body) {
    throw new AppError(
      response.status === 404 ? 'IMAGE_MISSING' : failureCode,
      `download failed with HTTP ${response.status}`,
      { details: { url, status: response.status }, retryable: response.status >= 500 },
    );
  }
  const total = Number(response.headers.get('content-length') ?? '0');
  const hasher = new Bun.CryptoHasher('sha256');
  const writer = Bun.file(target).writer();
  let sizeBytes = 0;
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      hasher.update(bytes);
      sizeBytes += bytes.byteLength;
      await writer.write(bytes);
      const now = Date.now();
      if (options.onProgress && now - lastReport >= 1000) {
        lastReport = now;
        options.onProgress(sizeBytes, total);
      }
    }
    await writer.end();
  } catch (error) {
    try {
      await writer.end();
    } catch {
      // the partial file is removed regardless
    }
    await rm(target, { force: true }).catch(() => undefined);
    throw new AppError(failureCode, 'download was interrupted', {
      details: { url, err: errorMessage(error) },
      retryable: true,
    });
  }
  options.onProgress?.(sizeBytes, total);
  return { sha256: Buffer.from(hasher.digest()).toString('hex'), sizeBytes };
}

export async function downloadOsImage(
  deps: AppDeps,
  jobs: JobService,
  auth: { userId: string | null },
  input: OsImageTargetInput,
): Promise<JobRow> {
  const record = await getOsImage(deps.db, input.id);
  const catalog = catalogOsImages.find((entry) => entry.name === record.name);
  const sourceUrl = record.source_url ?? catalog?.sourceUrl ?? null;
  if (!sourceUrl) {
    throw new AppError('BAD_REQUEST', 'this OS image has no upstream URL; adopt a library image');
  }
  assertHttpUrl(sourceUrl);
  const target = input.computeId
    ? await getComputeTarget(deps.db, input.computeId)
    : await firstOnlineCompute(deps.db);

  const claimed = await deps.db.unsafe<{ id: string }[]>(
    `UPDATE os_images SET status = 'downloading', error = NULL, updated_at = now()
      WHERE id = $1 AND status <> 'downloading'
      RETURNING id`,
    [record.id],
  );
  if (!claimed[0]) throw new AppError('CONFLICT', 'this OS image is already downloading');

  let job: JobRow;
  try {
    job = await jobs.create('os.download', {
      osImageId: record.id,
      name: record.name,
      sourceUrl,
      filename: record.filename,
    });
  } catch (error) {
    await deps.db
      .unsafe("UPDATE os_images SET status = 'available', updated_at = now() WHERE id = $1", [
        record.id,
      ])
      .catch(() => undefined);
    throw error;
  }

  await publishApplianceUpdated(deps, {
    scope: 'os',
    osImageId: record.id,
    status: 'downloading',
  });
  void runDownload(deps, jobs, job.id, record, sourceUrl, target?.id ?? null, auth.userId).catch(
    (error: unknown) => {
      deps.logger.error('OS image download task crashed', {
        osImageId: record.id,
        jobId: job.id,
        err: errorMessage(error),
      });
    },
  );
  return job;
}

async function runDownload(
  deps: AppDeps,
  jobs: JobService,
  jobId: string,
  record: OsImageRecord,
  sourceUrl: string,
  computeId: string | null,
  userId: string | null,
): Promise<void> {
  const directory = path.join(deps.config.stagingDir, 'os-images');
  const temp = path.join(directory, `${record.id}.part`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    await jobs.progress(jobId, 5, 'downloading');
    const downloaded = await downloadToFile(sourceUrl, temp, {
      failureCode: 'BAD_REQUEST',
      onProgress: (received, total) => {
        if (total <= 0) return;
        const percent = 5 + Math.round((received / total) * 55);
        void jobs.progress(jobId, Math.min(60, percent), 'downloading').catch(() => undefined);
      },
    });
    if (downloaded.sizeBytes === 0)
      throw new AppError('BAD_REQUEST', 'the downloaded image is empty');

    await jobs.progress(jobId, 65, 'validating image');
    const info = await validateArtifact(deps, 'qemu', temp);

    await jobs.progress(jobId, 75, 'storing artifact');
    const existing = await deps.db.unsafe<
      { id: string; name: string; filename: string; size_bytes: string | number }[]
    >('SELECT id, name, filename, size_bytes FROM images WHERE sha256 = $1 LIMIT 1', [
      downloaded.sha256,
    ]);
    let imageId: string;
    let filename: string;
    let sizeBytes: number;
    let action: 'created' | 'reused';
    if (existing[0]) {
      imageId = existing[0].id;
      filename = existing[0].filename;
      sizeBytes = Number(existing[0].size_bytes);
      action = 'reused';
    } else {
      const stagedPath = await stageBlob(deps, temp, downloaded.sha256, record.filename);
      filename = record.filename;
      sizeBytes = (await stat(stagedPath)).size;
      imageId = newId();
      await deps.db.unsafe(
        `INSERT INTO images (id, name, kind, filename, sha256, size_bytes, metadata, created_by)
         VALUES ($1, $2, 'qemu', $3, $4, $5, $6::jsonb, $7)`,
        [
          imageId,
          record.name,
          filename,
          downloaded.sha256,
          sizeBytes,
          { ...info, stagedPath, sourceUrl, osImageId: record.id },
          userId,
        ],
      );
      action = 'created';
    }

    await jobs.progress(jobId, 90, 'updating repository');
    await deps.db.unsafe(
      `UPDATE os_images SET
         sha256 = $2, size_bytes = $3, image_id = $4, status = 'available',
         error = NULL, updated_at = now()
       WHERE id = $1`,
      [record.id, downloaded.sha256, sizeBytes, imageId],
    );
    await deps.events.publish({
      type: 'image.updated',
      payload: { imageId, sha256: downloaded.sha256, action },
    });
    await publishApplianceUpdated(deps, {
      scope: 'os',
      osImageId: record.id,
      status: 'available',
      imageId,
    });

    if (computeId) {
      await jobs.progress(jobId, 95, 'copying to compute');
      const image = { id: imageId, sha256: downloaded.sha256, filename };
      try {
        const source = await sourceForTarget(deps, image, computeId);
        await ensureOnCompute(deps, image, computeId, source);
      } catch (error) {
        deps.logger.warn('OS image stored but the first replica is missing', {
          osImageId: record.id,
          computeId,
          err: errorMessage(error),
        });
      }
    }

    await jobs
      .complete(jobId, {
        osImageId: record.id,
        imageId,
        sha256: downloaded.sha256,
        filename,
        sizeBytes,
      })
      .catch((error: unknown) => {
        deps.logger.warn('failed to mark the OS download job complete', {
          jobId,
          err: errorMessage(error),
        });
      });
    deps.logger.info('OS image downloaded', { osImageId: record.id, imageId, filename });
  } catch (error) {
    const message = errorMessage(error);
    await deps.db
      .unsafe(
        `UPDATE os_images SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
        [record.id, message.slice(0, 2000)],
      )
      .catch(() => undefined);
    await publishApplianceUpdated(deps, {
      scope: 'os',
      osImageId: record.id,
      status: 'error',
    }).catch(() => undefined);
    await jobs.fail(jobId, message).catch(() => undefined);
    deps.logger.warn('OS image download failed', { osImageId: record.id, err: message });
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------- provisioning --- */

/** Strict Debian package name, optionally architecture-qualified (`pkg:amd64`). */
const APT_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?$/;

/** Package names are interpolated into a shell command, so refuse anything else. */
export function assertPackageNames(packages: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of packages) {
    const name = raw.trim();
    if (name === '') continue;
    if (!APT_PACKAGE_NAME.test(name)) {
      throw new AppError('BAD_REQUEST', `invalid apt package name: ${raw}`);
    }
    if (seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

/** Custom commands are single-line shell; newlines would break the recipe. */
export function assertCommands(commands: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const raw of commands) {
    const command = raw.trim();
    if (command === '') continue;
    if (/[\0\r\n]/.test(command)) {
      throw new AppError('BAD_REQUEST', 'build commands must be single-line shell commands');
    }
    normalized.push(command);
  }
  return normalized;
}

/** POSIX single-quote escaping so a command cannot alter the surrounding script. */
function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ApplianceRecipeInput {
  hostname: string;
  user: string;
  password: string;
  desktop: Desktop;
  packages: readonly string[];
  commands: readonly string[];
}

/**
 * The provisioning script cloud-init writes into the build VM. Everything is
 * one bash script so a failed apt run is visible in the console log instead of
 * being hidden inside cloud-init's package module.
 */
export function applianceProvisioningScript(
  input: Pick<ApplianceRecipeInput, 'desktop' | 'packages' | 'commands'>,
): string {
  const extraPackages = assertPackageNames(input.packages);
  const commands = assertCommands(input.commands);
  const recipe = input.desktop === 'none' ? null : desktopRecipes[input.desktop];
  const packages = [...(recipe?.packages ?? []), ...extraPackages];
  const lines = [
    '#!/bin/bash',
    'set -Eeuo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    '',
    'progress() { echo "NETLABOR_PROGRESS $1 $2"; }',
    '',
    'on_error() {',
    '  local status=$?',
    '  echo "NETLABOR_BUILD_FAILED provisioning failed with exit code $status"',
    '  systemctl poweroff -f',
    '  exit $status',
    '}',
    'trap on_error ERR',
    '',
    'progress 5 "refreshing package lists"',
    'apt-get update',
  ];
  if (packages.length > 0) {
    lines.push('progress 20 "installing packages"');
    lines.push(`apt-get install -y --no-install-recommends ${packages.join(' ')}`);
  } else {
    lines.push('progress 20 "no packages to install"');
  }
  if (recipe) {
    lines.push('progress 80 "enabling the desktop"');
    lines.push(`systemctl enable ${recipe.displayManager}`);
    lines.push('systemctl set-default graphical.target');
  }
  if (commands.length > 0) {
    lines.push('progress 90 "running custom commands"');
    for (const command of commands) lines.push(`bash -c ${quoteShell(command)}`);
  }
  lines.push('progress 100 "build complete"', 'echo NETLABOR_BUILD_OK', 'systemctl poweroff -f');
  return `${lines.join('\n')}\n`;
}

export function applianceHostname(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return slug === '' ? 'netlabor-appliance' : slug;
}

/** Complete NoCloud user-data: a user, the script, and console-tapped runcmd. */
export function applianceUserData(input: ApplianceRecipeInput): string {
  const script = applianceProvisioningScript(input);
  const hostname = input.hostname.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$/.test(hostname)) {
    throw new AppError('BAD_REQUEST', 'invalid build hostname');
  }
  const user = input.user.trim();
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) {
    throw new AppError('BAD_REQUEST', 'invalid build user name');
  }
  if (input.password === '' || /["\\\r\n]/.test(input.password)) {
    throw new AppError('BAD_REQUEST', 'invalid build password');
  }
  const content = script
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return [
    '#cloud-config',
    `hostname: "${hostname}"`,
    'manage_etc_hosts: true',
    'preserve_hostname: false',
    'ssh_pwauth: true',
    'chpasswd:',
    '  expire: false',
    'users:',
    `  - name: "${user}"`,
    '    gecos: "Netlabor appliance"',
    '    groups: [sudo, adm]',
    '    shell: /bin/bash',
    '    sudo: "ALL=(ALL) NOPASSWD:ALL"',
    `    plain_text_passwd: "${input.password}"`,
    '    lock_passwd: false',
    'write_files:',
    '  - path: /usr/local/sbin/netlabor-build.sh',
    '    owner: root:root',
    '    permissions: "0755"',
    '    content: |',
    content,
    'output:',
    "  all: '| tee -a /var/log/netlabor-build.log /dev/console'",
    'runcmd:',
    '  - [bash, /usr/local/sbin/netlabor-build.sh]',
    '',
  ].join('\n');
}

/** Library artifact name for a build; the agent writes it into its image store. */
function artifactFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 120);
  return `${slug === '' ? 'appliance' : slug}.qcow2`;
}

/* -------------------------------------------------------------- builds --- */

interface ApplianceBuildRecord {
  id: string;
  name: string;
  os_image_id: string;
  os_image_name: string;
  desktop: Desktop;
  packages: unknown;
  disk_gb: number;
  memory_mb: number;
  cpus: number;
  compute_id: string | null;
  compute_name: string | null;
  status: ApplianceBuildStatus;
  progress: number;
  message: string | null;
  log: string | null;
  image_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const BUILD_SELECT = `
  SELECT b.id, b.name, b.os_image_id, o.name AS os_image_name, b.desktop, b.packages,
         b.disk_gb, b.memory_mb, b.cpus, b.compute_id, c.name AS compute_name,
         b.status, b.progress, b.message, b.log, b.image_id, b.error, b.created_by,
         b.created_at, b.updated_at
    FROM appliance_builds b
    JOIN os_images o ON o.id = b.os_image_id
    LEFT JOIN computes c ON c.id = b.compute_id`;

function toBuildRow(record: ApplianceBuildRecord): ApplianceBuildRow {
  return {
    id: record.id,
    name: record.name,
    osImageId: record.os_image_id,
    osImageName: record.os_image_name,
    desktop: record.desktop,
    packages: parseJsonColumn<string[]>(record.packages, []),
    diskGb: record.disk_gb,
    memoryMb: record.memory_mb,
    cpus: record.cpus,
    computeId: record.compute_id,
    computeName: record.compute_name,
    status: record.status,
    progress: Number(record.progress),
    message: record.message,
    log: record.log,
    imageId: record.image_id,
    error: record.error,
    createdBy: record.created_by,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export async function listBuilds(
  db: SQL,
  input: ApplianceBuildListInput,
): Promise<ApplianceBuildRow[]> {
  const records = await db.unsafe<ApplianceBuildRecord[]>(
    `${BUILD_SELECT}
      WHERE ($1::text IS NULL OR b.status = $1)
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3`,
    [input.status ?? null, input.limit, input.offset],
  );
  return records.map(toBuildRow);
}

export async function getBuild(db: SQL, id: string): Promise<ApplianceBuildRow> {
  const records = await db.unsafe<ApplianceBuildRecord[]>(`${BUILD_SELECT} WHERE b.id = $1`, [id]);
  const record = records[0];
  if (!record) throw new AppError('NOT_FOUND', 'appliance build not found');
  return toBuildRow(record);
}

interface BuildCompute {
  id: string;
  name: string;
  url: string;
}

/** An explicitly requested compute must exist and be online. */
async function resolveBuildCompute(db: SQL, computeId?: string): Promise<BuildCompute> {
  const rows = computeId
    ? await db.unsafe<(BuildCompute & { status: string })[]>(
        'SELECT id, name, url, status FROM computes WHERE id = $1',
        [computeId],
      )
    : await db.unsafe<(BuildCompute & { status: string })[]>(
        "SELECT id, name, url, status FROM computes WHERE status = 'online' ORDER BY name ASC LIMIT 1",
      );
  const compute = rows[0];
  if (!compute) {
    throw computeId
      ? new AppError('NOT_FOUND', `compute ${computeId} not found`)
      : new AppError('CONFLICT', 'no compute is online to run the build');
  }
  if (compute.status !== 'online') {
    throw new AppError('CONFLICT', `compute ${compute.name} is offline`);
  }
  return { id: compute.id, name: compute.name, url: compute.url };
}

interface BuildContext {
  buildId: string;
  jobId: string;
  name: string;
  osImageId: string;
  desktop: Desktop;
  packages: string[];
  compute: BuildCompute;
  baseImageId: string;
  spec: ApplianceBuildSpec;
}

export async function createBuild(
  deps: AppDeps,
  jobs: JobService,
  auth: { userId: string | null },
  input: ApplianceBuildInput,
): Promise<ApplianceBuildCreated> {
  const name = input.name.trim();
  if (name === '') throw new AppError('BAD_REQUEST', 'build name is required');
  const packages = assertPackageNames(input.packages);
  const commands = assertCommands(input.commands);

  const osRecord = await getOsImage(deps.db, input.osImageId);
  if (!osRecord.image_id) {
    throw new AppError('BAD_REQUEST', 'this OS image has not been downloaded yet');
  }
  if (osRecord.status !== 'available') {
    throw new AppError('BAD_REQUEST', `the OS image is ${osRecord.status}, not available`);
  }
  const baseImage = await getImage(deps.db, osRecord.image_id);
  if (baseImage.kind !== 'qemu') {
    throw new AppError('BAD_REQUEST', 'the OS image artifact must be a QEMU disk image');
  }
  const compute = await resolveBuildCompute(deps.db, input.computeId);

  const buildId = newId();
  const hostname = applianceHostname(name);
  const password = randomBytes(12).toString('hex');
  const userData = applianceUserData({
    hostname,
    user: 'netlabor',
    password,
    desktop: input.desktop,
    packages,
    commands,
  });
  const metaData = `instance-id: ${buildId}\nlocal-hostname: ${hostname}\n`;
  const spec: ApplianceBuildSpec = {
    buildId,
    artifactName: artifactFileName(name),
    base: { sha256: baseImage.sha256, filename: baseImage.filename },
    diskGb: input.diskGb,
    memoryMb: input.memoryMb,
    cpus: input.cpus,
    userData,
    metaData,
  };

  await deps.db.unsafe(
    `INSERT INTO appliance_builds
       (id, name, os_image_id, desktop, packages, disk_gb, memory_mb, cpus,
        compute_id, status, progress, message, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'queued', 0, 'queued', $10)`,
    [
      buildId,
      name,
      osRecord.id,
      input.desktop,
      packages,
      input.diskGb,
      input.memoryMb,
      input.cpus,
      compute.id,
      auth.userId,
    ],
  );
  const job = await jobs.create('appliance.build', {
    buildId,
    name,
    osImageId: osRecord.id,
    imageId: baseImage.id,
    computeId: compute.id,
  });
  await publishApplianceUpdated(deps, {
    scope: 'build',
    buildId,
    osImageId: osRecord.id,
    status: 'queued',
  });

  void runBuild(deps, jobs, {
    buildId,
    jobId: job.id,
    name,
    osImageId: osRecord.id,
    desktop: input.desktop,
    packages,
    compute,
    baseImageId: baseImage.id,
    spec,
  }).catch((error: unknown) => {
    deps.logger.error('appliance build task crashed', {
      buildId,
      jobId: job.id,
      err: errorMessage(error),
    });
  });
  return { build: await getBuild(deps.db, buildId), job };
}

const BUILD_POLL_INTERVAL_MS = 5_000;
const BUILD_TIMEOUT_MS = 100 * 60 * 1000;
const BUILD_LOG_TAIL = 16_000;

function tailLog(log: string | null | undefined): string | null {
  if (!log) return null;
  return log.length <= BUILD_LOG_TAIL ? log : log.slice(-BUILD_LOG_TAIL);
}

interface BuildPatch {
  status?: ApplianceBuildStatus;
  progress?: number;
  message?: string | null;
  log?: string | null;
  imageId?: string | null;
  error?: string | null;
}

const BUILD_PATCH_COLUMNS: Record<keyof BuildPatch, string> = {
  status: 'status',
  progress: 'progress',
  message: 'message',
  log: 'log',
  imageId: 'image_id',
  error: 'error',
};

async function patchBuild(deps: AppDeps, id: string, patch: BuildPatch): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [id];
  for (const [key, column] of Object.entries(BUILD_PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    values.push(patch[key as keyof BuildPatch]);
    assignments.push(`${column} = $${values.length}`);
  }
  if (assignments.length === 0) return;
  assignments.push('updated_at = now()');
  await deps.db.unsafe(
    `UPDATE appliance_builds SET ${assignments.join(', ')} WHERE id = $1`,
    values,
  );
}

async function ensureBaseImage(deps: AppDeps, imageId: string, computeId: string): Promise<void> {
  const replicas = await listImageReplicas(deps.db, imageId);
  if (replicas.some((replica) => replica.computeId === computeId && replica.state === 'present')) {
    return;
  }
  const image = await getImage(deps.db, imageId);
  const source = await sourceForTarget(deps, image, computeId);
  await ensureOnCompute(deps, image, computeId, source);
}

async function runBuild(deps: AppDeps, jobs: JobService, context: BuildContext): Promise<void> {
  const { buildId, jobId, spec } = context;
  try {
    const current = await getBuild(deps.db, buildId).catch(() => null);
    if (current?.status === 'cancelled') {
      await jobs.cancel(jobId).catch(() => undefined);
      return;
    }
    await patchBuild(deps, buildId, {
      status: 'running',
      progress: 2,
      message: 'preparing base image',
      log: null,
      error: null,
    });
    await jobs.progress(jobId, 2, 'preparing base image');
    await publishApplianceUpdated(deps, {
      scope: 'build',
      buildId,
      osImageId: context.osImageId,
      status: 'running',
    });

    await ensureBaseImage(deps, context.baseImageId, context.compute.id);

    await jobs.progress(jobId, 5, 'booting the build VM');
    await patchBuild(deps, buildId, { progress: 5, message: 'booting the build VM' });
    const started = await deps.agents.call(context.compute.id, (agent) =>
      agent.applianceBuilds.start(spec),
    );
    deps.logger.info('appliance build started', {
      buildId,
      computeId: context.compute.id,
      workspace: started.workspace,
    });

    const deadline = Date.now() + BUILD_TIMEOUT_MS;
    let latest: ApplianceBuildStatusOutput | null = null;
    let consecutiveFailures = 0;
    while (Date.now() < deadline) {
      let status: ApplianceBuildStatusOutput;
      try {
        status = await deps.agents.call(context.compute.id, (agent) =>
          agent.applianceBuilds.status({ buildId }),
        );
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) throw error;
        await Bun.sleep(BUILD_POLL_INTERVAL_MS);
        continue;
      }
      latest = status;
      const progress = Math.round(Math.max(0, Math.min(1, status.progress)) * 100);
      await patchBuild(deps, buildId, {
        progress,
        message: status.message ?? 'provisioning',
        log: tailLog(status.log),
      });
      await jobs.progress(jobId, progress, status.message ?? undefined);
      if (status.status !== 'running') break;
      await Bun.sleep(BUILD_POLL_INTERVAL_MS);
    }

    if (!latest || latest.status === 'running') {
      await deps.agents
        .call(context.compute.id, (agent) => agent.applianceBuilds.cancel({ buildId }))
        .catch(() => undefined);
      throw new AppError(
        'AGENT_ERROR',
        `the build did not finish within ${Math.round(BUILD_TIMEOUT_MS / 60_000)} minutes`,
      );
    }
    if (latest.status === 'completed') {
      await finishBuild(deps, jobs, context, latest);
      return;
    }
    if (latest.status === 'cancelled') {
      await cancelBuildRow(deps, jobs, context, latest);
      return;
    }
    await failBuild(
      deps,
      jobs,
      context,
      latest.error ?? latest.message ?? 'the build failed',
      latest.log,
    );
  } catch (error) {
    await failBuild(deps, jobs, context, errorMessage(error));
  }
}

async function finishBuild(
  deps: AppDeps,
  jobs: JobService,
  context: BuildContext,
  status: ApplianceBuildStatusOutput,
): Promise<void> {
  const current = await getBuild(deps.db, context.buildId).catch(() => null);
  if (current?.status === 'cancelled') {
    await jobs.cancel(context.jobId).catch(() => undefined);
    return;
  }
  const artifact = status.artifact;
  if (!artifact) {
    throw new AppError('AGENT_ERROR', 'the build reported completion without an artifact');
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
    throw new AppError('AGENT_ERROR', 'the build artifact has an invalid sha256 digest');
  }
  const filename = safeFilename(artifact.filename);
  const directory = path.join(deps.config.stagingDir, 'appliance-builds');
  const temp = path.join(directory, `${context.buildId}-${Date.now()}.part`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const token = await deps.agents.agentToken(context.compute.id);
    if (!token) throw new AppError('AGENT_UNAVAILABLE', 'the build compute has no agent token');
    const url = `${context.compute.url.replace(/\/$/, '')}/agent/blobs/${artifact.sha256}/${encodeURIComponent(filename)}`;
    const downloaded = await downloadToFile(url, temp, { token });
    if (downloaded.sha256 !== artifact.sha256) {
      throw new AppError('IMAGE_MISSING', 'the downloaded artifact does not match its sha256', {
        details: {
          expected: artifact.sha256,
          actual: downloaded.sha256,
          sizeBytes: downloaded.sizeBytes,
        },
      });
    }
    const info = await validateArtifact(deps, 'qemu', temp);

    const existing = await deps.db.unsafe<
      { id: string; name: string; filename: string; size_bytes: string | number }[]
    >('SELECT id, name, filename, size_bytes FROM images WHERE sha256 = $1 LIMIT 1', [
      artifact.sha256,
    ]);
    let imageId: string;
    let imageFilename: string;
    let sizeBytes: number;
    let action: 'created' | 'reused';
    if (existing[0]) {
      imageId = existing[0].id;
      imageFilename = existing[0].filename;
      sizeBytes = Number(existing[0].size_bytes);
      action = 'reused';
    } else {
      const stagedPath = await stageBlob(deps, temp, artifact.sha256, filename);
      imageFilename = filename;
      sizeBytes = (await stat(stagedPath)).size;
      imageId = newId();
      await deps.db.unsafe(
        `INSERT INTO images (id, name, kind, filename, sha256, size_bytes, metadata, created_by)
         VALUES ($1, $2, 'qemu', $3, $4, $5, $6::jsonb, NULL)`,
        [
          imageId,
          context.name,
          imageFilename,
          artifact.sha256,
          sizeBytes,
          {
            ...info,
            stagedPath,
            appliance: {
              buildId: context.buildId,
              osImageId: context.osImageId,
              desktop: context.desktop,
              packages: context.packages,
              base: context.spec.base,
            },
          },
        ],
      );
      action = 'created';
    }

    // The artifact already lives in the compute's image store.
    let replicaPath: string | null = null;
    try {
      const listing = await deps.agents.call(context.compute.id, (agent) => agent.image.list({}));
      replicaPath =
        listing.find(
          (entry) => entry.sha256 === artifact.sha256 && entry.filename === imageFilename,
        )?.path ?? null;
    } catch (error) {
      deps.logger.warn('failed to locate the build artifact on its compute', {
        buildId: context.buildId,
        err: errorMessage(error),
      });
    }
    await setReplicaState(deps.db, imageId, context.compute.id, 'present', replicaPath);

    await patchBuild(deps, context.buildId, {
      status: 'completed',
      progress: 100,
      message: 'build completed',
      log: tailLog(status.log),
      imageId,
      error: null,
    });
    await deps.events.publish({
      type: 'image.updated',
      payload: { imageId, sha256: artifact.sha256, action },
    });
    await publishApplianceUpdated(deps, {
      scope: 'build',
      buildId: context.buildId,
      osImageId: context.osImageId,
      status: 'completed',
      imageId,
    });
    await jobs
      .complete(context.jobId, {
        buildId: context.buildId,
        imageId,
        sha256: artifact.sha256,
        filename: imageFilename,
        sizeBytes,
      })
      .catch((error: unknown) => {
        deps.logger.warn('failed to mark the appliance build job complete', {
          buildId: context.buildId,
          err: errorMessage(error),
        });
      });
    deps.logger.info('appliance build completed', {
      buildId: context.buildId,
      imageId,
      sha256: artifact.sha256,
    });
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function failBuild(
  deps: AppDeps,
  jobs: JobService,
  context: Pick<BuildContext, 'buildId' | 'jobId' | 'osImageId'>,
  message: string,
  log?: string | null,
): Promise<void> {
  const current = await getBuild(deps.db, context.buildId).catch(() => null);
  if (current?.status === 'completed') return;
  if (current?.status === 'cancelled') {
    await jobs.cancel(context.jobId).catch(() => undefined);
    return;
  }
  await patchBuild(deps, context.buildId, {
    status: 'failed',
    message: 'build failed',
    error: message.slice(0, 2000),
    log: tailLog(log ?? current?.log ?? null),
  });
  await publishApplianceUpdated(deps, {
    scope: 'build',
    buildId: context.buildId,
    osImageId: context.osImageId,
    status: 'failed',
  });
  await jobs.fail(context.jobId, message).catch(() => undefined);
  deps.logger.warn('appliance build failed', { buildId: context.buildId, err: message });
}

async function cancelBuildRow(
  deps: AppDeps,
  jobs: JobService,
  context: Pick<BuildContext, 'buildId' | 'jobId' | 'osImageId'>,
  status: ApplianceBuildStatusOutput,
): Promise<void> {
  await patchBuild(deps, context.buildId, {
    status: 'cancelled',
    message: status.message ?? 'build cancelled',
    log: tailLog(status.log),
  });
  await publishApplianceUpdated(deps, {
    scope: 'build',
    buildId: context.buildId,
    osImageId: context.osImageId,
    status: 'cancelled',
  });
  await jobs.cancel(context.jobId).catch(() => undefined);
}

export async function cancelBuild(
  deps: AppDeps,
  jobs: JobService,
  input: { id: string },
): Promise<ApplianceBuildRow> {
  const build = await getBuild(deps.db, input.id);
  if (build.status !== 'queued' && build.status !== 'running') {
    throw new AppError('CONFLICT', `the build is already ${build.status}`);
  }
  if (build.computeId) {
    await deps.agents
      .call(build.computeId, (agent) => agent.applianceBuilds.cancel({ buildId: build.id }))
      .catch((error: unknown) => {
        deps.logger.warn('failed to cancel the build on its compute', {
          buildId: build.id,
          computeId: build.computeId,
          err: errorMessage(error),
        });
      });
  }
  await patchBuild(deps, build.id, { status: 'cancelled', message: 'cancelled by user' });
  await publishApplianceUpdated(deps, {
    scope: 'build',
    buildId: build.id,
    osImageId: build.osImageId,
    status: 'cancelled',
  });
  const running = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM jobs
      WHERE kind = 'appliance.build' AND state = 'running' AND payload->>'buildId' = $1
      ORDER BY created_at DESC LIMIT 1`,
    [build.id],
  );
  if (running[0]) await jobs.cancel(running[0].id).catch(() => undefined);
  return getBuild(deps.db, build.id);
}

/* ------------------------------------------------------- appliance templates --- */

/** Turn a finished build image into a QEMU template the workspace can place. */
export async function createTemplateFromBuild(
  deps: AppDeps,
  userId: string | null,
  input: ApplianceTemplateInput,
): Promise<TemplateRow> {
  const build = await getBuild(deps.db, input.buildId);
  if (build.status !== 'completed' || !build.imageId) {
    throw new AppError('BAD_REQUEST', 'the build has not produced an image yet');
  }
  const image = await getImage(deps.db, build.imageId);
  const projectId = input.projectId ?? null;
  const existing = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM templates
      WHERE deleted_at IS NULL AND name = $1
        AND (project_id IS NULL OR project_id = $2::uuid)
      LIMIT 1`,
    [input.name, projectId],
  );
  if (existing[0]) throw new AppError('CONFLICT', 'a template with this name already exists');
  return createTemplate(deps.db, userId, {
    name: input.name,
    nodeType: 'qemu',
    category: input.category,
    symbol: input.symbol,
    defaultNameFormat: '{name}-{index}',
    properties: {
      cloudInitEnabled: true,
      cloudInitAutoLogin: true,
      adapters: 1,
      ram: 2048,
      cpus: 2,
    },
    requiredImages: [{ name: image.name, kind: 'qemu', filenamePattern: `*${image.filename}` }],
    faults: [],
    projectId,
  });
}
