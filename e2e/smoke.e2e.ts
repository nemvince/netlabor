import { expect, test } from '@playwright/test';

test.describe('controller UI', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('lists computes and their live status', async ({ page }) => {
    await page.goto('/computes');
    await expect(page.getByRole('heading', { name: /computes/i })).toBeVisible();
    await expect(page.getByText('local', { exact: true })).toBeVisible();
  });

  test('project list renders', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible();
  });

  test('workspace renders the topology canvas', async ({ page, request }) => {
    const cookieHeader = (await page.context().cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const response = await request.post('/rpc/projects/list', {
      headers: { cookie: cookieHeader },
      data: { json: { limit: 5, offset: 0, includeClosed: true } },
    });
    test.skip(!response.ok(), 'project list unavailable');
    const body = (await response.json()) as { json?: { id: string }[] };
    const project = body.json?.[0];
    test.skip(!project, 'no projects to open');
    await page.goto(`/projects/${project?.id}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main')).toContainText(/node|link|topology|project/i, {
      timeout: 20_000,
    });
  });

  test('templates and images pages render', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible();
    await expect(page.locator('main')).toContainText(/vpcs|qemu|switch|iou/i, { timeout: 15_000 });
    await page.goto('/images');
    await expect(page.getByRole('heading', { name: /images/i })).toBeVisible();
  });

  test('MCP rejects anonymous calls', async ({ request }) => {
    const response = await request.post('/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.status()).toBe(401);
  });
});
