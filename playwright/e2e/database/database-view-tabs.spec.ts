/**
 * Database View Tabs Tests
 *
 * Tests for database view tab functionality:
 * - Creating multiple views and immediate appearance
 * - Renaming views
 * - Tab selection updates sidebar selection
 * - Breadcrumb reflects active tab
 *
 * Migrated from: cypress/e2e/database/database-view-tabs.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  BreadcrumbSelectors,
  DatabaseViewSelectors,
  ModalSelectors,
  PageSelectors,
  SpaceSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, DatabaseViewType } from '../../support/database-ui-helpers';
import { expandSpaceByName, expandDatabaseInSidebar } from '../../support/page-utils';

test.describe('Database View Tabs', () => {
  const spaceName = 'General';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  async function createGridAndWait(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, testEmail: string) {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', {
      verify: async (p) => {
        await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
        await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({ timeout: 10000 });
      },
    });
  }

  async function addViewViaButton(page: import('@playwright/test').Page, viewType: 'Board' | 'Calendar') {
    await DatabaseViewSelectors.addViewButton(page).scrollIntoViewIfNeeded();
    await DatabaseViewSelectors.addViewButton(page).click({ force: true });
    await page.waitForTimeout(300);

    const menuItem = page.locator('[role="menu"], [role="menuitem"]').filter({ hasText: viewType });
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click({ force: true });
  }

  async function openTabMenuByLabel(page: import('@playwright/test').Page, label: string) {
    const tabSpan = page.locator('[data-testid^="view-tab-"] span').filter({ hasText: label });
    await expect(tabSpan).toBeVisible({ timeout: 10000 });
    await tabSpan.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
  }

  test('creates multiple views that appear immediately in tab bar and sidebar', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    const initialTabCount = await DatabaseViewSelectors.viewTab(page).count();

    // Add Board view - verify IMMEDIATE appearance (within 1s)
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(200);
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 1, { timeout: 1000 });

    // Wait for stability after outline reload
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toBeVisible({ timeout: 5000 });

    // Add Calendar view - verify IMMEDIATE appearance
    await addViewViaButton(page, 'Calendar');
    await page.waitForTimeout(3000);
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 2, { timeout: 5000 });

    // Verify sidebar shows all views
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);

    const dbItem = PageSelectors.itemByName(page, 'New Database');
    await expect(dbItem.locator(':text("Grid")')).toBeVisible();
    await expect(dbItem.locator(':text("Board")')).toBeVisible();
    await expect(dbItem.locator(':text("Calendar")')).toBeVisible();

    // Verify tab bar matches
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' })).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Calendar' })).toBeVisible();

    // Navigate away and back to verify persistence
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(2000);

    await expandSpaceByName(page, spaceName);
    await PageSelectors.nameContaining(page, 'New Database').first().click({ force: true });
    await page.waitForTimeout(3000);

    // Verify all tabs persist
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 2);
  });

  test('renames views correctly', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Rename Grid -> MyGrid
    await openTabMenuByLabel(page, 'Grid');
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill('MyGrid');
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyGrid' })).toBeVisible({ timeout: 10000 });

    // Add Board view
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(2000);

    // Rename Board -> MyBoard
    await openTabMenuByLabel(page, 'Board');
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill('MyBoard');
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyBoard' })).toBeVisible({ timeout: 10000 });

    // Verify both renamed tabs exist
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyGrid' })).toBeVisible();
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyBoard' })).toBeVisible();
  });

  test('tab selection updates sidebar selection', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Add Board view
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);

    // Expand database in sidebar
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);

    // Click on Grid tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify Grid is selected in sidebar
    const dbItem = PageSelectors.itemByName(page, 'New Database');
    await expect(dbItem.locator('[data-selected="true"]')).toContainText('Grid');

    // Click on Board tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify Board is selected in sidebar
    await expect(dbItem.locator('[data-selected="true"]')).toContainText('Board');
  });

  test('breadcrumb shows active database tab view', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Add Board view
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);

    // Expand database in sidebar so children populate the outline tree
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);
    await page.waitForTimeout(2000);

    // Switch to Board tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(1000);
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board');

    // Verify breadcrumb shows Board as the active view
    const breadcrumbItems = BreadcrumbSelectors.items(page);
    await expect(breadcrumbItems.first()).toBeVisible({ timeout: 15000 });
    await expect(breadcrumbItems.last()).toContainText('Board');
    await expect(breadcrumbItems.last()).not.toContainText('Grid');
  });
});
