/** Snapshots, project export/import, and duplication through agent archives. */

import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  type DrawingSnapshot,
  type LinkSnapshot,
  type MarkerSnapshot,
  type NodeSnapshot,
  type ProjectManifest,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import tar from 'tar-stream';
import type { AppDeps } from '../implementer.ts';
import type { JobService } from './jobs.ts';
import { ensureProjectLinkDataplanes, listLinks } from './links.ts';
import { buildAgentSpec, getNode, listNodes } from './nodes.ts';

async function agentArchive(
  deps: AppDeps,
  computeId: string,
  projectId: string,
): Promise<Uint8Array> {
  const rows = await deps.db.unsafe<{ url: string }[]>('SELECT url FROM computes WHERE id = $1', [
    computeId,
  ]);
  const baseUrl = rows[0]?.url;
  if (!baseUrl) throw new AppError('AGENT_UNAVAILABLE', 'compute not found');
  const token = await deps.agents.agentToken(computeId);
  if (!token) throw new AppError('AGENT_UNAVAILABLE', 'compute has no agent token');
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/agent/projects/${projectId}/archive`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw new AppError('AGENT_ERROR', `archive failed on compute ${computeId}`, {
      details: await response.text(),
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function pushArchive(
  deps: AppDeps,
  computeId: string,
  projectId: string,
  archive: Uint8Array,
): Promise<void> {
  const rows = await deps.db.unsafe<{ url: string }[]>('SELECT url FROM computes WHERE id = $1', [
    computeId,
  ]);
  const baseUrl = rows[0]?.url;
  if (!baseUrl) throw new AppError('AGENT_UNAVAILABLE', 'compute not found');
  const token = await deps.agents.agentToken(computeId);
  if (!token) throw new AppError('AGENT_UNAVAILABLE', 'compute has no agent token');
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/agent/projects/${projectId}/archive`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
      body: new Blob([archive.buffer as ArrayBuffer]),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw new AppError('AGENT_ERROR', `restore failed on compute ${computeId}`, {
      details: await response.text(),
    });
  }
}

