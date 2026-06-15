import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  PageSelectors,
  SidebarSelectors,
  SpaceSelectors,
  TrashSelectors,
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
 * Sidebar Context Stability E2E Tests
 *
 * Verifies that sidebar outline operations (expand/collapse, favorites,
 * recent views) work correctly after the AppOutlineContext split.
 *
 * Migrated from: cypress/e2e/app/sidebar-context-stability.cy.ts
 */
test.describe('Sidebar Context Stability', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }

      throw err; // Fail on unknown uncaught exceptions (matches Cypress default)
    });
  });

  test('should handle rapid space expand/collapse without outline context errors', async ({
    page,
    request,
  }) => {
    const outlineErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text().toLowerCase();
        if (text.includes('outline') || text.includes('loadviewchildren')) {
          outlineErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the first space element for expand/collapse
    const spaceEl = page.locator('[data-testid^="space-"][data-expanded]:visible').first();
    await expect(spaceEl).toBeVisible({ timeout: 30000 });
    const spaceTestId = await spaceEl.getAttribute('data-testid');
    const selector = `[data-testid="${spaceTestId}"]`;
    const spaceLocator = page.locator(selector);

    // Rapidly toggle expand/collapse 4 times
    for (let i = 0; i < 4; i++) {
      await spaceLocator.click({ force: true });
      await page.waitForTimeout(300);
    }

    // Final expand to verify tree is visible
    const expanded = await spaceLocator.getAttribute('data-expanded');
    if (expanded !== 'true') {
      await spaceLocator.click({ force: true });
    }

    await page.waitForTimeout(2000);

    // Pages should be visible in the expanded space
    await expect(PageSelectors.items(page).first()).toBeVisible();

    // Verify no React errors in console
    expect(outlineErrors.length).toBe(0);
  });

  test('should maintain page list during page creation and deletion', async ({
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

    // Count initial pages
    const initialCount = await PageSelectors.items(page).count();

    // Create a new page
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await clickAddPageMenuItem(page); // Create Doc
    await page.waitForTimeout(3000);

    // Dismiss dialog if present (Document pages open in a modal)
    await dismissDialogIfPresent(page);

    // Page count should have increased
    const afterCount = await PageSelectors.items(page).count();
    expect(afterCount).toBeGreaterThan(initialCount);

    // Sidebar should still be fully functional
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(SpaceSelectors.items(page).first()).toBeVisible();
  });

  test('should handle sidebar interactions during page navigation', async ({
    page,
    request,
  }) => {
    const contextErrors: string[] = [];
    // Match Cypress filter: first 2 conditions check ANY captured type,
    // 3rd condition ('context') checks error type only.
    page.on('console', (msg) => {
      if (!CYPRESS_CAPTURED_TYPES.has(msg.type())) return;
      const text = msg.text().toLowerCase();
      if (
        text.includes('cannot read properties of null') ||
        text.includes('is not a function') ||
        (text.includes('context') && msg.type() === 'error')
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

    // Navigate to first page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // While a page is loading, interact with sidebar (expand another space if exists)
    const spaceCount = await SpaceSelectors.items(page).count();
    if (spaceCount > 1) {
      await SpaceSelectors.items(page).nth(1).click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Navigate to a different page rapidly
    const pageItemCount = await PageSelectors.items(page).count();
    if (pageItemCount > 1) {
      await PageSelectors.items(page).nth(1).click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Navigate again
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify app is stable
    await expect(page).toHaveURL(/\/app\//);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();

    // Check for context-related console errors
    expect(contextErrors.length).toBe(0);
  });

  test('should open trash page and navigate back without context loss', async ({
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

    // Navigate to a page first
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/app\//);

    // Open trash page (exercises useAppTrash hook)
    await expect(TrashSelectors.sidebarTrashButton(page)).toBeVisible();
    await TrashSelectors.sidebarTrashButton(page).click({ force: true });
    await page.waitForTimeout(2000);

    // Trash page should be visible
    await expect(page).toHaveURL(/\/trash/);

    // Navigate back to a page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify app is stable after trash -> page navigation
    await expect(page).toHaveURL(/\/app\//);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();
  });

  test('should handle concurrent sidebar and page creation operations', async ({
    page,
    request,
  }) => {
    const errorLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text().toLowerCase();
        if (
          !text.includes('websocket') &&
          !text.includes('failed to load models') &&
          !text.includes('billing')
        ) {
          errorLogs.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Create two pages rapidly to stress the AppOperationsContext.addPage callback
    for (let i = 0; i < 2; i++) {
      await PageSelectors.items(page).first().hover({ force: true });
      await page.waitForTimeout(500);

      await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
      await clickAddPageMenuItem(page);
      await page.waitForTimeout(2000);

      // Dismiss dialog (Document pages open in a modal)
      await dismissDialogIfPresent(page);
    }

    // Immediately navigate back to first page
    await PageSelectors.items(page).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify all operations completed without context errors
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    const finalCount = await PageSelectors.items(page).count();
    expect(finalCount).toBeGreaterThanOrEqual(3); // original + 2 new pages

    if (errorLogs.length > 0) {
      console.log(`Found ${errorLogs.length} error logs (checking for context errors)`);
      errorLogs.forEach((log) => {
        console.log(`Error: ${log.substring(0, 200)}`);
      });
    }
  });
});
