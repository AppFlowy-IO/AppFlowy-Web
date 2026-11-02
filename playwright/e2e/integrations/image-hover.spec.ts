import { readFile } from 'node:fs/promises';

import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

for (const stillInside of [true, false]) {
  test(`image toolbar follows the pointer across upload completion (still inside: ${stillInside})`, async ({
    page,
    integrationsURL,
  }) => {
    const errors: string[] = [];
    let uploadRequests = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/ai/*/model/list', (route) => route.fulfill({ json: { code: 0, data: { models: [] } } }));
    await page.route('**/image-hover-fixture*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: fixtureHTML('pdf'),
      })
    );
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
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: 'hover-image.png', mimeType: 'image/png', buffer: png });
      const block = page.locator('[data-block-type="image"]');
      const toolbar = block.locator('.image-toolbar');

      await expect.poll(() => uploadRequests).toBe(1);
      await expect(block.locator('img')).toBeVisible();
      await expect(page.getByTestId('image-upload-pending')).toBeVisible();
      // Keep the pointer inside before the server URL arrives. CSS hover must
      // expose the controls when readiness changes without a leave/re-entry.
      await block.hover({ position: { x: 50, y: 30 } });
      if (!stillInside) await page.mouse.move(0, 0);
      release();
      await expect(snapshot).toContainText('/fixtures/hover-image.png');
      await expect(page.getByTestId('image-upload-pending')).toHaveCount(0);
      await expect(toolbar).toHaveCSS('opacity', stillInside ? '1' : '0');
      if (!stillInside) await block.hover();
      await expect(toolbar).toHaveCSS('opacity', '1');
      await block.getByRole('button', { name: 'Image options', exact: true }).click();

      const downloading = page.waitForEvent('download');

      await page.getByTestId('image-menu').getByRole('button', { name: 'Download', exact: true }).click();
      const download = await downloading;

      expect(download.suggestedFilename()).toBe('hover-image.png');
      expect(await readFile(await download.path())).toEqual(png);
      expect(uploadRequests).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}
