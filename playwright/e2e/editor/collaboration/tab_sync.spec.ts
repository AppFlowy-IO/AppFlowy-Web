import { test, expect, type Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page/flows';

async function flushPendingSync(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const flush = (window as typeof window & { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> })
            .__TEST_FLUSH_ALL_SYNC__;

          return flush ? flush() : false;
        }),
      {
        message: 'the tab should flush its collaboration updates',
        timeout: 30000,
        intervals: [250, 500, 1000],
      }
    )
    .toBe(true);
}

/**
 * Editor Tab Synchronization Tests
 * Migrated from: cypress/e2e/editor/collaboration/tab_sync.cy.ts
 *
 * Playwright can exercise two real top-level pages in the same browser
 * context. That matches the BroadcastChannel and sync-leader behavior used by
 * actual tabs more closely than the iframe used by the original Cypress test.
 */
test.describe('Editor Tab Synchronization', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should sync changes between two tabs', async ({ page, request, context }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    // Create a fresh document page to avoid existing content issues
    await createDocumentPageAndNavigate(page);

    // A second page in the same context shares the signed-in browser storage,
    // just like opening the current document in another tab.
    const testPageUrl = page.url();
    const secondPage = await context.newPage();

    secondPage.on('pageerror', () => {
      // Suppress all uncaught exceptions, matching the primary page setup.
    });
    await secondPage.goto(testPageUrl, { waitUntil: 'domcontentloaded' });

    const mainEditor = EditorSelectors.slateEditor(page).first();
    const secondEditor = EditorSelectors.slateEditor(secondPage).first();

    await expect(mainEditor).toBeVisible({ timeout: 30000 });
    await expect(secondEditor).toBeVisible({ timeout: 30000 });

    // 1. Type in Main Window
    await mainEditor.click({ position: { x: 5, y: 5 }, force: true });
    await mainEditor.pressSequentially('Hello from Main');
    await flushPendingSync(page);

    // 2. Verify in the second tab
    await expect(secondEditor).toContainText('Hello from Main', { timeout: 30000 });

    // 3. Type in the second tab
    await secondEditor.click({ force: true });
    await secondEditor.pressSequentially(' and Second Tab');
    await flushPendingSync(secondPage);

    // 4. Verify in Main Window
    await expect(mainEditor).toContainText('Hello from Main and Second Tab', { timeout: 30000 });

    await secondPage.close();
  });
});
