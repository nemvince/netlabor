import { expect, test } from '@playwright/test';
import { cookieHeader, gotoWorkspace, loadLinks, resolveProject } from './helpers.ts';

test.describe('capture', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get('/healthz').catch(() => null);
    test.skip(!health?.ok(), 'controller is not reachable at the configured base URL');
  });

  test('opens the capture panel for a link', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    const links = await loadLinks(page, project.id);
    const link = links[0];
    test.skip(!link, 'the project has no links to capture');
    if (!link) return;

    await gotoWorkspace(page, project.id);
    const edge = page.locator(`[data-testid="rf__edge-${link.id}"]`);
    if ((await edge.count()) === 0) {
      test.skip(true, `link ${link.id.slice(0, 8)} is not rendered on the canvas`);
      return;
    }
    // The visible edge path is thin; dispatch the click React listens for.
    await edge.first().dispatchEvent('click');

    const dialog = page.getByRole('dialog', { name: /^Link / });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const start = dialog.getByRole('button', { name: 'Start capture' });
    const stop = dialog.getByRole('button', { name: 'Stop capture' });
    await expect(start.or(stop).first()).toBeVisible();
    await expect(dialog.getByText('Capture', { exact: true })).toBeVisible();

    const download = dialog.getByRole('link', { name: 'Download pcap' });
    if ((await download.count()) > 0) {
      await expect(download).toHaveAttribute('href', `/api/links/${link.id}/capture.pcap`);
    } else {
      await expect(dialog.getByText('no capture', { exact: true })).toBeVisible();
    }
  });

  test('downloads the pcap when a capture file exists', async ({ page }) => {
    const project = await resolveProject(page);
    test.skip(!project, 'no visible project to open');
    if (!project) return;

    const links = await loadLinks(page, project.id);
    const captured = links.find((link) => link.capture !== null);
    test.skip(!captured, 'no link has a pcap yet');
    if (!captured) return;

    const response = await page.request.get(`/api/links/${captured.id}/capture.pcap`, {
      headers: { cookie: await cookieHeader(page) },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/pcap|octet-stream/i);
  });
});
