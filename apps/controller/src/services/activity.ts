/** In-memory project activity: SSE/WS subscribers and last event/traffic time. */

const lastActivity = new Map<string, number>();
const activeSockets = new Map<string, number>();

export function touchProject(projectId: string | null | undefined): void {
  if (!projectId) return;
  lastActivity.set(projectId, Date.now());
}

export function enterProject(projectId: string | null | undefined): void {
  if (!projectId) return;
  activeSockets.set(projectId, (activeSockets.get(projectId) ?? 0) + 1);
  touchProject(projectId);
}

export function leaveProject(projectId: string | null | undefined): void {
  if (!projectId) return;
  const next = (activeSockets.get(projectId) ?? 1) - 1;
  if (next <= 0) activeSockets.delete(projectId);
  else activeSockets.set(projectId, next);
  touchProject(projectId);
}

export function activeProjectSockets(projectId: string): number {
  return activeSockets.get(projectId) ?? 0;
}

export function projectIdleMs(projectId: string): number | null {
  const last = lastActivity.get(projectId);
  return last === undefined ? null : Date.now() - last;
}

export function forgetProject(projectId: string): void {
  lastActivity.delete(projectId);
  activeSockets.delete(projectId);
}