/** Build the manifest for a project (IDs preserved). */
export async function collectManifest(deps: AppDeps, projectId: string): Promise<ProjectManifest> {
  const projectRows = await deps.db.unsafe<
    { name: string; description: string | null; variables: unknown; scene: unknown }[]
  >('SELECT name, description, variables, scene FROM projects WHERE id = $1', [projectId]);
  const project = projectRows[0];
  if (!project) throw new AppError('NOT_FOUND', 'project not found');

  const nodes = await listNodes(deps.db, projectId);
  const links = await listLinks(deps.db, projectId);
  const drawings = await deps.db.unsafe<
    {
      id: string;
      project_id: string;
      type: string;
      svg: string | null;
      text: string | null;
      file_path: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      z: number;
      layer: string;
      locked: boolean;
      style: unknown;
    }[]
  >('SELECT * FROM drawings WHERE project_id = $1 ORDER BY z ASC', [projectId]);
  const markers = await deps.db.unsafe<
    {
      id: string;
      project_id: string;
      link_id: string;
      name: string;
      bpf: string;
      tag: number;
      color: string;
      highlight_duration: number;
      direction: 'tx' | 'rx' | null;
      enabled: boolean;
      paused: boolean;
    }[]
  >('SELECT * FROM markers WHERE project_id = $1 ORDER BY tag ASC', [projectId]);

  const nodeSnapshots: NodeSnapshot[] = nodes.map((node) => ({
    id: node.id,
    projectId: node.projectId,
    computeId: node.computeId,
    name: node.name,
    symbol: node.symbol,
    nodeType: node.nodeType,
    templateId: node.templateId,
    x: node.x,
    y: node.y,
    z: node.z,
    layer: node.layer,
    locked: node.locked,
    isolated: node.isolated,
    consolePort: node.consolePort,
    consoleType: node.consoleType,
    consoleAutoStart: node.consoleAutoStart,
    properties: node.properties,
    status: node.status,
  }));
  const linkSnapshots: LinkSnapshot[] = links.map((link) => ({
    id: link.id,
    projectId: link.projectId,
    linkType: link.linkType,
    nodeAId: link.nodeAId,
    adapterA: link.adapterA,
    portA: link.portA,
    nodeBId: link.nodeBId,
    adapterB: link.adapterB,
    portB: link.portB,
    suspend: link.suspend,
    status: link.status,
    style: link.style as unknown as Record<string, unknown>,
    filters: link.filters as unknown as Record<string, unknown>,
    capture: (link.capture as unknown as Record<string, unknown>) ?? null,
    dataplane: (link.dataplane as unknown as Record<string, unknown>) ?? null,
  }));
  const drawingSnapshots: DrawingSnapshot[] = drawings.map((drawing) => ({
    id: drawing.id,
    projectId: drawing.project_id,
    type: drawing.type,
    svg: drawing.svg,
    text: drawing.text,
    filePath: drawing.file_path,
    x: Number(drawing.x),
    y: Number(drawing.y),
    width: Number(drawing.width),
    height: Number(drawing.height),
    rotation: Number(drawing.rotation),
    z: drawing.z,
    layer: drawing.layer,
    locked: drawing.locked,
    style: parseJsonColumn(drawing.style, {}),
  }));
  const markerSnapshots: MarkerSnapshot[] = markers.map((marker) => ({
    id: marker.id,
    projectId: marker.project_id,
    linkId: marker.link_id,
    name: marker.name,
    bpf: marker.bpf,
    tag: marker.tag,
    color: marker.color,
    highlightDuration: marker.highlight_duration,
    direction: marker.direction,
    enabled: marker.enabled,
    paused: marker.paused,
  }));

  const templateIds = [
    ...new Set(nodes.map((node) => node.templateId).filter((id): id is string => id !== null)),
  ];
  const templates =
    templateIds.length === 0
      ? []
      : (
          await deps.db.unsafe<Record<string, unknown>[]>(
            'SELECT id, name, node_type, category, symbol, default_name_format, properties, required_images, faults FROM templates WHERE id = ANY($1::uuid[])',
            [templateIds],
          )
        ).map((row) => ({
          ...row,
          properties: parseJsonColumn(row.properties, {}),
          required_images: parseJsonColumn(row.required_images, []),
          faults: parseJsonColumn(row.faults, []),
        }));

  return {
    format: 'netlabor.project/1',
    createdAt: new Date().toISOString(),
    project: {
      name: project.name,
      description: project.description,
      variables: parseJsonColumn(project.variables, {}),
      scene: parseJsonColumn(project.scene, {}),
    },
    nodes: nodeSnapshots,
    links: linkSnapshots,
    drawings: drawingSnapshots,
    markers: markerSnapshots,
    templates,
    nodeComputes: Object.fromEntries(nodes.map((node) => [node.id, node.computeId])),
  };
}

async function tarGzip(files: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
  const done = new Promise<void>((resolve, reject) => {
    pack.on('end', resolve);
    pack.on('error', reject);
  });
  for (const file of files) {
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        { name: file.name, size: file.data.byteLength, mode: 0o644 },
        file.data,
        (error?: Error | null) => (error ? reject(error) : resolve()),
      );
    });
  }
  pack.finalize();
  await done;
  return new Uint8Array(Bun.gzipSync(Buffer.concat(chunks)));
}

export async function untarGzip(archive: Uint8Array): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(Bun.gunzipSync(Buffer.from(archive)));
  } catch {
    throw new AppError('BAD_REQUEST', 'archive is not gzip');
  }
  const extract = tar.extract();
  const pending: Promise<void>[] = [];
  extract.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    pending.push(
      new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
        stream.on('end', () => {
          files.set(header.name, new Uint8Array(Buffer.concat(chunks)));
          next();
          resolve();
        });
        stream.on('error', reject);
        stream.resume();
      }),
    );
  });
  const finished = new Promise<void>((resolve, reject) => {
    extract.on('finish', () => resolve());
    extract.on('error', reject);
  });
  extract.end(buffer);
  try {
    await finished;
    await Promise.all(pending);
  } catch {
    throw new AppError('BAD_REQUEST', 'invalid tar archive');
  }
  return files;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function snapshotDir(deps: AppDeps): string {
  return path.join(deps.config.stagingDir, 'snapshots');
}

