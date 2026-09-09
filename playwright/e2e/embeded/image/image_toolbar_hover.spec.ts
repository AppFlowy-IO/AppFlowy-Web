/**
 * Image Toolbar Hover E2E Tests
 *
 * Verifies that hovering over an image block shows the toolbar with all
 * action buttons (including Align) without crashing.
 *
 * Regression test for: Align component used useSelectionToolbarContext() which
 * threw when rendered outside SelectionToolbarContext.Provider (i.e., from ImageToolbar).
 *
 * Migrated from: cypress/e2e/embeded/image/image_toolbar_hover.cy.ts
 */
import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createPageAndInsertImage } from '../../../support/page-utils';

// Minimal valid 1x1 PNG buffer
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function createUploadedImageWithPointerOutside(page: Page) {
  await createPageAndInsertImage(page, PNG_BUFFER);
  const imageBlock = page.locator('[data-block-type="image"]').first();
  const image = imageBlock.locator('img');

  await expect(image).toBeVisible();
  await expect(imageBlock.getByTestId('image-upload-pending')).toBeHidden();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The upload menu can leave the pointer inside this block before it has a
  // remote URL. Start outside so hovering tests a real mouse-enter event.
  await EditorSelectors.firstEditor(page).hover({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('copy-image-button')).toBeHidden();

  return imageBlock;
}

test.describe('Image Toolbar Hover Actions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      // Fail the test if we see the specific context error we fixed
      if (err.message.includes('useSelectionToolbarContext must be used within')) {
        throw err;
      }

      // Suppress other transient errors
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should show toolbar with all actions when hovering over image (regression: Align outside SelectionToolbarContext)', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);
    const imageBlock = await createUploadedImageWithPointerOutside(page);

    // Hover over the image block to trigger toolbar
    await imageBlock.hover();

    // Verify toolbar actions are visible without errors
    await expect(page.getByTestId('copy-image-button')).toBeVisible();
    await expect(page.getByTestId('download-image-button')).toBeVisible();

    // The Align button should be rendered without crashing
    await expect(
      page.locator('[data-block-type="image"]').first().locator('.absolute.right-0.top-0')
    ).toBeAttached();
  });

  test('should show toolbar on hover and hide on mouse leave', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);
    const imageBlock = await createUploadedImageWithPointerOutside(page);

    // Hover to show toolbar
    await imageBlock.hover();
    await expect(page.getByTestId('copy-image-button')).toBeVisible();

    // Move mouse away to hide toolbar
    await EditorSelectors.firstEditor(page).hover({ position: { x: 5, y: 5 } });
    // Toolbar should be hidden
    await expect(page.getByTestId('copy-image-button')).not.toBeVisible();
  });

  test('should allow repeated hover/unhover cycles without errors', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);
    const imageBlock = await createUploadedImageWithPointerOutside(page);

    // Hover and unhover multiple times to ensure no stale state or context errors
    for (let i = 0; i < 3; i++) {
      await imageBlock.hover();
      await expect(page.getByTestId('copy-image-button')).toBeVisible();

      await EditorSelectors.firstEditor(page).hover({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('copy-image-button')).toBeHidden();
    }
  });
});
