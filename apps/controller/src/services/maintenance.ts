/** Periodic retention: events, expired sessions, stale uploads, and jobs. */

import { rm } from 'node:fs/promises';
import type { Logger } from '@netlabor/shared';
import type { AppDeps } from '../implementer.ts';
import { activeProjectSockets, forgetProject, projectIdleMs } from './activity.ts';
import { closeProject } from './projects.ts';
import { uploadPartPath } from './uploads.ts';

const HOUR_MS = 3_600_000;
const ACTIVITY_TICK_MS = 60_000;

export class Maintenance {
  private timer: ReturnType<typeof setInterval> | undefined;
  private activityTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly deps: AppDeps,
    private readonly logger: Logger,
  ) {}

  start(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), HOUR_MS);
    this.timer.unref?.();
    this.activityTimer = setInterval(() => void this.closeIdleProjects(), ACTIVITY_TICK_MS);
    this.activityTimer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.activityTimer);
    this.timer = undefined;
    this.activityTimer = undefined;
  }

  /** Close auto_close projects with no SSE/console activity for the configured idle window. */
  async closeIdleProjects(): Promise<void> {
    const minutes = this.deps.config.autoCloseIdleMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    try {
      const projects = await this.deps.db.unsafe<{ id: string; updated_at: Date }[]>(
        `SELECT id, updated_at FROM projects WHERE status = 'opened' AND auto_close = true`,
      );
      for (const project of projects) {
        if (activeProjectSockets(project.id) > 0) continue;
        const tracked = projectIdleMs(project.id);
        const idle = tracked ?? Date.now() - new Date(project.updated_at).getTime();
        if (idle < minutes * 60_000) continue;
        try {
          await closeProject(this.deps, project.id);
          forgetProject(project.id);
          this.logger.info('project auto-closed after idle window', { projectId: project.id });
        } catch (error) {
          this.logger.warn('project auto-close failed', {
            projectId: project.id,
            err: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      this.logger.warn('idle project scan failed', {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async runOnce(): Promise<void> {
    const { db } = this.deps;
    try {
      const events = await db.unsafe(
        `DELETE FROM events WHERE created_at < now() - interval '7 days' RETURNING id`,
      );
      const sessions = await db.unsafe(
        `DELETE FROM sessions WHERE expires_at < now() - interval '1 day' RETURNING id`,
      );
      const uploads = await db.unsafe<{ id: string }[]>(
        `DELETE FROM uploads WHERE created_at < now() - interval '1 day' RETURNING id`,
      );
      for (const upload of uploads) {
        await rm(uploadPartPath(this.deps.config, upload.id), { force: true }).catch(
          () => undefined,
        );
      }
      const jobs = await db.unsafe(
        `DELETE FROM jobs WHERE state <> 'running' AND updated_at < now() - interval '30 days' RETURNING id`,
      );
      const links = await db.unsafe(
        `WITH expired AS (DELETE FROM share_links WHERE expires_at < now() RETURNING guest_user_id),
              grants AS (DELETE FROM project_grants g USING expired e
                          WHERE g.subject_type = 'user' AND g.subject_id = e.guest_user_id
                          RETURNING g.id)
         DELETE FROM users u USING expired e WHERE u.id = e.guest_user_id RETURNING u.id`,
      );
      this.logger.debug('retention pass complete', {
        events: events.length,
        sessions: sessions.length,
        uploads: uploads.length,
        jobs: jobs.length,
        shareLinks: links.length,
      });
    } catch (error) {
      this.logger.warn('retention pass failed', {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
