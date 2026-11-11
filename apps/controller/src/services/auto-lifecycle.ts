/** Startup automation: honor auto_open/auto_start without touching user projects. */

import type { AppDeps } from '../implementer.ts';

export async function autoOpenAndStart(deps: AppDeps): Promise<void> {
  const projects = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM projects WHERE status = 'closed' AND auto_open = true ORDER BY created_at ASC`,
  );
  const { openProject } = await import('./projects.ts');
  for (const project of projects) {
    try {
      await openProject(deps, project.id);
      deps.logger.info('project auto-opened', { projectId: project.id });
    } catch (error) {
      deps.logger.warn('project auto-open failed', {
        projectId: project.id,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nodes = await deps.db.unsafe<{ id: string; owner_id: string | null }[]>(
    `SELECT n.id, p.owner_id
       FROM nodes n JOIN projects p ON p.id = n.project_id
      WHERE n.status = 'stopped' AND p.status = 'opened' AND p.auto_start = true
      ORDER BY p.created_at ASC, n.created_at ASC`,
  );
  if (nodes.length === 0) return;
  const fallback = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM users WHERE is_active ORDER BY created_at ASC LIMIT 1`,
  );
  const fallbackUserId = fallback[0]?.id ?? null;
  const { setNodePower } = await import('./nodes.ts');
  for (const node of nodes) {
    const userId = node.owner_id ?? fallbackUserId;
    if (!userId) break;
    try {
      await setNodePower(deps, userId, node.id, 'start');
      deps.logger.info('node auto-started', { nodeId: node.id });
    } catch (error) {
      deps.logger.warn('node auto-start failed', {
        nodeId: node.id,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
