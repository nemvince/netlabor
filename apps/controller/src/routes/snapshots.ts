/** Snapshot routes plus project export/import/duplication. */

import { AppError } from '@netlabor/contract';
import type { AppDeps, Implementer } from '../implementer.ts';
import {
  createSnapshot,
  deleteSnapshotFiles,
  duplicateProject,
  exportProject,
  importProject,
  restoreSnapshot,
  snapshotPath,
} from '../services/archives.ts';
import type { JobService } from '../services/jobs.ts';
import { getProject } from '../services/projects.ts';

export function snapshotRoutes(os: Implementer, deps: AppDeps, jobs: JobService) {
  const requireUser = (context: { auth: { user: { id: string } | null } }): string => {
    const user = context.auth.user;
    if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
    return user.id;
  };

  return {
    snapshots: {
      list: os.snapshots.list.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<
          {
            id: string;
            project_id: string;
            name: string;
            description: string | null;
            sha256: string;
            size_bytes: number;
            created_by: string | null;
            created_at: Date;
          }[]
        >(
          `SELECT id, project_id, name, description, sha256, size_bytes, created_by, created_at
             FROM snapshots WHERE project_id = $1 ORDER BY created_at DESC`,
          [input.projectId],
        );
        return rows.map((row) => ({
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          description: row.description,
          sha256: row.sha256,
          sizeBytes: Number(row.size_bytes),
          createdBy: row.created_by,
          createdAt: row.created_at.toISOString(),
        }));
      }),
      create: os.snapshots.create.handler(async ({ input, context }) => {
        const userId = requireUser(context);
        const jobId = await createSnapshot(deps, jobs, {
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          userId,
        });
        return jobs.get(jobId);
      }),
      restore: os.snapshots.restore.handler(async ({ input, context }) => {
        requireUser(context);
        const jobId = await restoreSnapshot(deps, jobs, input.id);
        return jobs.get(jobId);
      }),
      delete: os.snapshots.delete.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<{ id: string }[]>(
          'DELETE FROM snapshots WHERE id = $1 RETURNING id',
          [input.id],
        );
        if (!rows[0]) throw new AppError('NOT_FOUND', 'snapshot not found');
        await deleteSnapshotFiles(deps, input.id);
        return { ok: true as const };
      }),
      download: os.snapshots.download.handler(async ({ input, context }) => {
        const rows = await context.db.unsafe<{ id: string }[]>(
          'SELECT id FROM snapshots WHERE id = $1',
          [input.id],
        );
        if (!rows[0]) throw new AppError('NOT_FOUND', 'snapshot not found');
        const exists = await Bun.file(snapshotPath(deps, input.id)).exists();
        if (!exists) throw new AppError('NOT_FOUND', 'snapshot archive is missing');
        return { downloadUrl: `/api/snapshots/${input.id}/download` };
      }),
      downloadArchive: os.snapshots.downloadArchive.handler(async ({ input }) => {
        const file = Bun.file(snapshotPath(deps, input.id));
        if (!(await file.exists())) throw new AppError('NOT_FOUND', 'snapshot archive is missing');
        return new File([file], `snapshot-${input.id}.tar.gz`, { type: 'application/gzip' });
      }),
    },
  };
}

export function projectArchiveRoutes(os: Implementer, deps: AppDeps, jobs: JobService) {
  const requireUser = (context: { auth: { user: { id: string } | null } }): string => {
    const user = context.auth.user;
    if (!user) throw new AppError('UNAUTHORIZED', 'authentication required');
    return user.id;
  };

  return {
    projects: {
      duplicate: os.projects.duplicate.handler(async ({ input, context }) => {
        const userId = requireUser(context);
        const jobId = await duplicateProject(deps, jobs, {
          projectId: input.id,
          name: input.name,
          userId,
        });
        return jobs.get(jobId);
      }),
      export: os.projects.export.handler(async ({ input, context }) => {
        requireUser(context);
        await getProject(context.db, input.id);
        return exportProject(deps, jobs, input.id);
      }),
      import: os.projects.import.handler(async ({ input, context }) => {
        const userId = requireUser(context);
        const jobId = await importProject(deps, jobs, {
          uploadId: input.uploadId,
          name: input.name ?? null,
          userId,
        });
        return jobs.get(jobId);
      }),
    },
  };
}
