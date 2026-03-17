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
    const addBtn = DatabaseViewSelectors.addViewButton(page);
    await addBtn.scrollIntoViewIfNeeded();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(500);

    // DropdownMenu renders with data-slot="dropdown-menu-content"
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    const menuItem = menu.locator('[role="menuitem"]').filter({ hasText: viewType });
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
    // Given: a database grid view is created
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    const initialTabCount = await DatabaseViewSelectors.viewTab(page).count();
    // Guard: database should have at least 1 tab (the default Grid view)
    expect(initialTabCount).toBeGreaterThan(0);

    // When: adding a Board view
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(1000);

    // Then: the tab count increases by one and the Board tab is visible
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 1, { timeout: 5000 });

    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toBeVisible({ timeout: 5000 });

    // And: adding a Calendar view increases the tab count again
    await addViewViaButton(page, 'Calendar');
    await page.waitForTimeout(3000);
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 2, { timeout: 5000 });

    // And: the sidebar shows all three views (Grid, Board, Calendar)
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);

    const dbItem = PageSelectors.itemByName(page, 'New Database');
    await expect(dbItem.locator(':text("Grid")')).toBeVisible();
    await expect(dbItem.locator(':text("Board")')).toBeVisible();
    await expect(dbItem.locator(':text("Calendar")')).toBeVisible();

    // And: the tab bar shows all three views
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' })).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Calendar' })).toBeVisible();

    // When: navigating away and back to the database
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(2000);

    await expandSpaceByName(page, spaceName);
    await PageSelectors.nameContaining(page, 'New Database').first().click({ force: true });
    await page.waitForTimeout(3000);

    // Then: all tabs persist after navigation
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(initialTabCount + 2);
  });

  test('renames views correctly', async ({ page, request }) => {
    // Given: a database grid view is created
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // When: renaming the Grid tab to "MyGrid"
    await openTabMenuByLabel(page, 'Grid');
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill('MyGrid');
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(1000);

    // Then: the tab displays the new name "MyGrid"
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyGrid' })).toBeVisible({ timeout: 10000 });

    // And: adding a Board view and renaming it to "MyBoard"
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(2000);

    await openTabMenuByLabel(page, 'Board');
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill('MyBoard');
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyBoard' })).toBeVisible({ timeout: 10000 });

    // Then: both renamed tabs "MyGrid" and "MyBoard" are visible
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyGrid' })).toBeVisible();
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyBoard' })).toBeVisible();
  });

  test('tab selection updates sidebar selection', async ({ page, request }) => {
    // Given: a database with Grid and Board views, sidebar expanded
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);

    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);

    // When: clicking on the Grid tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Then: Grid is marked as selected in the sidebar
    const dbItem = PageSelectors.itemByName(page, 'New Database');
    await expect(dbItem.locator('[data-selected="true"]').filter({ hasText: 'Grid' })).toBeVisible();

    // When: clicking on the Board tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Then: Board is marked as selected in the sidebar
    await expect(dbItem.locator('[data-selected="true"]').filter({ hasText: 'Board' })).toBeVisible();
  });

  test('breadcrumb shows active database tab view', async ({ page, request }) => {
    // Given: a database with Grid and Board views, sidebar expanded
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);

    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page);
    await page.waitForTimeout(2000);

    // When: switching to the Board tab
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(1000);
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board');

    // Then: the breadcrumb shows "Board" as the active view
    const breadcrumbItems = BreadcrumbSelectors.items(page);
    await expect(breadcrumbItems.first()).toBeVisible({ timeout: 15000 });
    await expect(breadcrumbItems.last()).toContainText('Board');
    // And: the breadcrumb does not show "Grid"
    await expect(breadcrumbItems.last()).not.toContainText('Grid');
  });
});
