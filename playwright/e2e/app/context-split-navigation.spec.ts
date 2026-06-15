import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';
import {
  CYPRESS_CAPTURED_TYPES,
  clickAddPageMenuItem,
  dismissDialogIfPresent,
} from '../../support/test-helpers';

/**
 * App Context Split Navigation Stability E2E Tests
 *
 * Verifies that the 5-way context split (Navigation, Operations, Outline,
 * Sync, Auth) works correctly during rapid cross-view-type navigation.
 *
 * Migrated from: cypress/e2e/app/context-split-navigation.cy.ts
 */
test.describe('Context Split Navigation Stability', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      // Fail on context-related errors that indicate broken context split
      if (
        err.message.includes('Cannot read properties of null') &&
        err.message.includes('useContext')
      ) {
        throw err; // Let it fail -- context not provided
      }

      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }

      throw err; // Fail on unknown uncaught exceptions (matches Cypress default)
    });
  });

  test('should navigate between document and grid views without context errors', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Navigate to the default document page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify document editor loaded
    await expect(page).toHaveURL(/\/app\//);

    // Create a Grid view
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await clickAddPageMenuItem(page, 'Grid');
    await page.waitForTimeout(3000);

    // Verify grid loaded
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    // Navigate back to the document by clicking the first page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Document should load without context errors
    await expect(page).toHaveURL(/\/app\//);

    // Verify sidebar is still functional (AppOutlineContext not broken)
    await expect(PageSelectors.items(page).first()).toBeVisible();
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  });

  test('should handle rapid navigation between multiple pages without stale context', async ({
    page,
    request,
  }) => {
    const contextErrors: string[] = [];
    page.on('console', (msg) => {
      if (!CYPRESS_CAPTURED_TYPES.has(msg.type())) return;
      const text = msg.text().toLowerCase();
      if (
        (text.includes('context') && text.includes('null')) ||
        text.includes('react will try to recreate') ||
        text.includes('error boundary')
      ) {
        contextErrors.push(msg.text());
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Create multiple pages by clicking add button rapidly
    for (let i = 0; i < 3; i++) {
      await PageSelectors.items(page).first().hover({ force: true });
      await page.waitForTimeout(500);

      await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
      await clickAddPageMenuItem(page); // Create Doc
      await page.waitForTimeout(2000);

      // Dismiss any modal that appears (Document pages open in a modal)
      await dismissDialogIfPresent(page);
    }

    // Now rapidly navigate between pages
    const items = PageSelectors.items(page);
    const itemCount = await items.count();
    const navigateCount = Math.min(itemCount, 4);

    for (let i = 0; i < navigateCount; i++) {
      await items.nth(i).click({ force: true });
      await page.waitForTimeout(500); // Brief wait -- tests rapid context updates
    }

    // After rapid navigation, app should still be stable
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/app\//);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();

    // Verify no React error boundaries triggered
    expect(contextErrors.length).toBe(0);
  });

  test('should maintain sidebar outline state during view type switches', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Count initial sidebar items
    const initialItemCount = await PageSelectors.items(page).count();

    // Navigate to default document page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Create a Grid view (switches AppNavigationContext.viewId)
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await clickAddPageMenuItem(page, 'Grid');
    await page.waitForTimeout(5000);

    // Verify sidebar still shows items (AppOutlineContext not re-rendered to empty)
    await expect(PageSelectors.items(page).first()).toBeVisible();
    const itemCountAfterSwitch = await PageSelectors.items(page).count();
    // Should have at least the same number of items (may have more from Grid creation)
    expect(itemCountAfterSwitch).toBeGreaterThanOrEqual(initialItemCount);

    // Navigate back to document
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Sidebar should still be fully functional
    await expect(PageSelectors.items(page).first()).toBeVisible();
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  });

  test('should handle creating and immediately navigating away from AI chat', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Create an AI chat
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
    await AddPageSelectors.addAIChatButton(page).click();
    await page.waitForTimeout(1000);

    // Immediately navigate away before chat fully initializes
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // App should still be stable
    await expect(page).toHaveURL(/\/app\//);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();

    // Create a Grid immediately after
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await clickAddPageMenuItem(page, 'Grid');
    await page.waitForTimeout(5000);

    // Grid should load cleanly after the aborted chat
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });
  });
});
