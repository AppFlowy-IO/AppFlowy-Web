/**
 * Copy Image Test
 *
 * Tests copying image to clipboard when clicking copy button.
 * Migrated from: cypress/e2e/embeded/image/copy_image.cy.ts
 */
import { test, expect } from '@playwright/test';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createPageAndInsertImage } from '../../../support/page-utils';

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
      (window as any).__clipboardWriteCalled = false;
      (window as any).__clipboardWriteTypes = [];
      const originalWrite = navigator.clipboard?.write;
      if (navigator.clipboard) {
        navigator.clipboard.write = async (items: ClipboardItem[]) => {
          (window as any).__clipboardWriteCalled = true;
          items.forEach((item) => {
            (window as any).__clipboardWriteTypes.push(...item.types);
          });
        };
      }
    });

    // Create page and insert image
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover over the image block to show toolbar
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(1000);

    // Click the copy button
    const copyButton = page.getByTestId('copy-image-button');
    await expect(copyButton).toBeVisible();
    await copyButton.click({ force: true });
    await page.waitForTimeout(1000);

    // Verify clipboard write was called
    const clipboardWriteCalled = await page.evaluate(() => (window as any).__clipboardWriteCalled);
    expect(clipboardWriteCalled).toBeTruthy();
  });
});