function exportDir(deps: AppDeps): string {
  return path.join(deps.config.stagingDir, 'exports');
}

/** Stop running nodes, returning the ids that were started. */
async function stopRunningNodes(deps: AppDeps, projectId: string): Promise<string[]> {
  const rows = await deps.db.unsafe<{ id: string; compute_id: string }[]>(
    `SELECT id, compute_id FROM nodes WHERE project_id = $1 AND status = 'started'`,
    [projectId],
  );
  for (const row of rows) {
    await deps.agents
      .call(row.compute_id, (agent) => agent.stopNode({ projectId, nodeId: row.id }))
      .catch(() => undefined);
  }
  return rows.map((row) => row.id);
}

async function restartNodes(deps: AppDeps, projectId: string, nodeIds: string[]): Promise<void> {
  for (const nodeId of nodeIds) {
    const node = await getNode(deps.db, nodeId).catch(() => null);
    if (!node) continue;
    const spec = await buildAgentSpec(deps, node);
    await deps.agents
      .call(node.computeId, (agent) => agent.startNode(spec))
      .then(async () => {
        await deps.db.unsafe(
          `UPDATE nodes SET status = 'started', updated_at = now() WHERE id = $1`,
          [nodeId],
        );
      })
      .catch(() => undefined);
  }
  await ensureProjectLinkDataplanes(deps, projectId).catch(() => undefined);
}

