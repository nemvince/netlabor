import { expect, type Page, test } from '@playwright/test';
import { escapeRegExp, loadTemplates } from './helpers.ts';

/** Click the catalog row whose visible name is exactly `name`. */
async function selectTemplateRow(page: Page, name: string): Promise<void> {
  const row = page
    .locator('li')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
  await row.getByRole('button').first().click();
}

test.describe('library', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('opens on the device templates section', async ({ page }) => {
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Device templates' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Appliances' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Image library' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Symbols' })).toBeVisible();
    await expect(page.getByPlaceholder('Search templates')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Template details' })).toBeVisible();
  });

  test('searches templates and previews a selected one', async ({ page }) => {
    const templates = await loadTemplates(page);
    test.skip(templates.length === 0, 'no device templates are available');
    const template = templates[0];
    if (!template) {
      test.skip(true, 'no device templates are available');
      return;
    }

    await page.goto('/library');
    const search = page.getByPlaceholder('Search templates');
    await expect(search).toBeVisible();

    await search.fill(template.name);
    await selectTemplateRow(page, template.name);
    const preview = page.getByRole('complementary', { name: 'Template details' });
    await expect(preview).toContainText(template.name);
    await expect(preview).toContainText('Image coverage');
    await expect(preview).toContainText('Name format');

    await search.fill(`zz-no-such-template-${Date.now()}`);
    await expect(page.getByText('No template matches', { exact: true })).toBeVisible();

    await search.fill('');
    await expect(
      page.getByRole('button', { name: new RegExp(escapeRegExp(template.name)) }).first(),
    ).toBeVisible();
  });

  test('switching sections keeps the tab deep-linkable', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('tab', { name: 'Symbols' }).click();
    await expect(page).toHaveURL(/tab=symbols/);
    await expect(page.getByRole('tab', { name: 'Symbols' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByPlaceholder('Search symbols')).toBeVisible();

    await page.getByRole('tab', { name: 'Appliances' }).click();
    await expect(page).toHaveURL(/tab=appliances/);
    await expect(page.getByRole('heading', { name: 'OS image repository' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Appliance builds' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Appliances' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('deep-links into the image library', async ({ page }) => {
    await page.goto('/library?tab=images');
    await expect(page.getByRole('tab', { name: 'Image library' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByPlaceholder('Search images')).toBeVisible();
  });
});
