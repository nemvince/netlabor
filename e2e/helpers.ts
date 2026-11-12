import { expect, type Page } from '@playwright/test';

/** Minimal row shapes copied from the API so the specs do not depend on build order. */
export interface ProjectRef {
  id: string;
  name: string;
  status: string;
}

export interface TemplateRef {
  id: string;
  name: string;
  nodeType: string;
  category: string;
  symbol: string;
}

export interface LinkRef {
  id: string;
  nodeAName: string;
  nodeBName: string;
  status: string;
  capture: { active: boolean; sizeBytes: number } | null;
}

/** Read the session cookie from the browser context so API checks use the same identity. */
export async function cookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Call one oRPC procedure over the same-origin RPC endpoint.
 * Returns `null` when the call fails or the caller lacks the privilege; specs
 * treat that as a missing prerequisite rather than a failure.
 */
export async function rpcJson<T>(page: Page, procedure: string, input: unknown): Promise<T | null> {
  try {
    const response = await page.request.post(`/rpc/${procedure}`, {
      headers: { cookie: await cookieHeader(page) },
      data: { json: input },
    });
    if (!response.ok()) return null;
    const body = (await response.json()) as { json?: T };
    return body.json ?? null;
  } catch {
    return null;
  }
}

/** Escape a literal string for use inside a RegExp selector. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the project under test. `NB_E2E_PROJECT` may be a project ID, an ID
 * prefix, or a project name; without it the first visible project is used.
 */
export async function resolveProject(page: Page): Promise<ProjectRef | null> {
  const projects = await rpcJson<ProjectRef[]>(page, 'projects/list', {
    limit: 200,
    offset: 0,
    includeClosed: true,
  });
  if (!projects || projects.length === 0) return null;
  const requested = (process.env.NB_E2E_PROJECT ?? '').trim();
  if (requested === '') return projects[0] ?? null;
  const needle = requested.toLowerCase();
  return (
    projects.find((project) => project.id === requested) ??
    projects.find((project) => project.id.startsWith(requested)) ??
    projects.find((project) => project.name.toLowerCase() === needle) ??
    projects.find((project) => project.name.toLowerCase().includes(needle)) ??
    null
  );
}

/** Open the workspace and wait for the React Flow surface to mount. */
export async function gotoWorkspace(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`);
  const canvas = page.getByRole('application', { name: 'Topology canvas' });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  return canvas;
}

/** Load the seeded catalog through the API; used to derive selectors from data. */
export async function loadTemplates(page: Page): Promise<TemplateRef[]> {
  return (await rpcJson<TemplateRef[]>(page, 'templates/list', { limit: 500, offset: 0 })) ?? [];
}

/** Load the links of a project through the API. */
export async function loadLinks(page: Page, projectId: string): Promise<LinkRef[]> {
  return (await rpcJson<LinkRef[]>(page, 'links/list', { projectId })) ?? [];
}
