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

test.describe('templates', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('shows the catalog with a preview pane', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Device templates' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Symbols' })).toBeVisible();
    await expect(page.getByPlaceholder('Search templates')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Catalog preview' })).toBeVisible();
  });

  test('searches templates and previews a selected one', async ({ page }) => {
    const templates = await loadTemplates(page);
    test.skip(templates.length === 0, 'no device templates are available');

    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();

    const search = page.getByPlaceholder('Search templates');
    await expect(search).toBeVisible();

    const template = templates[0];
    if (!template) {
      test.skip(true, 'no device templates are available');
      return;
    }

    await search.fill(template.name);
    await selectTemplateRow(page, template.name);
    const preview = page.getByRole('complementary', { name: 'Catalog preview' });
    await expect(preview).toContainText(template.name);
    await expect(preview).toContainText('Required images');
    await expect(preview).toContainText('Name format');

    await search.fill(`zz-no-such-template-${Date.now()}`);
    await expect(page.getByText('No template matches', { exact: true })).toBeVisible();

    await search.fill('');
    await expect(
      page.getByRole('button', { name: new RegExp(escapeRegExp(template.name)) }).first(),
    ).toBeVisible();
  });

  test('selecting a template updates the detail pane', async ({ page }) => {
    const templates = await loadTemplates(page);
    test.skip(templates.length < 2, 'fewer than two templates to switch between');

    await page.goto('/templates');
    const first = templates[0];
    const second = templates[1];
    if (!first || !second) {
      test.skip(true, 'fewer than two templates to switch between');
      return;
    }

    const preview = page.getByRole('complementary', { name: 'Catalog preview' });
    await selectTemplateRow(page, first.name);
    await expect(preview).toContainText(first.name);
    await expect(preview).toContainText(first.nodeType);

    await selectTemplateRow(page, second.name);
    await expect(preview).toContainText(second.name);
    await expect(preview).toContainText(second.nodeType);
  });

  test('opens the symbols section', async ({ page }) => {
    await page.goto('/templates');
    await page.getByRole('tab', { name: 'Symbols' }).click();
    await expect(page.getByRole('tab', { name: 'Symbols' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByPlaceholder('Search symbols')).toBeVisible();
    await expect(page.getByText(/\d+ of \d+/, { exact: false }).first()).toBeVisible();
  });
});
