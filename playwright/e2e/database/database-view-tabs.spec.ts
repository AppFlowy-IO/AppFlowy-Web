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
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  ModalSelectors,
  PageSelectors,
  SpaceSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, DatabaseViewType } from '../../support/database-ui-helpers';
import { expandSpaceByName, expandDatabaseInSidebar } from '../../support/page-utils';
import {
  getPrimaryFieldId,
  typeTextIntoCell,
  TextFilterCondition,
  assertRowCount,
} from '../../support/filter-test-helpers';
import { waitForDatabaseDocReady, injectFilterViaYjs } from '../../support/yjs-inject-helpers';

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

  async function createGridAndWait(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testEmail: string
  ) {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', {
      verify: async (p) => {
        await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
        await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({ timeout: 10000 });
      },
    });
  }

  async function addViewViaButton(page: import('@playwright/test').Page, viewType: 'Grid' | 'Board' | 'Calendar') {
    const addBtn = DatabaseViewSelectors.addViewButton(page);
    await addBtn.scrollIntoViewIfNeeded();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(500);

    // DropdownMenu renders with data-slot="dropdown-menu-content"
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    const menuItem = menu.locator('[role="menuitem"]').filter({ hasText: viewType }).first();
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click({ force: true });
  }

  async function openTabMenuByLabel(page: import('@playwright/test').Page, label: string) {
    const tabSpan = page.locator('[data-testid^="view-tab-"] span').filter({ hasText: label });
    await expect(tabSpan).toBeVisible({ timeout: 10000 });
    await tabSpan.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
  }

  async function saveRenameDialog(page: import('@playwright/test').Page) {
    const saveButton = ModalSelectors.renameSaveButton(page);

    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();
    await expect(ModalSelectors.renameInput(page)).toBeHidden({ timeout: 10000 });
  }

  async function renameViewByLabel(page: import('@playwright/test').Page, currentLabel: string, nextLabel: string) {
    await openTabMenuByLabel(page, currentLabel);
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill(nextLabel);
    await saveRenameDialog(page);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: nextLabel })).toBeVisible({
      timeout: 10000,
    });
  }

  async function getTabViewIds(page: import('@playwright/test').Page) {
    return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
      tabs
        .map((tab) => tab.getAttribute('data-testid') || '')
        .filter(Boolean)
        .map((testId) => testId.replace('view-tab-', ''))
    );
  }

  async function expectGridSettled(page: import('@playwright/test').Page) {
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });
    await expect(DatabaseGridSelectors.grid(page).locator('[role="status"]')).toHaveCount(0, { timeout: 15000 });
  }

  test('creates multiple views that appear immediately in tab bar and sidebar', async ({ page, request }) => {
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
    await saveRenameDialog(page);

    // Then: the tab displays the new name "MyGrid"
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyGrid' })).toBeVisible({
      timeout: 10000,
    });

    // And: adding a Board view and renaming it to "MyBoard"
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(2000);

    await openTabMenuByLabel(page, 'Board');
    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill('MyBoard');
    await saveRenameDialog(page);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'MyBoard' })).toBeVisible({
      timeout: 10000,
    });

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

  test('filtered database child grid tabs stay selectable without sidebar page icons', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    let firstGridViewId = '';
    let secondGridViewId = '';

    await test.step('Given a database container with a filtered first grid view and another Grid child view', async () => {
      await createGridAndWait(page, request, testEmail);

      await renameViewByLabel(page, 'Grid', 'Launch Review Log');

      const primaryFieldId = await getPrimaryFieldId(page);
      await typeTextIntoCell(page, primaryFieldId, 0, 'not started');
      await waitForDatabaseDocReady(page);
      await injectFilterViaYjs(page, {
        fieldId: primaryFieldId,
        condition: TextFilterCondition.TextIsNotEmpty,
        content: '',
        fieldType: 0,
      });
      await expect(DatabaseFilterSelectors.filterCondition(page)).toBeVisible({ timeout: 10000 });
      await assertRowCount(page, 1);
      await expectGridSettled(page);

      await addViewViaButton(page, 'Grid');
      await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2, { timeout: 10000 });

      const viewIds = await getTabViewIds(page);
      expect(viewIds).toHaveLength(2);
      [firstGridViewId, secondGridViewId] = viewIds;

      await expect(DatabaseViewSelectors.viewTab(page, firstGridViewId)).toContainText('Launch Review Log');
      await expect(DatabaseViewSelectors.viewTab(page, secondGridViewId)).toContainText('Grid');

      await expandSpaceByName(page, spaceName);
      await expandDatabaseInSidebar(page);
    });

    await test.step('Then database child views in the sidebar use bullets instead of page icons', async () => {
      const firstChild = PageSelectors.pageByViewId(page, firstGridViewId);
      const secondChild = PageSelectors.pageByViewId(page, secondGridViewId);

      await expect(firstChild).toBeVisible({ timeout: 10000 });
      await expect(secondChild).toBeVisible({ timeout: 10000 });
      await expect(firstChild.locator('[data-testid="page-icon"]')).toHaveCount(0);
      await expect(secondChild.locator('[data-testid="page-icon"]')).toHaveCount(0);
    });

    await test.step('When switching from the filtered first tab to the sibling Grid tab', async () => {
      await DatabaseViewSelectors.viewTab(page, firstGridViewId).click({ force: true });
      await expect(DatabaseViewSelectors.viewTab(page, firstGridViewId)).toHaveAttribute('data-state', 'active');
      await expectGridSettled(page);

      await DatabaseViewSelectors.viewTab(page, secondGridViewId).click({ force: true });
    });

    await test.step('Then the Grid tab becomes active, updates sidebar selection, and leaves no loading indicator behind', async () => {
      await expect(DatabaseViewSelectors.viewTab(page, secondGridViewId)).toHaveAttribute('data-state', 'active', {
        timeout: 10000,
      });
      await expect.poll(() => new URL(page.url()).searchParams.get('v'), { timeout: 10000 }).toBe(secondGridViewId);
      await expect(PageSelectors.pageByViewId(page, secondGridViewId)).toHaveAttribute('data-selected', 'true', {
        timeout: 10000,
      });
      await expectGridSettled(page);
    });
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
