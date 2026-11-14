/** Appliance marketplace: browse the curated catalog and install entries. */

import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { type MarketplaceAppliance, marketplaceAppliances } from '@netlabor/catalog';
import {
  AppError,
  type JobRow,
  type MarketplaceApplianceRow,
  type MarketplaceInstallInput,
} from '@netlabor/contract';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import { downloadToFile } from './appliances.ts';
import {
  ensureOnCompute,
  firstOnlineCompute,
  sourceForTarget,
  stageBlob,
  validateArtifact,
} from './images.ts';
import type { JobService } from './jobs.ts';
import { createTemplate } from './templates.ts';

function toRow(app: MarketplaceAppliance, templateId: string | null): MarketplaceApplianceRow {
  return {
    id: app.id,
    name: app.name,
    vendor: app.vendor,
    category: app.category,
    description: app.description,
    status: app.status,
    nodeType: app.nodeType,
    symbol: app.symbol,
    arch: app.arch,
    version: app.image?.version ?? null,
    imageFilename: app.image?.filename ?? null,
    sizeBytes: app.image?.sizeBytes ?? 0,
    registryFile: app.registryFile,
    brandIcon: app.brandIcon,
    installed: templateId !== null,
    templateId,
  };
}

export async function listMarketplace(
  db: SQL,
  input: { search?: string },
): Promise<MarketplaceApplianceRow[]> {
  const templates = await db.unsafe<{ id: string; name: string }[]>(
    'SELECT id, name FROM templates WHERE deleted_at IS NULL',
  );
  const byName = new Map(templates.map((row) => [row.name, row.id]));
  const search = input.search?.trim().toLowerCase() ?? '';
  return marketplaceAppliances
    .filter((app) =>
      search === ''
        ? true
        : [app.name, app.vendor, app.category, app.description].some((value) =>
            value.toLowerCase().includes(search),
          ),
    )
    .map((app) => toRow(app, byName.get(app.name) ?? null));
}

function qemuProperties(app: MarketplaceAppliance, imageId: string): Record<string, unknown> {
  const qemu = app.qemu;
  if (!qemu) throw new AppError('INTERNAL', 'qemu defaults missing');
  return {
    platform: app.arch,
    ram: qemu.ram,
    cpus: qemu.cpus,
    adapters: qemu.adapters,
    adapterType: qemu.adapterType,
    consoleType: qemu.consoleType,
    consoleAutoStart: true,
    bootPriority: 'c',
    ...(qemu.machineType ? { machineType: qemu.machineType } : {}),
    ...(qemu.cpuModel ? { cpuModel: qemu.cpuModel } : {}),
    options: qemu.options,
    linkedClone: true,
    disks: {
      hda: { imageId, interface: qemu.hdaInterface, format: qemu.format ?? 'qcow2' },
    },
  };
}

function dockerProperties(app: MarketplaceAppliance): Record<string, unknown> {
  const docker = app.docker;
  if (!docker) throw new AppError('INTERNAL', 'docker defaults missing');
  return {
    imageName: docker.image,
    adapters: docker.adapters,
    startCommand: docker.startCommand,
    environment: docker.environment,
    consoleType: docker.consoleType,
    consoleAutoStart: true,
  };
}

export async function installMarketplace(
  deps: AppDeps,
  jobs: JobService,
  auth: { userId: string | null },
  input: MarketplaceInstallInput,
): Promise<JobRow> {
  const app = marketplaceAppliances.find((entry) => entry.id === input.applianceId);
  if (!app) throw new AppError('NOT_FOUND', 'appliance not found in the catalog');
  const existing = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM templates WHERE name = $1 AND deleted_at IS NULL',
    [app.name],
  );
  if (existing[0]) throw new AppError('CONFLICT', `a template named ${app.name} already exists`);

  const job = await jobs.create('appliance.install', { applianceId: app.id, name: app.name });
  void runInstall(deps, jobs, job.id, app, auth.userId).catch(async (error: unknown) => {
    deps.logger.warn('appliance install failed', {
      applianceId: app.id,
      err: error instanceof Error ? error.message : String(error),
    });
    await jobs
      .fail(job.id, error instanceof Error ? error.message : 'appliance install failed')
      .catch(() => undefined);
  });
  return job;
}

