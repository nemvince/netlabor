import { expect, type Locator, type Page, test } from '@playwright/test';
import { gotoWorkspace, resolveProject } from './helpers.ts';

/** Open a persisted panel through the project View menu when hidden. */
async function ensurePanelVisible(page: Page, menuLabel: string, panel: Locator): Promise<void> {
  if (await panel.isVisible()) return;
  await page.getByTitle('Panel visibility').click();
  await page.getByRole('menuitem', { name: menuLabel }).click();
  await expect(panel).toBeVisible();
}

test.describe('workspace', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('renders the palette, canvas, inspector, and status bar', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    await gotoWorkspace(page, project.id);

    const palette = page.getByRole('complementary', { name: 'Device palette' });
    await ensurePanelVisible(page, 'Palette', palette);
    await expect(palette.getByRole('textbox', { name: 'Search templates' })).toBeVisible();
    await expect(palette).toContainText(/Drag one onto the canvas/);

    await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible();

    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await ensurePanelVisible(page, 'Inspector', inspector);
    await expect(inspector.getByText('Inspector', { exact: true })).toBeVisible();

    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/controller reachable|contacting controller|degraded/);
    for (const label of ['events', 'selected', 'nodes', 'links', 'drawings', 'zoom', 'computes']) {
      await expect(footer.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('selecting a canvas node opens its properties', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    await gotoWorkspace(page, project.id);
    const deviceNodes = page.locator('.react-flow__node-device');
    const nodeCount = await deviceNodes.count();
    test.skip(nodeCount === 0, 'the project has no device nodes to select');

    await expect(deviceNodes.first()).toBeVisible();
    await deviceNodes.first().click({ position: { x: 24, y: 10 } });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Properties' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(inspector.getByRole('tab', { name: 'Ports' })).toBeVisible();
    await expect(inspector.getByLabel('Name', { exact: true })).toBeVisible();
  });

  test('toggles the minimap from the canvas toolbar', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    await gotoWorkspace(page, project.id);
    const display = page.getByTitle('Canvas display options');
    await expect(display).toBeVisible();
    await display.click();
    const minimap = page.getByRole('menuitemcheckbox', { name: 'Minimap' });

    // The visibility preference is persisted, so normalise it before toggling.
    if ((await minimap.getAttribute('aria-checked')) !== 'true') await minimap.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.react-flow__minimap')).toBeVisible();

    await display.click();
    await minimap.click();
    await expect(minimap).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);

    await minimap.click();
    await expect(minimap).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('filters the palette by device name', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    await gotoWorkspace(page, project.id);
    const palette = page.getByRole('complementary', { name: 'Device palette' });
    await ensurePanelVisible(page, 'Palette', palette);
    const search = palette.getByRole('textbox', { name: 'Search templates' });
    await expect(search).toBeVisible();
    await search.fill(`zz-no-such-device-${Date.now()}`);
    await expect(palette.getByText('No template matches the search.')).toBeVisible();
    await search.fill('');
    await expect(palette.getByText(/templates\. Drag one onto the canvas\./)).toBeVisible();
  });
});
