import { readFile } from 'node:fs/promises';

import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'
);

test('an image already under the pointer exposes its download after upload readiness changes', async ({ page, integrationsURL }, info) => {
  const errors: string[] = [];
  let uploadRequests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: { code: 0, data: { models: [] } } }));
  await page.route('**/image-hover-fixture*', (route) => route.fulfill({
    contentType: 'text/html', body: fixtureHTML('pdf'),
  }));
  await page.route('**/fixtures/hover-image.png', (route) => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route('**/fixtures/upload', async (route) => {
    uploadRequests++;
    await held;
    await route.fulfill({ json: { url: new URL('/fixtures/hover-image.png', page.url()).href } });
  });
  try {
    await page.goto(new URL('/image-hover-fixture?controlled-upload&image-hover', integrationsURL).href);
    const snapshot = page.getByTestId('pdf-document-snapshot');

    await expect(snapshot).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('/image');
    await page.getByTestId('slash-menu-image').click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'hover-image.png', mimeType: 'image/png', buffer: png });
    const block = page.locator('[data-block-type="image"]');
    const downloadButton = page.getByTestId('download-image-button');

    await expect.poll(() => uploadRequests).toBe(1);
    await expect(block.locator('img')).toBeVisible();
    await expect(page.getByTestId('image-upload-pending')).toBeVisible();
    // The same precondition as CI: the pointer enters the full-width block
    // before its URL exists, then moves from blank space onto the picture.
    await block.hover({ position: { x: 50, y: 30 } });
    await expect(downloadButton).toHaveCount(0);
    release();
    await expect(snapshot).toContainText('/fixtures/hover-image.png');
    await expect(page.getByTestId('image-upload-pending')).toHaveCount(0);
    await block.hover();
    try {
      await expect(downloadButton).toBeVisible({ timeout: 2_000 });
    } catch (error) {
      // Keep evidence of the old behavior: a real leave/re-entry recovers it.
      await page.mouse.move(0, 0);
      await block.hover();
      await info.attach('outside-reentry-diagnostic', {
        body: JSON.stringify({ toolbarCountAfterReentry: await downloadButton.count() }), contentType: 'application/json',
      });
      throw error;
    }

    const downloading = page.waitForEvent('download');

    await downloadButton.click();
    const download = await downloading;

    expect(download.suggestedFilename()).toBe('hover-image.png');
    expect(await readFile(await download.path())).toEqual(png);
    await expect(page.getByText('Image downloaded successfully', { exact: true })).toBeVisible();
    expect(uploadRequests).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
