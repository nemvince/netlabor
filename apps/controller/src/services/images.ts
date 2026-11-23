/** Image library: artifact validation, blob staging, replicas, sync, and prune. */

import { constants, type Stats } from 'node:fs';
import { access, chmod, copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  type ImageKind,
  type ImageListInput,
  type ImagePruneInput,
  type ImageRow,
  type ImageSource,
  type ImageSyncInput,
  type JobRow,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import type { JobService } from './jobs.ts';
import {
  type UploadRecord,
  uploadBlobPath,
  uploadPartPath,
  verifyCompletedUpload,
} from './uploads.ts';

interface ImageRecord {
  id: string;
  name: string;
  kind: ImageKind;
  filename: string;
  sha256: string;
  size_bytes: string | number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
}

interface ReplicaRecord {
  image_id: string;
  compute_id: string;
  compute_name: string;
  state: 'present' | 'syncing' | 'missing';
  path: string | null;
  verified_at: Date | null;
}

const IMAGE_COLUMNS = `
  id, name, kind, filename, sha256, size_bytes, metadata, created_by, created_at`;

function toImageRow(record: ImageRecord, replicas: ReplicaRecord[]): ImageRow {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    filename: record.filename,
    sha256: record.sha256,
    sizeBytes: Number(record.size_bytes),
    metadata: parseJsonColumn(record.metadata, {}),
    createdBy: record.created_by,
    createdAt: record.created_at.toISOString(),
    replicas: replicas.map((replica) => ({
      computeId: replica.compute_id,
      computeName: replica.compute_name,
      state: replica.state,
      path: replica.path,
      verifiedAt: replica.verified_at?.toISOString() ?? null,
    })),
  };
}

async function loadReplicas(db: SQL, imageIds: string[]): Promise<Map<string, ReplicaRecord[]>> {
  const map = new Map<string, ReplicaRecord[]>();
  if (imageIds.length === 0) return map;
  const rows = await db.unsafe<ReplicaRecord[]>(
    `SELECT r.image_id, r.compute_id, c.name AS compute_name, r.state, r.path, r.verified_at
       FROM image_replicas r JOIN computes c ON c.id = r.compute_id
      WHERE r.image_id = ANY($1::uuid[])
      ORDER BY c.name ASC`,
    [imageIds],
  );
  for (const row of rows) {
    const list = map.get(row.image_id) ?? [];
    list.push(row);
    map.set(row.image_id, list);
  }
  return map;
}

/** Glob-ish match for template `filenamePattern` values (`*` and `?`). */
export function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(value);
}

export interface ImageRequirement {
  name: string;
  kind: ImageKind;
  filenamePattern: string;
  sha256?: string;
}

/** Find a library image satisfying a template requirement (sha, name or glob). */
export function matchRequiredImage(
  images: ImageRow[],
  required: ImageRequirement,
): ImageRow | undefined {
  return images.find(
    (image) =>
      image.kind === required.kind &&
      (image.sha256 === required.sha256 ||
        image.name === required.name ||
        matchesGlob(image.name, required.filenamePattern) ||
        matchesGlob(image.filename, required.filenamePattern)),
  );
}

