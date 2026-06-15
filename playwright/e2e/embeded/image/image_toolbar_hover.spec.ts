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
import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createPageAndInsertImage } from '../../../support/page-utils';

// Minimal valid 1x1 PNG buffer
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

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
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover over the image block to trigger toolbar
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(1000);

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
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover to show toolbar
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('copy-image-button')).toBeVisible();

    // Move mouse away to hide toolbar
    await EditorSelectors.firstEditor(page).hover({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(1000);

    // Toolbar should be hidden
    await expect(page.getByTestId('copy-image-button')).not.toBeVisible();
  });

  test('should allow repeated hover/unhover cycles without errors', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);
    await createPageAndInsertImage(page, PNG_BUFFER);

    // Hover and unhover multiple times to ensure no stale state or context errors
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-block-type="image"]').first().hover();
      await page.waitForTimeout(500);
      await expect(page.getByTestId('copy-image-button')).toBeVisible();

      await EditorSelectors.firstEditor(page).hover({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(500);
    }
  });
});
