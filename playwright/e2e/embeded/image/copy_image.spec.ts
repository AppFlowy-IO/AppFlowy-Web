/**
 * Copy Image Test
 *
 * Tests copying image to clipboard when clicking copy button.
 * Migrated from: cypress/e2e/embeded/image/copy_image.cy.ts
 */
import { test, expect } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createPageAndInsertImage } from '../../../support/page-utils';
import { generateRandomEmail } from '../../../support/test-config';

type ClipboardTestWindow = typeof window & {
  __clipboardWriteCalled: boolean;
  __clipboardWriteTypes: string[];
};

// Minimal valid 1x1 PNG buffer
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Copy Image Test', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should copy image to clipboard when clicking copy button', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    // Stub clipboard.write to capture calls
    await page.evaluate(() => {
      (window as ClipboardTestWindow).__clipboardWriteCalled = false;
      (window as ClipboardTestWindow).__clipboardWriteTypes = [];
      if (navigator.clipboard) {
        navigator.clipboard.write = async (items: ClipboardItem[]) => {
          for (const item of items) {
            await item.getType('image/png');
            (window as ClipboardTestWindow).__clipboardWriteTypes.push(...item.types);
          }

          (window as ClipboardTestWindow).__clipboardWriteCalled = true;
        };
      }
    });

    // Create page and insert image
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover over the image block to show toolbar
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(1000);

    // Click the copy button
    const copyButton = page
      .locator('[data-block-type="image"]')
      .first()
      .getByRole('button', { name: 'Copy image', exact: true });

    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByText('Copied to clipboard', { exact: true })).toBeVisible();

    // Verify clipboard write was called
    const clipboardWriteCalled = await page.evaluate(() => (window as ClipboardTestWindow).__clipboardWriteCalled);

    expect(clipboardWriteCalled).toBeTruthy();

    // Verify the clipboard write included image/png MIME type
    const clipboardWriteTypes = await page.evaluate(() => (window as ClipboardTestWindow).__clipboardWriteTypes);

    expect(clipboardWriteTypes).toContain('image/png');
  });
});
