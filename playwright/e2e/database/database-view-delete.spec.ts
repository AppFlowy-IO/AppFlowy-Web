/**
 * Database View Deletion Tests
 *
 * Tests for deleting database views:
 * - Deleting a non-last view via the tab context menu
 * - After deletion, another view becomes active
 * - The last view cannot be deleted (delete option disabled)
 *
 * Migrated from: cypress/e2e/database/database-view-delete.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseViewSelectors,
  PageSelectors,
  SpaceSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { expandSpaceByName, expandDatabaseInSidebar } from '../../support/page-utils';

test.describe('Database View Deletion', () => {
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

    const menuItem = page.getByRole('menuitem', { name: viewType });
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click({ force: true });
  }

  async function openTabMenuByLabel(page: import('@playwright/test').Page, label: string) {
    const tabSpan = page.locator('[data-testid^="view-tab-"] span').filter({ hasText: label });
    await expect(tabSpan).toBeVisible({ timeout: 10000 });
    await tabSpan.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
  }

  async function deleteViewByLabel(page: import('@playwright/test').Page, label: string) {
    await openTabMenuByLabel(page, label);
    await expect(DatabaseViewSelectors.tabActionDelete(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionDelete(page).click({ force: true });
    await page.waitForTimeout(500);

    await expect(DatabaseViewSelectors.deleteViewConfirmButton(page)).toBeVisible();
    await DatabaseViewSelectors.deleteViewConfirmButton(page).click({ force: true });
    await page.waitForTimeout(2000);
  }

  test('deletes a database view and switches to remaining view', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Add Board view
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toBeVisible({ timeout: 10000 });
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);

    // Delete the Board view
    await deleteViewByLabel(page, 'Board');

    // Verify Board tab is gone and only Grid remains
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toHaveCount(0);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Grid' })).toBeVisible();

    // Verify Grid is now the active tab
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Grid');
  });

  test('deletes the currently active view and falls back to another', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Add Board view (makes Board the active tab)
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Board');

    // Delete the active Board view
    await deleteViewByLabel(page, 'Board');

    // Verify Board is gone and Grid is now active
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toHaveCount(0);
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Grid');

    // Verify database still renders correctly
    await expect(page.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
  });

  test('deletes one view from three and remaining views persist', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Add Board and Calendar views
    await addViewViaButton(page, 'Board');
    await page.waitForTimeout(3000);

    await addViewViaButton(page, 'Calendar');
    await page.waitForTimeout(3000);

    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(3);

    // Delete the Board view
    await deleteViewByLabel(page, 'Board');

    // Verify only Grid and Calendar remain
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })).toHaveCount(0);
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Grid' })).toBeVisible();
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Calendar' })).toBeVisible();

    // Verify sidebar reflects the change
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);
    await expandDatabaseInSidebar(page, 'New Database');

    const dbItem = PageSelectors.itemByName(page, 'New Database');
    await expect(dbItem.locator(':text("Grid")')).toBeVisible();
    await expect(dbItem.locator(':text("Calendar")')).toBeVisible();
    await expect(dbItem.locator(':text("Board")')).toHaveCount(0);
  });

  test('does not allow deleting the last remaining view', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Verify only one tab exists
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);

    // Open context menu on the single Grid tab
    await openTabMenuByLabel(page, 'Grid');

    // Verify delete option is disabled
    const deleteAction = page.getByTestId('database-view-action-delete');
    await expect(deleteAction).toBeVisible();
    await expect(deleteAction).toHaveAttribute('data-disabled');
  });
});
