import { expect, type Locator, type Page, test } from '@playwright/test';
import { gotoWorkspace, resolveProject } from './helpers.ts';

/** Open a persisted panel when a previous run left it hidden. */
async function ensurePanelVisible(page: Page, showTitle: string, panel: Locator): Promise<void> {
  if (await panel.isVisible()) return;
  const show = page.getByTitle(showTitle);
  if ((await show.count()) > 0) await show.first().click();
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
    await ensurePanelVisible(page, 'Show palette', palette);
    await expect(palette.getByRole('textbox', { name: 'Search templates' })).toBeVisible();
    await expect(palette).toContainText(/Drag one onto the canvas/);

    await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible();

    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await ensurePanelVisible(page, 'Show inspector', inspector);
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
    const toggle = page.getByRole('button', { name: 'Toggle minimap' });
    await expect(toggle).toBeVisible();

    // The visibility preference is persisted, so normalise it before toggling.
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
    }
    await expect(page.locator('.react-flow__minimap')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
  });

  test('filters the palette by device name', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    await gotoWorkspace(page, project.id);
    const palette = page.getByRole('complementary', { name: 'Device palette' });
    await ensurePanelVisible(page, 'Show palette', palette);
    const search = palette.getByRole('textbox', { name: 'Search templates' });
    await expect(search).toBeVisible();
    await search.fill(`zz-no-such-device-${Date.now()}`);
    await expect(palette.getByText('No template matches the search.')).toBeVisible();
    await search.fill('');
    await expect(palette.getByText(/templates\. Drag one onto the canvas\./)).toBeVisible();
  });
});
