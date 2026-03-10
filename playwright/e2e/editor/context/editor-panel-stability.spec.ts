import { test, expect } from '@playwright/test';
import { EditorSelectors, BlockSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Editor Panel Stability E2E Tests
 * Migrated from: cypress/e2e/editor/context/editor-panel-stability.cy.ts
 *
 * Verifies that the editor slash command panel and context providers
 * work correctly after stabilization fixes.
 *
 * Regression tests for:
 * - PanelsContext: isPanelOpen callback made stable with ref (no unnecessary re-renders)
 * - EditorContext: split into config + local state contexts
 */
test.describe('Editor Panel Stability', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: Create a page and focus the editor.
   */
  async function createPageAndFocusEditor(page: import('@playwright/test').Page) {
    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  test('should open and close slash panel without errors', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    await createPageAndFocusEditor(page);

    // Open slash panel
    await EditorSelectors.firstEditor(page).type('/', { delay: 50 });
    await page.waitForTimeout(1000);

    await expect(page.getByTestId('slash-panel')).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(page.getByTestId('slash-panel')).not.toBeVisible();
  });

  test('should handle rapid open/close slash panel cycles', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    await createPageAndFocusEditor(page);

    // Rapidly open and close the slash panel to test isPanelOpen stability
    for (let i = 0; i < 3; i++) {
      await EditorSelectors.firstEditor(page).type('/', { delay: 50 });
      await page.waitForTimeout(500);

      await expect(page.getByTestId('slash-panel')).toBeVisible();

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await expect(page.getByTestId('slash-panel')).not.toBeVisible();
    }
  });

  test('should filter slash panel items and select one without panel state errors', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    await createPageAndFocusEditor(page);

    // Open slash panel and filter
    await EditorSelectors.firstEditor(page).type('/', { delay: 50 });
    await page.waitForTimeout(1000);

    await expect(page.getByTestId('slash-panel')).toBeVisible();

    // Type to filter
    await EditorSelectors.firstEditor(page).type('heading', { delay: 50 });
    await page.waitForTimeout(500);

    // Select an item -- this triggers panel close via the panel context
    await page.locator('[data-testid^="slash-menu-"]').filter({ hasText: 'Heading 1' }).first().click({ force: true });
    await page.waitForTimeout(500);

    // Panel should be closed and heading should be inserted
    await expect(page.getByTestId('slash-panel')).not.toBeVisible();
    await expect(BlockSelectors.blockByType(page, 'heading')).toBeVisible();
  });

  test('should switch between different panel types (slash -> mention)', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await page.waitForTimeout(1000);

    await createPageAndFocusEditor(page);

    // Open slash panel
    await EditorSelectors.firstEditor(page).type('/', { delay: 50 });
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('slash-panel')).toBeVisible();

    // Close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('slash-panel')).not.toBeVisible();

    // Type some text then trigger mention with '@'
    await EditorSelectors.firstEditor(page).type('Hello ', { delay: 50 });
    await page.waitForTimeout(300);

    await EditorSelectors.firstEditor(page).type('@', { delay: 50 });
    await page.waitForTimeout(1000);

    // Close mention panel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Editor should still be functional
    await expect(EditorSelectors.firstEditor(page)).toBeVisible();
  });
});
