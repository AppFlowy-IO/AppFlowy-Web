/**
 * Cross-Tab Synchronization via BroadcastChannel Tests
 * Migrated from: cypress/e2e/page/cross-tab-sync.cy.ts
 *
 * Tests that sidebar updates sync across multiple tabs via BroadcastChannel.
 * Uses Playwright's BrowserContext for true multi-tab testing instead of
 * Cypress's iframe-based approach.
 */
import { test, expect, Page } from '@playwright/test';
import { PageSelectors, SidebarSelectors, ModalSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page-utils';

const SPACE_NAME = 'General';

test.describe('Cross-Tab Synchronization via BroadcastChannel', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('should sync sidebar when creating a view from second tab', async ({
    page: mainPage,
    request,
    context,
  }) => {
    const testEmail = generateRandomEmail();

    // Step 1: Sign in on main page
    await signInAndWaitForApp(mainPage, request, testEmail);
    await expect(PageSelectors.names(mainPage).first()).toBeVisible({ timeout: 60000 });
    await mainPage.waitForTimeout(2000);

    // Step 2: Expand the space in main window
    await expandSpaceByName(mainPage, SPACE_NAME);
    await mainPage.waitForTimeout(1000);

    // Step 3: Get initial page count
    const appUrl = mainPage.url();
    const initialPageCount = await PageSelectors.names(mainPage).count();

    // Step 4: Open a second tab with the same app URL
    const secondPage = await context.newPage();
    secondPage.on('pageerror', (err) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

    await secondPage.goto(appUrl, { waitUntil: 'load' });
    await secondPage.waitForTimeout(5000);

    // Wait for second tab to load
    await expect(PageSelectors.names(secondPage).first()).toBeVisible({ timeout: 60000 });
    await secondPage.waitForTimeout(2000);

    // Step 5: Expand space in second tab
    await expandSpaceByName(secondPage, SPACE_NAME);
    await secondPage.waitForTimeout(1000);

    // Step 6: Create a new document in second tab
    await secondPage.getByTestId('new-page-button').first().click({ force: true });
    await secondPage.waitForTimeout(1000);

    const newPageModal = secondPage.getByTestId('new-page-modal');
    if (await newPageModal.isVisible().catch(() => false)) {
      await newPageModal.getByTestId('space-item').filter({ hasText: SPACE_NAME }).click({ force: true });
      await secondPage.waitForTimeout(500);
      await newPageModal.locator('button').filter({ hasText: 'Add' }).click({ force: true });
      await secondPage.waitForTimeout(3000);
    }

    // Handle "Back to home" dialog if it appears
    const backToHome = secondPage.locator('button').filter({ hasText: 'Back to home' });
    if (await backToHome.isVisible().catch(() => false)) {
      await backToHome.first().click({ force: true });
      await secondPage.waitForTimeout(1000);
    }

    // Step 7: Verify main window's sidebar reflects the new document via BroadcastChannel
    await expandSpaceByName(mainPage, SPACE_NAME);
    await mainPage.waitForTimeout(1000);

    // Poll for page count increase
    await expect(async () => {
      const newCount = await PageSelectors.names(mainPage).count();
      expect(newCount).toBeGreaterThan(initialPageCount);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Verify "Untitled" page appears in main window
    await expect(PageSelectors.nameContaining(mainPage, 'Untitled').first()).toBeVisible({
      timeout: 30000,
    });

    // Step 8: Cleanup - close second tab
    await secondPage.close();
  });

  test('should sync sidebar when deleting a view from main window to second tab', async ({
    page: mainPage,
    request,
    context,
  }) => {
    const testEmail = generateRandomEmail();

    // Step 1: Sign in on main page
    await signInAndWaitForApp(mainPage, request, testEmail);
    await expect(PageSelectors.names(mainPage).first()).toBeVisible({ timeout: 60000 });
    await mainPage.waitForTimeout(2000);

    // Step 2: Expand the space
    await expandSpaceByName(mainPage, SPACE_NAME);
    await mainPage.waitForTimeout(1000);

    const appUrl = mainPage.url();

    // Step 3: Create a document in main window
    await mainPage.getByTestId('new-page-button').first().click({ force: true });
    await mainPage.waitForTimeout(1000);

    const newPageModal = mainPage.getByTestId('new-page-modal');
    if (await newPageModal.isVisible().catch(() => false)) {
      await newPageModal.getByTestId('space-item').filter({ hasText: SPACE_NAME }).click({ force: true });
      await mainPage.waitForTimeout(500);
      await newPageModal.locator('button').filter({ hasText: 'Add' }).click({ force: true });
      await mainPage.waitForTimeout(3000);
    }

    // Handle "Back to home" dialog
    const backToHome = mainPage.locator('button').filter({ hasText: 'Back to home' });
    if (await backToHome.isVisible().catch(() => false)) {
      await backToHome.first().click({ force: true });
      await mainPage.waitForTimeout(1000);
    }

    // Dismiss any remaining dialogs
    const dialog = mainPage.locator('.MuiDialog-root');
    if (await dialog.isVisible().catch(() => false)) {
      await mainPage.keyboard.press('Escape');
      await mainPage.waitForTimeout(500);
    }

    // Verify document was created
    await expect(PageSelectors.nameContaining(mainPage, 'Untitled').first()).toBeVisible({
      timeout: 30000,
    });

    // Step 4: Open second tab AFTER document is created
    const secondPage = await context.newPage();
    secondPage.on('pageerror', (err) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

    await secondPage.goto(appUrl, { waitUntil: 'load' });
    await secondPage.waitForTimeout(5000);

    await expect(PageSelectors.names(secondPage).first()).toBeVisible({ timeout: 60000 });
    await secondPage.waitForTimeout(2000);

    // Step 5: Expand space in second tab
    await expandSpaceByName(secondPage, SPACE_NAME);
    await secondPage.waitForTimeout(1000);

    // Verify "Untitled" appears in second tab
    await expect(
      secondPage.getByTestId('page-name').filter({ hasText: 'Untitled' }).first()
    ).toBeVisible({ timeout: 30000 });

    // Step 6: Delete the document from main window
    await mainPage
      .locator('[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("Untitled"))')
      .first()
      .hover({ force: true });
    await mainPage.waitForTimeout(500);

    await PageSelectors.moreActionsButton(mainPage, 'Untitled').click({ force: true });
    await mainPage.waitForTimeout(500);

    await mainPage.getByTestId('view-action-delete').click({ force: true });
    await mainPage.waitForTimeout(500);

    // Confirm deletion if dialog appears
    const confirmBtn = mainPage.getByTestId('confirm-delete-button');
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ force: true });
    }
    await mainPage.waitForTimeout(2000);

    // Step 7: Verify second tab reflects the deletion via BroadcastChannel
    await expect(async () => {
      const untitledCount = await secondPage
        .getByTestId('page-name')
        .filter({ hasText: 'Untitled' })
        .count();
      expect(untitledCount).toBe(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Cleanup
    await secondPage.close();
  });
});