export async function createSnapshot(
  deps: AppDeps,
  jobs: JobService,
  input: { projectId: string; name: string; description: string | null; userId: string },
): Promise<string> {
  const job = await jobs.create('snapshot.create', { projectId: input.projectId });
  void (async () => {
    try {
      const manifest = await collectManifest(deps, input.projectId);
      const running = await stopRunningNodes(deps, input.projectId);
      const computes = [...new Set(Object.values(manifest.nodeComputes))];
      const files: { name: string; data: Uint8Array }[] = [
        {
          name: 'manifest.json',
          data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        },
      ];
      let index = 0;
      for (const computeId of computes) {
        const archive = await agentArchive(deps, computeId, input.projectId);
        files.push({ name: `computes/${computeId}.tar.gz`, data: archive });
        index++;
        await jobs.progress(job.id, Math.round((index / (computes.length + 1)) * 100));
      }
      const bundle = await tarGzip(files);
      const id = newId();
      const target = path.join(snapshotDir(deps), `${id}.tar.gz`);
      await Bun.write(target, bundle);
      await deps.db.unsafe(
        `INSERT INTO snapshots (id, project_id, name, description, sha256, size_bytes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          input.projectId,
          input.name,
          input.description,
          sha256(bundle),
          bundle.byteLength,
          input.userId,
        ],
      );
      await restartNodes(deps, input.projectId, running);
      await deps.events.publish({
        type: 'snapshot.created',
        projectId: input.projectId,
        payload: { snapshotId: id, name: input.name },
      });
      await jobs.complete(job.id, { snapshotId: id, sizeBytes: bundle.byteLength });
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return job.id;
}

export async function restoreSnapshot(
  deps: AppDeps,
  jobs: JobService,
  snapshotId: string,
): Promise<string> {
  const rows = await deps.db.unsafe<{ project_id: string; sha256: string }[]>(
    'SELECT project_id, sha256 FROM snapshots WHERE id = $1',
    [snapshotId],
  );
  const snapshot = rows[0];
  if (!snapshot) throw new AppError('NOT_FOUND', 'snapshot not found');
  const job = await jobs.create('snapshot.restore', { projectId: snapshot.project_id });
  void (async () => {
    try {
      const bundle = new Uint8Array(
        await Bun.file(path.join(snapshotDir(deps), `${snapshotId}.tar.gz`)).arrayBuffer(),
      );
      if (sha256(bundle) !== snapshot.sha256) {
        throw new AppError('BAD_REQUEST', 'snapshot archive is corrupt');
      }
      const files = await untarGzip(bundle);
      const manifestRaw = files.get('manifest.json');
      if (!manifestRaw) throw new AppError('BAD_REQUEST', 'snapshot has no manifest');
      const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as ProjectManifest;
      const running = await stopRunningNodes(deps, snapshot.project_id);

      for (const [name, data] of files) {
        if (!name.startsWith('computes/')) continue;
        const computeId = name.slice('computes/'.length).replace(/\.tar\.gz$/, '');
        await pushArchive(deps, computeId, snapshot.project_id, data);
      }
      await applyManifest(deps, snapshot.project_id, manifest, { reuseIds: true });
      await restartNodes(deps, snapshot.project_id, running);
      await jobs.complete(job.id, { snapshotId, nodes: manifest.nodes.length });
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return job.id;
}

/** Replace topology rows of an existing project from a manifest. */
export async function applyManifest(
  deps: AppDeps,
  projectId: string,
  manifest: ProjectManifest,
  options: { reuseIds: boolean },
): Promise<void> {
  const idMap = new Map<string, string>();
  const mapId = (id: string): string => {
    if (options.reuseIds) return id;
    const mapped = idMap.get(id) ?? newId();
    idMap.set(id, mapped);
    return mapped;
  };

  await deps.db.begin(async (tx) => {
    const sql = tx as typeof deps.db;
    await sql.unsafe('DELETE FROM links WHERE project_id = $1', [projectId]);
    await sql.unsafe('DELETE FROM markers WHERE project_id = $1', [projectId]);
    await sql.unsafe('DELETE FROM drawings WHERE project_id = $1', [projectId]);
    await sql.unsafe('DELETE FROM nodes WHERE project_id = $1', [projectId]);

    for (const node of manifest.nodes) {
      const nodeId = mapId(node.id);
      const computeId = manifest.nodeComputes[node.id] ?? node.computeId;
      await sql.unsafe(
        `INSERT INTO nodes (id, project_id, compute_id, name, symbol, node_type, template_id, x, y, z, layer,
                            locked, isolated, console_port, console_type, console_auto_start, properties, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,'stopped')`,
        [
          nodeId,
          projectId,
          computeId,
          node.name,
          node.symbol,
          node.nodeType,
          node.templateId,
          node.x,
          node.y,
          node.z,
          node.layer,
          node.locked,
          node.isolated,
          node.consolePort,
          node.consoleType,
          node.consoleAutoStart,
          node.properties,
        ],
      );
    }
    for (const link of manifest.links) {
      await sql.unsafe(
        `INSERT INTO links (id, project_id, link_type, node_a_id, adapter_a, port_a, node_b_id, adapter_b, port_b,
                            suspend, status, style, filters)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11::jsonb,$12::jsonb)`,
        [
          mapId(link.id),
          projectId,
          link.linkType,
          mapId(link.nodeAId),
          link.adapterA,
          link.portA,
          mapId(link.nodeBId),
          link.adapterB,
          link.portB,
          link.suspend,
          link.style,
          link.filters,
        ],
      );
    }
    for (const drawing of manifest.drawings) {
      await sql.unsafe(
        `INSERT INTO drawings (id, project_id, type, svg, text, file_path, x, y, width, height, rotation, z, layer, locked, style)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          mapId(drawing.id),
          projectId,
          drawing.type,
          drawing.svg,
          drawing.text,
          drawing.filePath,
          drawing.x,
          drawing.y,
          drawing.width,
          drawing.height,
          drawing.rotation,
          drawing.z,
          drawing.layer,
          drawing.locked,
          drawing.style,
        ],
      );
    }
    for (const marker of manifest.markers) {
      await sql.unsafe(
        `INSERT INTO markers (id, project_id, link_id, name, bpf, tag, color, highlight_duration, direction, enabled, paused)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          mapId(marker.id),
          projectId,
          mapId(marker.linkId),
          marker.name,
          marker.bpf,
          marker.tag,
          marker.color,
          marker.highlightDuration,
          marker.direction,
          marker.enabled,
          marker.paused,
        ],
      );
    }
  });
}

export async function exportProject(
  deps: AppDeps,
  jobs: JobService,
  projectId: string,
): Promise<{ jobId: string; downloadUrl: string }> {
  const job = await jobs.create('project.export', { projectId });
  const downloadUrl = `/api/projects/${projectId}/export`;
  void (async () => {
    try {
      const manifest = await collectManifest(deps, projectId);
      const running = await stopRunningNodes(deps, projectId);
      const computes = [...new Set(Object.values(manifest.nodeComputes))];
      const files: { name: string; data: Uint8Array }[] = [
        {
          name: 'manifest.json',
          data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        },
      ];
      for (const computeId of computes) {
        files.push({
          name: `computes/${computeId}.tar.gz`,
          data: await agentArchive(deps, computeId, projectId),
        });
      }
      const bundle = await tarGzip(files);
      await Bun.write(path.join(exportDir(deps), `${projectId}.tar.gz`), bundle);
      await restartNodes(deps, projectId, running);
      await jobs.complete(job.id, { downloadUrl, sizeBytes: bundle.byteLength });
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return { jobId: job.id, downloadUrl };
}

export async function importProject(
  deps: AppDeps,
  jobs: JobService,
  input: { uploadId: string; name: string | null; userId: string },
): Promise<string> {
  const job = await jobs.create('project.import', {});
  void (async () => {
    try {
      const upload = await deps.db.unsafe<
        { path?: string; sha256: string | null; filename: string }[]
      >('SELECT filename, sha256 FROM uploads WHERE id = $1', [input.uploadId]);
      const record = upload[0];
      if (!record) throw new AppError('NOT_FOUND', 'upload not found');
      const uploadPath = path.join(deps.config.stagingDir, `${input.uploadId}.part`);
      const bundle = new Uint8Array(await Bun.file(uploadPath).arrayBuffer());
      const files = await untarGzip(bundle);
      const manifestRaw = files.get('manifest.json');
      if (!manifestRaw) throw new AppError('BAD_REQUEST', 'archive has no manifest.json');
      let manifest: ProjectManifest;
      try {
        manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as ProjectManifest;
      } catch {
        throw new AppError('BAD_REQUEST', 'manifest.json is not valid JSON');
      }
      if (manifest.format !== 'netlabor.project/1') {
        throw new AppError('BAD_REQUEST', 'unsupported project format');
      }
      const projectId = newId();
      await deps.db.unsafe(
        `INSERT INTO projects (id, name, description, owner_id, variables, scene)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          projectId,
          input.name ?? manifest.project.name,
          manifest.project.description,
          input.userId,
          manifest.project.variables ?? {},
          manifest.project.scene ?? {},
        ],
      );
      await applyManifest(deps, projectId, manifest, { reuseIds: false });
      for (const [name, data] of files) {
        if (!name.startsWith('computes/')) continue;
        const computeId = name.slice('computes/'.length).replace(/\.tar\.gz$/, '');
        await pushArchive(deps, computeId, projectId, data).catch(() => undefined);
      }
      await jobs.complete(job.id, { projectId });
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return job.id;
}

export async function duplicateProject(
  deps: AppDeps,
  jobs: JobService,
  input: { projectId: string; name: string; userId: string },
): Promise<string> {
  const job = await jobs.create('project.duplicate', { projectId: input.projectId });
  void (async () => {
    try {
      const manifest = await collectManifest(deps, input.projectId);
      const projectId = newId();
      await deps.db.unsafe(
        `INSERT INTO projects (id, name, description, owner_id, variables, scene)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          projectId,
          input.name,
          manifest.project.description,
          input.userId,
          manifest.project.variables ?? {},
          manifest.project.scene ?? {},
        ],
      );
      await applyManifest(deps, projectId, manifest, { reuseIds: false });
      await jobs.complete(job.id, { projectId });
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return job.id;
}

export async function deleteSnapshotFiles(deps: AppDeps, snapshotId: string): Promise<void> {
  await rm(path.join(snapshotDir(deps), `${snapshotId}.tar.gz`), { force: true });
}

export function snapshotPath(deps: AppDeps, snapshotId: string): string {
  return path.join(snapshotDir(deps), `${snapshotId}.tar.gz`);
}

export function exportPath(deps: AppDeps, projectId: string): string {
  return path.join(exportDir(deps), `${projectId}.tar.gz`);
}
