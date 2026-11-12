/**
 * First-run project: claims the admin account through the setup wizard when
 * the controller has no users yet, then hands over to `auth.setup.ts`.
 */

import { expect, test as setup } from '@playwright/test';

const username = (process.env.NB_E2E_USER ?? process.env.NB_ADMIN_USER ?? 'admin').toLowerCase();
const password =
  process.env.NB_E2E_PASSWORD ?? process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';

setup('claim the first administrator account', async ({ page }) => {
  const health = await page.request.get('/healthz').catch(() => null);
  setup.skip(!health?.ok(), 'controller is not reachable at the configured base URL');

  const response = await page.request
    .post('/rpc/auth/setup/status', { data: { json: {} } })
    .catch(() => null);
  const body = response?.ok()
    ? ((await response.json()) as { json?: { needsSetup?: boolean } })
    : null;
  setup.skip(body?.json?.needsSetup !== true, 'controller already has accounts');

  await page.goto('/setup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create admin account' }).click();

  await expect(page.getByText('setup · 2 of 4')).toBeVisible({ timeout: 15_000 });
});