async function runInstall(
  deps: AppDeps,
  jobs: JobService,
  jobId: string,
  app: MarketplaceAppliance,
  userId: string | null,
): Promise<void> {
  let imageId: string | null = null;
  let sha256: string | null = null;
  let imageFilename: string | null = null;
  let action: 'created' | 'reused' = 'created';

  if (app.image) {
    const directory = path.join(deps.config.stagingDir, 'appliance-imports');
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const temp = path.join(directory, `${jobId}.part`);
    try {
      await jobs.progress(jobId, 5, 'downloading');
      const downloaded = await downloadToFile(app.image.url, temp, {
        failureCode: 'BAD_REQUEST',
        onProgress: (received, total) => {
          if (total <= 0) return;
          const percent = 5 + Math.round((received / total) * 60);
          void jobs.progress(jobId, Math.min(65, percent), 'downloading').catch(() => undefined);
        },
      });
      if (downloaded.sizeBytes === 0) {
        throw new AppError('BAD_REQUEST', 'the downloaded appliance image is empty');
      }
      let sha256 = downloaded.sha256;
      if (app.image.compression) {
        // Mirrors ship some images compressed; unpack in place and hash the
        // unpacked bytes, since dedupe and stageBlob work on the real image.
        // Each tool refuses foreign suffixes, so rename first.
        const suffix = { bzip2: '.bz2', gzip: '.gz', xz: '.xz' }[app.image.compression];
        const tool = Bun.which(app.image.compression === 'gzip' ? 'gzip' : app.image.compression);
        if (!tool) {
          throw new AppError(
            'BINARY_MISSING',
            `${app.image.compression} is required on the controller to unpack this appliance image`,
          );
        }
        const compressed = `${temp}${suffix}`;
        await rename(temp, compressed);
        const unpacked = Bun.spawn([tool, '-f', '-d', compressed], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(unpacked.stderr).text(),
          unpacked.exited,
        ]);
        if (exitCode !== 0) {
          throw new AppError('BAD_REQUEST', 'the appliance image could not be decompressed', {
            details: stderr.trim().slice(0, 2_000),
          });
        }
        const hasher = new Bun.CryptoHasher('sha256');
        for await (const chunk of Bun.file(temp).stream()) hasher.update(chunk);
        sha256 = hasher.digest('hex');
      }
      await jobs.progress(jobId, 70, 'validating image');
      const info = await validateArtifact(deps, 'qemu', temp);
      const reused = await deps.db.unsafe<{ id: string; filename: string }[]>(
        'SELECT id, filename FROM images WHERE sha256 = $1 LIMIT 1',
        [sha256],
      );
      if (reused[0]) {
        imageId = reused[0].id;
        imageFilename = reused[0].filename;
        action = 'reused';
      } else {
        const stagedPath = await stageBlob(deps, temp, sha256, app.image.filename);
        imageFilename = app.image.filename;
        imageId = newId();
        const sizeBytes = (await Bun.file(stagedPath).stat()).size;
        await deps.db.unsafe(
          `INSERT INTO images (id, name, kind, filename, sha256, size_bytes, metadata, created_by)
           VALUES ($1, $2, 'qemu', $3, $4, $5, $6::jsonb, $7)`,
          [
            imageId,
            `${app.name} ${app.image.version}`,
            app.image.filename,
            sha256,
            sizeBytes,
            {
              ...info,
              stagedPath,
              sourceUrl: app.image.url,
              applianceId: app.id,
              version: app.image.version,
              importedAt: new Date().toISOString(),
            },
            userId,
          ],
        );
      }
      await deps.events.publish({
        type: 'image.updated',
        payload: { imageId, sha256, action, kind: 'qemu' },
      });
      const target = await firstOnlineCompute(deps.db);
      if (target) {
        try {
          const image = { id: imageId, sha256, filename: imageFilename };
          const source = await sourceForTarget(deps, image, target.id);
          await ensureOnCompute(deps, image, target.id, source);
        } catch (error) {
          deps.logger.warn('appliance image stored but the first replica is missing', {
            applianceId: app.id,
            imageId,
            computeId: target.id,
            err: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        deps.logger.warn('appliance image stored without replicas: no compute is online', {
          applianceId: app.id,
          imageId,
        });
      }
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  await jobs.progress(jobId, 90, 'creating template');
  const properties =
    app.nodeType === 'qemu' && imageId !== null
      ? qemuProperties(app, imageId)
      : dockerProperties(app);
  const template = await createTemplate(deps.db, userId, {
    name: app.name,
    nodeType: app.nodeType,
    category: app.category,
    symbol: app.symbol,
    defaultNameFormat: '{name}-{index}',
    properties,
    requiredImages:
      app.image && sha256 && imageId
        ? [
            {
              name: `${app.name} ${app.image.version}`,
              kind: 'qemu',
              filenamePattern: imageFilename ?? app.image.filename,
              sha256,
            },
          ]
        : [],
    faults: [],
  });
  await jobs.complete(jobId, {
    templateId: template.id,
    ...(imageId ? { imageId } : {}),
  });
  deps.logger.info('appliance installed from catalog', {
    applianceId: app.id,
    templateId: template.id,
  });
}