export async function listImages(db: SQL, input: ImageListInput): Promise<ImageRow[]> {
  const records = await db.unsafe<ImageRecord[]>(
    `SELECT ${IMAGE_COLUMNS}
       FROM images
      WHERE ($1::text IS NULL OR kind = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR filename ILIKE '%' || $2 || '%')
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [input.kind ?? null, input.search ?? null, input.limit, input.offset],
  );
  const replicas = await loadReplicas(
    db,
    records.map((record) => record.id),
  );
  return records.map((record) => toImageRow(record, replicas.get(record.id) ?? []));
}

export async function getImage(db: SQL, id: string): Promise<ImageRow> {
  const records = await db.unsafe<ImageRecord[]>(
    `SELECT ${IMAGE_COLUMNS} FROM images WHERE id = $1`,
    [id],
  );
  const record = records[0];
  if (!record) throw new AppError('NOT_FOUND', 'image not found');
  const replicas = await loadReplicas(db, [id]);
  return toImageRow(record, replicas.get(id) ?? []);
}

export async function listImageReplicas(db: SQL, imageId: string): Promise<ImageRow['replicas']> {
  await getImage(db, imageId);
  const replicas = (await loadReplicas(db, [imageId])).get(imageId) ?? [];
  return replicas.map((replica) => ({
    computeId: replica.compute_id,
    computeName: replica.compute_name,
    state: replica.state,
    path: replica.path,
    verifiedAt: replica.verified_at?.toISOString() ?? null,
  }));
}

/* ------------------------------------------------------------ references --- */

interface ReferenceRow {
  id: string;
  name: string;
}

async function nodeReferences(db: SQL, imageId: string): Promise<ReferenceRow[]> {
  return db.unsafe<ReferenceRow[]>(
    `SELECT DISTINCT n.id, n.name
       FROM nodes n
       CROSS JOIN LATERAL (
         SELECT CASE WHEN jsonb_typeof(n.properties) = 'string'
                     THEN (n.properties #>> '{}')::jsonb
                     ELSE n.properties END AS props
       ) normalized
      WHERE normalized.props->>'imageId' = $1::text
         OR normalized.props->>'cdromImageId' = $1::text
         OR normalized.props->>'biosImageId' = $1::text
         OR normalized.props->>'kernelImageId' = $1::text
         OR normalized.props->>'initrdImageId' = $1::text
         OR (jsonb_typeof(normalized.props->'disks') = 'object'
             AND EXISTS (
               SELECT 1 FROM jsonb_each(normalized.props->'disks') AS disk
                WHERE disk.value->>'imageId' = $1::text
             ))
      ORDER BY n.name ASC`,
    [imageId],
  );
}

async function templateReferences(db: SQL, sha256: string): Promise<ReferenceRow[]> {
  return db.unsafe<ReferenceRow[]>(
    `SELECT t.id, t.name
       FROM templates t
       CROSS JOIN LATERAL (
         SELECT CASE WHEN jsonb_typeof(t.required_images) = 'string'
                     THEN (t.required_images #>> '{}')::jsonb
                     ELSE t.required_images END AS required_images
       ) normalized
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(normalized.required_images) AS required
         WHERE required->>'sha256' = $1
      )
      ORDER BY t.name ASC`,
    [sha256],
  );
}

interface ImageReferences {
  nodes: ReferenceRow[];
  templates: ReferenceRow[];
}

async function collectReferences(
  db: SQL,
  image: { id: string; sha256: string },
): Promise<ImageReferences> {
  const [nodes, templates] = await Promise.all([
    nodeReferences(db, image.id),
    templateReferences(db, image.sha256),
  ]);
  return { nodes, templates };
}

/* --------------------------------------------------------------- staging --- */

function nfsRoot(deps: AppDeps): string {
  const root = deps.config.nfsImageDir;
  if (!root) {
    throw new AppError('CAPABILITY_UNSUPPORTED', 'NB_NFS_IMAGE_DIR is not configured');
  }
  return root;
}

/**
 * Fail before serving traffic when the shared image directory is absent or not
 * writable, instead of writing images into an unmounted local mountpoint.
 */
export async function ensureImageStore(deps: AppDeps): Promise<void> {
  if (deps.config.storageDriver !== 'nfs') return;
  const root = nfsRoot(deps);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(
      `NFS image directory ${root} is not mounted or is not a directory; ` +
        `mount it before starting the controller`,
    );
  }
  try {
    await access(root, constants.W_OK);
  } catch {
    throw new Error(
      `NFS image directory ${root} is not writable by the controller user; ` +
        `check the export and ownership`,
    );
  }
}

export function stagedBlobPath(deps: AppDeps, sha256: string, filename: string): string {
  if (deps.config.storageDriver === 'nfs') {
    return path.join(nfsRoot(deps), sha256, filename);
  }
  return uploadBlobPath(deps.config, sha256, filename);
}

async function syncToDisk(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function stageBlob(
  deps: AppDeps,
  partPath: string,
  sha256: string,
  filename: string,
): Promise<string> {
  if (deps.config.storageDriver === 'nfs') {
    const root = nfsRoot(deps);
    let rootStat: Stats;
    try {
      rootStat = await stat(root);
    } catch {
      throw new AppError('CAPABILITY_UNSUPPORTED', `NFS image directory ${root} is not mounted`);
    }
    if (!rootStat.isDirectory()) {
      throw new AppError(
        'CAPABILITY_UNSUPPORTED',
        `NFS image directory ${root} is not a directory`,
      );
    }
    const directory = path.join(root, sha256);
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const target = path.join(directory, filename);
    const temp = path.join(directory, `.tmp-${process.pid}-${Date.now()}`);
    await copyFile(partPath, temp);
    // Uploads start 0600; computes and the emulator account must be able to read.
    await chmod(temp, 0o644);
    await syncToDisk(temp);
    await rename(temp, target);
    return target;
  }

  const target = uploadBlobPath(deps.config, sha256, filename);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await copyFile(partPath, temp);
  await chmod(temp, 0o644);
  await syncToDisk(temp);
  await rename(temp, target);
  return target;
}

/* --------------------------------------------------------- compatibility --- */

interface QemuImgInfo {
  format?: string;
  'virtual-size'?: number;
  'actual-size'?: number;
  'cluster-size'?: number;
}

function startsWithMagic(head: Uint8Array, magic: number[]): boolean {
  if (head.length < magic.length) return false;
  return magic.every((byte, index) => head[index] === byte);
}

const QCOW2_MAGIC = [0x51, 0x46, 0x49, 0xfb];
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];

async function readHead(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(filePath).slice(0, 16).arrayBuffer());
}

async function inspectQemuImage(deps: AppDeps, filePath: string): Promise<Record<string, unknown>> {
  const qemuImg = Bun.which('qemu-img');
  if (!qemuImg) {
    const head = await readHead(filePath);
    const format = startsWithMagic(head, QCOW2_MAGIC) ? 'qcow2' : 'raw';
    deps.logger.warn('qemu-img is not installed; validating QEMU image by magic bytes only', {
      format,
    });
    return { format, validation: 'magic' };
  }
  const proc = Bun.spawn({
    cmd: [qemuImg, 'info', '--output=json', filePath],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new AppError('BAD_REQUEST', 'the uploaded file is not a valid QEMU disk image', {
      details: { stderr: stderr.trim().slice(0, 2000) },
    });
  }
  let info: QemuImgInfo;
  try {
    info = JSON.parse(stdout) as QemuImgInfo;
  } catch {
    throw new AppError('BAD_REQUEST', 'qemu-img returned unparseable metadata');
  }
  return {
    format: info.format ?? 'unknown',
    virtualSize: info['virtual-size'] ?? null,
    actualSize: info['actual-size'] ?? null,
    clusterSize: info['cluster-size'] ?? null,
    validation: 'qemu-img',
  };
}

export async function validateArtifact(
  deps: AppDeps,
  kind: ImageKind,
  filePath: string,
): Promise<Record<string, unknown>> {
  if (kind === 'docker') {
    throw new AppError('BAD_REQUEST', 'Docker images are pulled from a registry, not uploaded');
  }
  const head = await readHead(filePath);
  if (kind === 'iou') {
    if (!startsWithMagic(head, ELF_MAGIC)) {
      throw new AppError('BAD_REQUEST', 'an IOU image must be an ELF executable');
    }
    return { format: 'elf', elfClass: head[4] === 2 ? 64 : 32, validation: 'magic' };
  }
  if (kind === 'qemu') {
    return inspectQemuImage(deps, filePath);
  }
  return { format: 'binary', validation: 'file' };
}

/* -------------------------------------------------------------- agents --- */

interface ComputeTarget {
  id: string;
  name: string;
  url: string;
}

export async function getComputeTarget(db: SQL, id: string): Promise<ComputeTarget> {
  const rows = await db.unsafe<ComputeTarget[]>(
    'SELECT id, name, url FROM computes WHERE id = $1',
    [id],
  );
  const compute = rows[0];
  if (!compute) throw new AppError('NOT_FOUND', `compute ${id} not found`);
  return compute;
}

export async function firstOnlineCompute(db: SQL): Promise<ComputeTarget | null> {
  const rows = await db.unsafe<ComputeTarget[]>(
    "SELECT id, name, url FROM computes WHERE status = 'online' ORDER BY name ASC LIMIT 1",
  );
  return rows[0] ?? null;
}

export async function setReplicaState(
  db: SQL,
  imageId: string,
  computeId: string,
  state: 'present' | 'syncing' | 'missing',
  replicaPath: string | null,
): Promise<void> {
  await db.unsafe(
    `INSERT INTO image_replicas (image_id, compute_id, state, path, verified_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'present' THEN now() ELSE NULL END)
     ON CONFLICT (image_id, compute_id) DO UPDATE SET
       state = EXCLUDED.state,
       path = EXCLUDED.path,
       verified_at = EXCLUDED.verified_at`,
    [imageId, computeId, state, replicaPath],
  );
}

async function controllerSource(
  deps: AppDeps,
  image: { sha256: string; filename: string },
  computeId: string,
): Promise<ImageSource> {
  const token = await deps.agents.agentToken(computeId);
  if (!token) {
    throw new AppError('AGENT_UNAVAILABLE', 'the target compute has no agent token');
  }
  const url = `${deps.config.publicUrl}/agent/blobs/${image.sha256}/${encodeURIComponent(image.filename)}`;
  return { type: 'controller', url, token };
}

async function peerSource(
  deps: AppDeps,
  image: { id: string; sha256: string; filename: string },
  excludeComputeId: string,
): Promise<ImageSource | null> {
  const rows = await deps.db.unsafe<{ compute_id: string; url: string }[]>(
    `SELECT r.compute_id, c.url
       FROM image_replicas r JOIN computes c ON c.id = r.compute_id
      WHERE r.image_id = $1 AND r.state = 'present' AND r.compute_id <> $2
      ORDER BY r.verified_at DESC NULLS LAST
      LIMIT 1`,
    [image.id, excludeComputeId],
  );
  const peer = rows[0];
  if (!peer) return null;
  const token = await deps.agents.agentToken(peer.compute_id);
  if (!token) return null;
  const url = `${peer.url.replace(/\/$/, '')}/agent/blobs/${image.sha256}/${encodeURIComponent(image.filename)}`;
  return { type: 'peer', url, token };
}

export async function ensureOnCompute(
  deps: AppDeps,
  image: { id: string; sha256: string; filename: string },
  computeId: string,
  source: ImageSource,
): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  await setReplicaState(deps.db, image.id, computeId, 'syncing', null);
  try {
    const result = await deps.agents.callLong(computeId, (agent) =>
      agent.image.ensure({
        sha256: image.sha256,
        filename: image.filename,
        source,
      }),
    );
    await setReplicaState(deps.db, image.id, computeId, 'present', result.path);
    await deps.events.publish({
      type: 'image.updated',
      payload: {
        imageId: image.id,
        sha256: image.sha256,
        computeId,
        state: 'present',
        path: result.path,
      },
    });
    return result;
  } catch (error) {
    await setReplicaState(deps.db, image.id, computeId, 'missing', null).catch(() => undefined);
    await deps.events
      .publish({
        type: 'image.updated',
        payload: {
          imageId: image.id,
          sha256: image.sha256,
          computeId,
          state: 'missing',
          message: error instanceof Error ? error.message : String(error),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

async function assertStagedBlob(
  deps: AppDeps,
  image: { sha256: string; filename: string },
): Promise<void> {
  const blob = stagedBlobPath(deps, image.sha256, image.filename);
  try {
    const info = await stat(blob);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    throw new AppError('IMAGE_MISSING', 'the staged image blob is missing; upload the image again');
  }
}

export async function sourceForTarget(
  deps: AppDeps,
  image: { id: string; sha256: string; filename: string },
  computeId: string,
): Promise<ImageSource> {
  if (deps.config.storageDriver === 'nfs') return { type: 'nfs' };
  const peer = await peerSource(deps, image, computeId);
  if (peer) return peer;
  await assertStagedBlob(deps, image);
  return controllerSource(deps, image, computeId);
}

/* ---------------------------------------------------------- create/delete --- */

export async function createImageFromUpload(
  deps: AppDeps,
  auth: { userId: string; isAdmin: boolean },
  input: { uploadId: string; name: string; kind: ImageKind },
): Promise<ImageRow> {
  const { record, partPath, sha256 }: { record: UploadRecord; partPath: string; sha256: string } =
    await verifyCompletedUpload(deps.db, deps.config, input.uploadId);
  if (record.user_id && record.user_id !== auth.userId && !auth.isAdmin) {
    throw new AppError('FORBIDDEN', 'this upload belongs to another user');
  }
  const filename = path.basename(record.filename);
  if (filename !== record.filename) {
    throw new AppError('BAD_REQUEST', 'upload filename cannot contain path separators');
  }

  const duplicate = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM images WHERE sha256 = $1',
    [sha256],
  );
  if (duplicate[0]) {
    // The bytes are already in the library; the staged upload is dead weight.
    await deps.db.unsafe('DELETE FROM uploads WHERE id = $1', [input.uploadId]);
    await rm(partPath, { force: true }).catch(() => undefined);
    throw new AppError('CONFLICT', 'an image with this sha256 already exists', {
      details: { imageId: duplicate[0].id },
    });
  }

  const metadata = await validateArtifact(deps, input.kind, partPath);
  const stagedPath = await stageBlob(deps, partPath, sha256, filename);

  const id = newId();
  const size = (await stat(stagedPath)).size;
  const rows = await deps.db.unsafe<ImageRecord[]>(
    `INSERT INTO images (id, name, kind, filename, sha256, size_bytes, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING ${IMAGE_COLUMNS}`,
    [
      id,
      input.name,
      input.kind,
      filename,
      sha256,
      size,
      { ...metadata, stagedPath, sourceFilename: record.filename },
      auth.userId,
    ],
  );
  const created = rows[0];
  if (!created) throw new AppError('INTERNAL', 'image insert did not return a row');

  const image = { id, sha256, filename };
  const target = await firstOnlineCompute(deps.db);
  if (target) {
    try {
      const source = await sourceForTarget(deps, image, target.id);
      await ensureOnCompute(deps, image, target.id, source);
    } catch (error) {
      deps.logger.warn('image stored but the first replica is missing', {
        imageId: id,
        computeId: target.id,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    deps.logger.warn('image stored without replicas: no compute is online', { imageId: id });
  }

  await deps.events.publish({
    type: 'image.updated',
    payload: { imageId: id, sha256, action: 'created', kind: input.kind },
  });
  // The image now lives in the blob store; drop the staged upload copy.
  await deps.db.unsafe('DELETE FROM uploads WHERE id = $1', [input.uploadId]);
  await rm(uploadPartPath(deps.config, input.uploadId), { force: true }).catch(() => undefined);
  return getImage(deps.db, id);
}

export async function updateImageName(
  deps: AppDeps,
  input: { id: string; name: string },
): Promise<ImageRow> {
  const name = input.name.trim();
  if (name === '') throw new AppError('BAD_REQUEST', 'image name is required');
  const rows = await deps.db.unsafe<{ id: string }[]>(
    'UPDATE images SET name = $2 WHERE id = $1 RETURNING id',
    [input.id, name],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'image not found');
  await deps.events.publish({
    type: 'image.updated',
    payload: { imageId: input.id, action: 'renamed' },
  });
  return getImage(deps.db, input.id);
}

export async function deleteImage(deps: AppDeps, userId: string | null, id: string): Promise<void> {
  const image = await getImage(deps.db, id);
  const references = await collectReferences(deps.db, image);
  const running = await deps.db.unsafe<{ name: string }[]>(
    `SELECT DISTINCT n.name
       FROM nodes n
       CROSS JOIN LATERAL (
         SELECT CASE WHEN jsonb_typeof(n.properties) = 'string'
                     THEN (n.properties #>> '{}')::jsonb
                     ELSE n.properties END AS props
       ) normalized
      WHERE n.status IN ('started', 'suspended')
        AND (normalized.props->>'imageId' = $1::text
          OR normalized.props->>'cdromImageId' = $1::text
          OR (jsonb_typeof(normalized.props->'disks') = 'object'
              AND EXISTS (
                SELECT 1 FROM jsonb_each(normalized.props->'disks') AS disk
                 WHERE disk.value->>'imageId' = $1::text
              )))
      ORDER BY n.name ASC`,
    [id],
  );
  if (running.length > 0) {
    throw new AppError('CONFLICT', 'image is in use by running nodes', {
      details: { nodes: running },
    });
  }
  // Stop-time references are detached so images (including bundled ones) can
  // be removed: template requirements drop the entry, node properties forget it.
  if (references.templates.length > 0) {
    await deps.db.unsafe(
      `UPDATE templates t
          SET required_images = COALESCE((
                SELECT jsonb_agg(required)
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(t.required_images) = 'string'
                              THEN (t.required_images #>> '{}')::jsonb
                              ELSE t.required_images END) AS required
                 WHERE required->>'sha256' IS DISTINCT FROM $1::text
                   AND required->>'name' IS DISTINCT FROM $2::text
              ), '[]'::jsonb),
              updated_at = now()
        WHERE t.id = ANY($3::uuid[])`,
      [image.sha256, image.name, references.templates.map((row) => row.id)],
    );
  }
  if (references.nodes.length > 0) {
    const nodeIds = references.nodes.map((row) => row.id);
    const rows = await deps.db.unsafe<{ id: string; properties: unknown }[]>(
      'SELECT id, properties FROM nodes WHERE id = ANY($1::uuid[])',
      [nodeIds],
    );
    for (const row of rows) {
      const properties = parseJsonColumn<Record<string, unknown>>(row.properties, {});
      for (const key of [
        'imageId',
        'cdromImageId',
        'biosImageId',
        'kernelImageId',
        'initrdImageId',
      ]) {
        if (properties[key] === id) delete properties[key];
      }
      const disks = properties.disks;
      if (disks && typeof disks === 'object' && !Array.isArray(disks)) {
        for (const disk of Object.values(disks as Record<string, unknown>)) {
          if (disk && typeof disk === 'object' && (disk as { imageId?: string }).imageId === id) {
            delete (disk as { imageId?: string }).imageId;
          }
        }
      }
      await deps.db.unsafe('UPDATE nodes SET properties = $2::jsonb WHERE id = $1', [
        row.id,
        properties,
      ]);
    }
  }

  // One shared NFS copy: the controller removes it once. Asking every agent to
  // delete it would race and requires write access the compute often lacks.
  if (deps.config.storageDriver !== 'nfs') {
    for (const replica of image.replicas) {
      await deps.agents
        .call(replica.computeId, (agent) => agent.image.delete({ sha256: image.sha256 }))
        .catch((error: unknown) => {
          deps.logger.warn('failed to delete an image replica', {
            imageId: id,
            computeId: replica.computeId,
            err: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  await deps.db.unsafe('DELETE FROM images WHERE id = $1', [id]);
  await deps.db.unsafe('DELETE FROM image_replicas WHERE image_id = $1', [id]);

  const blobDirectory = path.dirname(stagedBlobPath(deps, image.sha256, image.filename));
  await rm(blobDirectory, { recursive: true, force: true }).catch(() => undefined);

  await deps.events.publish({
    type: 'image.updated',
    payload: { imageId: id, sha256: image.sha256, action: 'deleted', userId },
  });
}

/* ------------------------------------------------------------------- jobs --- */

export async function syncImage(
  deps: AppDeps,
  jobs: JobService,
  input: ImageSyncInput,
): Promise<JobRow> {
  const image = await getImage(deps.db, input.imageId);
  const computeIds = [...new Set(input.computeIds)];
  for (const computeId of computeIds) await getComputeTarget(deps.db, computeId);

  const job = await jobs.create('image.sync', {
    imageId: image.id,
    computeIds,
    sha256: image.sha256,
  });
  void runSync(deps, jobs, job.id, image, computeIds).catch(async (error: unknown) => {
    await jobs
      .fail(job.id, error instanceof Error ? error.message : String(error))
      .catch(() => undefined);
  });
  return job;
}

async function runSync(
  deps: AppDeps,
  jobs: JobService,
  jobId: string,
  image: ImageRow,
  computeIds: string[],
): Promise<void> {
  const failures: string[] = [];
  let index = 0;
  for (const computeId of computeIds) {
    index++;
    try {
      let source: ImageSource | null = null;
      let lastError: unknown = null;
      if (deps.config.storageDriver !== 'nfs') {
        const peer = await peerSource(deps, image, computeId).catch(() => null);
        if (peer) {
          try {
            await ensureOnCompute(deps, image, computeId, peer);
            source = peer;
          } catch (error) {
            lastError = error;
          }
        }
      }
      if (!source) {
        const fallback = await sourceForTarget(deps, image, computeId);
        try {
          await ensureOnCompute(deps, image, computeId, fallback);
          source = fallback;
        } catch (error) {
          lastError = error;
        }
      }
      if (!source) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        failures.push(`${computeId}: ${message}`);
      }
    } catch (error) {
      failures.push(`${computeId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await jobs.progress(jobId, Math.round((index / computeIds.length) * 100));
  }

  if (failures.length > 0) {
    await jobs.fail(jobId, `image sync failed: ${failures.join('; ')}`);
    return;
  }
  await jobs.complete(jobId, {
    imageId: image.id,
    sha256: image.sha256,
    computeIds,
    replicas: (await getImage(deps.db, image.id)).replicas,
  });
}

export async function pruneImages(
  deps: AppDeps,
  jobs: JobService,
  input: ImagePruneInput,
): Promise<JobRow> {
  const job = await jobs.create('image.prune', { dryRun: input.dryRun });
  void runPrune(deps, jobs, job.id, input.dryRun).catch(async (error: unknown) => {
    await jobs
      .fail(job.id, error instanceof Error ? error.message : String(error))
      .catch(() => undefined);
  });
  return job;
}

async function runPrune(
  deps: AppDeps,
  jobs: JobService,
  jobId: string,
  dryRun: boolean,
): Promise<void> {
  const records = await deps.db.unsafe<ImageRecord[]>(
    `SELECT ${IMAGE_COLUMNS} FROM images ORDER BY created_at ASC`,
  );
  const candidates: Array<{
    image: ImageRecord;
    replicas: ReplicaRecord[];
  }> = [];
  for (const record of records) {
    const references = await collectReferences(deps.db, record);
    if (references.nodes.length > 0 || references.templates.length > 0) continue;
    const replicas = (await loadReplicas(deps.db, [record.id])).get(record.id) ?? [];
    if (replicas.length === 0) continue;
    candidates.push({ image: record, replicas });
  }

  if (dryRun) {
    await jobs.complete(jobId, {
      dryRun: true,
      images: candidates.map((candidate) => ({
        imageId: candidate.image.id,
        name: candidate.image.name,
        sha256: candidate.image.sha256,
        replicas: candidate.replicas.map((replica) => ({
          computeId: replica.compute_id,
          computeName: replica.compute_name,
          path: replica.path,
        })),
      })),
    });
    return;
  }

  const removed: Array<{ imageId: string; computeId: string }> = [];
  const failures: string[] = [];
  for (const candidate of candidates) {
    if (deps.config.storageDriver === 'nfs') {
      try {
        await rm(path.join(nfsRoot(deps), candidate.image.sha256), {
          recursive: true,
          force: true,
        });
        await deps.db.unsafe('DELETE FROM image_replicas WHERE image_id = $1', [
          candidate.image.id,
        ]);
        for (const replica of candidate.replicas) {
          removed.push({ imageId: candidate.image.id, computeId: replica.compute_id });
        }
      } catch (error) {
        failures.push(
          `${candidate.image.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }
    for (const replica of candidate.replicas) {
      try {
        await deps.agents.call(replica.compute_id, (agent) =>
          agent.image.delete({ sha256: candidate.image.sha256 }),
        );
        await deps.db.unsafe('DELETE FROM image_replicas WHERE image_id = $1 AND compute_id = $2', [
          candidate.image.id,
          replica.compute_id,
        ]);
        removed.push({ imageId: candidate.image.id, computeId: replica.compute_id });
      } catch (error) {
        failures.push(
          `${candidate.image.name}@${replica.compute_name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    await jobs.fail(
      jobId,
      `prune failed for ${failures.length} replica(s): ${failures.join('; ')}`,
    );
    return;
  }
  await jobs.complete(jobId, { dryRun: false, removed });
}
