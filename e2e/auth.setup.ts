import { expect, test as setup } from '@playwright/test';

const username = process.env.NB_E2E_USER ?? process.env.NB_ADMIN_USER ?? 'admin';
const password =
  process.env.NB_E2E_PASSWORD ?? process.env.NB_ADMIN_PASSWORD ?? 'admin-password-1234';

setup('authenticate', async ({ page }) => {
  const health = await page.request.get('/healthz').catch(() => null);
  setup.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/projects|\/$/);
  await page.context().storageState({ path: 'e2e/.auth/state.json' });
});
