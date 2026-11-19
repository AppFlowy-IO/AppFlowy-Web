/**
 * Download Image Test
 *
 * Tests downloading image when clicking download button.
 * Migrated from: cypress/e2e/embeded/image/download_image.cy.ts
 */
import { readFile } from 'node:fs/promises';

import { test, expect } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createPageAndInsertImage } from '../../../support/page-utils';
import { generateRandomEmail } from '../../../support/test-config';

// Minimal valid 1x1 PNG buffer
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Download Image Test', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should download image when clicking download button', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    // Create page and insert image
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover over the image block to show toolbar
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(1000);

    await page
      .locator('[data-block-type="image"]')
      .first()
      .getByRole('button', { name: 'Image options', exact: true })
      .click();
    const downloading = page.waitForEvent('download');

    await page.getByTestId('image-menu').getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toBe('test-image.png');
    expect(await readFile(await download.path())).toEqual(PNG_BUFFER);
  });
});
