/** Project routes: CRUD, lifecycle, slots, files, events, and statistics. */

import type { ProjectManifest } from '@netlabor/contract';
import { AppError } from '@netlabor/contract';
import { newId } from '@netlabor/shared';
import { hasPrivilege } from '../auth/principal.ts';
import type { SQL } from 'bun';
import type { AppDeps, Implementer } from '../implementer.ts';
import { applyProject } from '../services/apply.ts';
import {
  applyManifest,
  collectManifest,
  duplicateProject,
  exportPath,
  exportProject,
  importProject,
} from '../services/archives.ts';
import type { JobService } from '../services/jobs.ts';
import {
  closeProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  openProject,
  projectStats,
  requireUnlocked,
  setProjectLocked,
  updateProject,
  visibleProjectIds,
} from '../services/projects.ts';

export function projectRoutes(os: Implementer, deps: AppDeps, jobs: JobService) {
  return {
    projects: {
      list: os.projects.list.handler(async ({ input, context }) =>
        listProjects(context.db, context.auth, input),
      ),
      get: os.projects.get.handler(async ({ input, context }) => getProject(context.db, input.id)),
      create: os.projects.create.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return createProject(context, user.id, {
          name: input.name,
          description: input.description ?? null,
          poolId: input.poolId ?? null,
          variables: input.variables,
          autoOpen: input.autoOpen,
          autoClose: input.autoClose,
          autoStart: input.autoStart,
        });
      }),
      update: os.projects.update.handler(async ({ input, context }) => {
        await requireUnlocked(context.db, input.id);
        return updateProject(context, {
          id: input.id,
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.poolId !== undefined ? { poolId: input.poolId } : {}),
          ...(input.variables ? { variables: input.variables } : {}),
          ...(input.scene ? { scene: input.scene } : {}),
          ...(input.autoOpen !== undefined ? { autoOpen: input.autoOpen } : {}),
          ...(input.autoClose !== undefined ? { autoClose: input.autoClose } : {}),
          ...(input.autoStart !== undefined ? { autoStart: input.autoStart } : {}),
        });
      }),
      delete: os.projects.delete.handler(async ({ input, context }) => {
        await deleteProject(context, input.id);
        return { ok: true as const };
      }),
      open: os.projects.open.handler(async ({ input, context }) => openProject(context, input.id)),
      close: os.projects.close.handler(async ({ input, context }) =>
        closeProject(context, input.id),
      ),
      lock: os.projects.lock.handler(async ({ input, context }) =>
        setProjectLocked(context, input.id, true),
      ),
      unlock: os.projects.unlock.handler(async ({ input, context }) =>
        setProjectLocked(context, input.id, false),
      ),
      duplicate: os.projects.duplicate.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        const jobId = await duplicateProject(deps, jobs, {
          projectId: input.id,
          name: input.name,
          userId: user.id,
        });
        return jobs.get(jobId);
      }),
      export: os.projects.export.handler(async ({ input, context }) => {
        if (!context.auth.user) throw new AppError('UNAUTHORIZED', 'authentication required');
        await getProject(context.db, input.id);
        return exportProject(deps, jobs, input.id);
      }),
      exportArchive: os.projects.exportArchive.handler(async ({ input, context }) => {
        await getProject(context.db, input.id);
        const file = Bun.file(exportPath(deps, input.id));
        if (!(await file.exists())) throw new AppError('NOT_FOUND', 'export not ready');
        return new File([file], `project-${input.id}.tar.gz`, { type: 'application/gzip' });
      }),
      import: os.projects.import.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        const jobId = await importProject(deps, jobs, {
          uploadId: input.uploadId,
          name: input.name ?? null,
          userId: user.id,
          allowHostOptions: hasPrivilege(context.auth, 'compute.write', null),
        });
        return jobs.get(jobId);
      }),
      apply: os.projects.apply.handler(async ({ input, context }) => {
        const user = context.auth.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
        return applyProject(context, user.id, context.auth, input);
      }),
      stats: os.projects.stats.handler(async ({ input, context }) =>
        projectStats(context, input.id),
      ),
      events: os.projects.events.handler(async function* ({ input, context, signal }) {
        yield* context.events.stream({
          projectId: input.projectId,
          lastEventId: input.lastEventId,
          signal,
        });
      }),
      files: {
        list: os.projects.files.list.handler(async ({ input, context }) => {
          const computeId = await slotCompute(context.db, input.projectId);
          return context.agents.call(computeId, (agent) =>
            agent.projectFiles.list({ projectId: input.projectId, path: input.path }),
          );
        }),
        read: os.projects.files.read.handler(async ({ input, context }) => {
          const computeId = await slotCompute(context.db, input.projectId);
          return context.agents.call(computeId, (agent) =>
            agent.projectFiles.read({
              projectId: input.projectId,
              path: input.path,
              ...(input.encoding ? { encoding: input.encoding } : {}),
            }),
          );
        }),
        write: os.projects.files.write.handler(async ({ input, context }) => {
          const computeId = await slotCompute(context.db, input.projectId);
          return context.agents.call(computeId, (agent) =>
            agent.projectFiles.write({
              projectId: input.projectId,
              path: input.path,
              content: input.content,
              ...(input.encoding ? { encoding: input.encoding } : {}),
            }),
          );
        }),
        delete: os.projects.files.delete.handler(async ({ input, context }) => {
          const computeId = await slotCompute(context.db, input.projectId);
          await context.agents.call(computeId, (agent) =>
            agent.projectFiles.delete({ projectId: input.projectId, path: input.path }),
          );
          return { ok: true as const };
        }),
      },
      templates: {
        list: os.projects.templates.list.handler(async ({ context }) => {
          const rows = await context.db.unsafe<
            {
              id: string;
              name: string;
              description: string | null;
              created_by: string | null;
              created_at: Date;
            }[]
          >(
            'SELECT id, name, description, created_by, created_at FROM project_templates ORDER BY created_at DESC',
          );
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at.toISOString(),
          }));
        }),
        create: os.projects.templates.create.handler(async ({ input, context }) => {
          const user = context.auth.user;
          if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
          const manifest = await collectManifest(context, input.projectId);
          const id = newId();
          await context.db.unsafe(
            `INSERT INTO project_templates (id, name, description, topology, created_by)
             VALUES ($1,$2,$3,$4::jsonb,$5)`,
            [id, input.name, input.description ?? null, manifest, user.id],
          );
          return {
            id,
            name: input.name,
            description: input.description ?? null,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          };
        }),
        delete: os.projects.templates.delete.handler(async ({ context, input }) => {
          const rows = await context.db.unsafe<{ id: string }[]>(
            'DELETE FROM project_templates WHERE id = $1 RETURNING id',
            [input.id],
          );
          if (!rows[0]) throw new AppError('NOT_FOUND', 'project template not found');
          return { ok: true as const };
        }),
        apply: os.projects.templates.apply.handler(async ({ input, context }) => {
          const user = context.auth.user;
          if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
          const rows = await context.db.unsafe<{ topology: unknown }[]>(
            'SELECT topology FROM project_templates WHERE id = $1',
            [input.templateId],
          );
          const topology = rows[0]?.topology;
          if (topology === undefined) throw new AppError('NOT_FOUND', 'project template not found');
          const id = newId();
          const manifest = typeof topology === 'string' ? JSON.parse(topology) : topology;
          await context.db.unsafe(
            `INSERT INTO projects (id, name, description, owner_id, pool_id, variables, scene)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
            [
              id,
              input.name,
              manifest.project?.description ?? null,
              user.id,
              input.poolId ?? null,
              manifest.project?.variables ?? {},
              manifest.project?.scene ?? {},
            ],
          );
          await applyManifest(context, id, manifest as ProjectManifest, { reuseIds: false });
          return getProject(context.db, id);
        }),
      },
    },
  };
}

/** Files live on the compute that hosts the project's first slot. */
async function slotCompute(db: SQL, projectId: string): Promise<string> {
  const rows = await db.unsafe<{ compute_id: string }[]>(
    'SELECT compute_id FROM project_slots WHERE project_id = $1 ORDER BY slot LIMIT 1',
    [projectId],
  );
  const computeId = rows[0]?.compute_id;
  if (!computeId) {
    throw new AppError('CONFLICT', 'open the project before accessing its files');
  }
  return computeId;
}

export { visibleProjectIds };
