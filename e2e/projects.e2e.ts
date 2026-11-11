import { expect, test } from '@playwright/test';
import { gotoWorkspace, resolveProject, rpcJson } from './helpers.ts';

test.describe('projects', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('lists projects and their status', async ({ page }) => {
    const projects = await rpcJson<{ id: string }[]>(page, 'projects/list', {
      limit: 200,
      offset: 0,
      includeClosed: true,
    });
    test.skip(projects === null, 'project list is not readable for this account');
    if (projects === null) return;

    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filter project status' })).toBeVisible();

    if (projects.length === 0) {
      await expect(page.getByText('No projects match', { exact: true })).toBeVisible();
      return;
    }

    const table = page.getByRole('table', { name: 'Projects' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Project' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Actions' })).toBeVisible();
    const rows = table.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(
      rows
        .first()
        .getByRole('button', { name: /^(Open|Close|Lock|Unlock|Export|Duplicate) / })
        .first(),
    ).toBeVisible();
  });

  test('opens the project selected for the run', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    const canvas = await gotoWorkspace(page, project.id);
    await expect(canvas).toBeVisible();
    await expect(page.locator('main')).toContainText(project.name, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
  });

  test('filters the project list by search text', async ({ page }) => {
    const projects = await rpcJson<{ id: string }[]>(page, 'projects/list', {
      limit: 1,
      offset: 0,
      includeClosed: true,
    });
    test.skip(projects === null, 'project list is not readable for this account');
    if (projects === null) return;

    await page.goto('/projects');
    const search = page.getByRole('textbox', { name: 'Search projects' });
    await expect(search).toBeVisible();
    await search.fill(`zz-no-such-project-${Date.now()}`);
    await expect(page.getByText('No projects match', { exact: true })).toBeVisible();
    await search.fill('');
    if (projects.length === 1) {
      await expect(page.getByRole('table', { name: 'Projects' })).toBeVisible();
    }
  });
});
