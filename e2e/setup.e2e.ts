import { expect, test } from '@playwright/test';

test.describe('setup', () => {
  // The wizard and the login page only matter to a visitor without a session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('the wizard stands aside once accounts exist', async ({ page }) => {
    const response = await page.request
      .post('/rpc/auth/setup/status', { data: { json: {} } })
      .catch(() => null);
    const body = response?.ok()
      ? ((await response.json()) as { json?: { needsSetup?: boolean } })
      : null;
    test.skip(body?.json?.needsSetup === true, 'this controller still needs its first account');

    await page.goto('/setup');
    await expect(page).not.toHaveURL(/\/setup/, { timeout: 15_000 });
  });

  test('the login page offers the wizard only on a fresh controller', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/this controller has no accounts yet/i)).toHaveCount(0);
  });
});
