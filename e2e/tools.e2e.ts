import { expect, test } from '@playwright/test';

test.describe('network tools', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('splits a subnet and plans VLSM allocations', async ({ page }) => {
    await page.goto('/tools');
    await expect(page.getByRole('heading', { name: 'Network tools' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Subnet splitter' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('table', { name: 'Split subnets' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Split subnets' })).toContainText('10.0.0.0/24');

    await page.getByRole('tab', { name: 'VLSM planner' }).click();
    const allocations = page.getByRole('table', { name: 'VLSM allocations' });
    await expect(allocations).toBeVisible();
    await expect(allocations).toContainText('LAN');
    await expect(allocations).toContainText('10.0.0.0/25');
    await expect(allocations).toContainText('10.0.0.192/30');

    await page.getByRole('tab', { name: 'IP calculator' }).click();
    await expect(page.getByLabel('Address / prefix')).toHaveValue('192.168.10.42/24');
    await expect(page.getByText('192.168.10.0/24')).toBeVisible();

    await page.getByRole('tab', { name: 'Overlap check' }).click();
    await expect(page.getByText('A contains B')).toBeVisible();
  });
});
