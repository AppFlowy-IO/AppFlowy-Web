/**
 * Database Conditions - Filters and Sorts UI Tests
 *
 * Tests the DatabaseConditions UI for filters and sorts in embedded databases.
 * Migrated from: cypress/e2e/embeded/database/database-conditions.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import {
  createDocumentPageAndNavigate,
  insertLinkedDatabaseViaSlash,
} from '../../../support/page-utils';

test.describe('Database Conditions - Filters and Sorts UI', () => {
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

  /** Helper to create a database, a document, and insert a linked database into it. */
  async function setupEmbeddedDatabase(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext
  ) {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Create source database
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    const dbName = 'New Database';

    // Add sample data
    await DatabaseGridSelectors.cells(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type('Sample Data 1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Create document and insert linked database
    const docViewId = await createDocumentPageAndNavigate(page);
    await insertLinkedDatabaseViaSlash(page, docViewId, dbName);
    await page.waitForTimeout(1000);

    // Close any extra dialog
    const dialogs = page.locator('[role="dialog"]');
    if ((await dialogs.count()) > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Verify embedded database exists
    const embeddedDB = page.locator('[class*="appflowy-database"]').last();
    await expect(embeddedDB).toBeVisible({ timeout: 15000 });
    await expect(embeddedDB.locator('[data-testid="database-grid"]')).toBeVisible();

    return embeddedDB;
  }

  test('should have 0px height when DatabaseConditions is collapsed (no filters/sorts)', async ({
    page,
    request,
  }) => {
    const embeddedDB = await setupEmbeddedDatabase(page, request);
    await page.waitForTimeout(2000);

    // Check gap between tabs and grid (should be minimal)
    const gap = await embeddedDB.evaluate((el) => {
      const tabsContainer = el.querySelector('[data-testid^="view-tab-"]')?.parentElement?.parentElement;
      const grid = el.querySelector('[data-testid="database-grid"]');
      if (!tabsContainer || !grid) return -1;
      const tabsBottom = tabsContainer.getBoundingClientRect().bottom;
      const gridTop = grid.getBoundingClientRect().top;
      return gridTop - tabsBottom;
    });

    // Verify elements were found (gap !== -1) and gap is minimal
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(10);

    // Verify no filter/sort conditions visible
    await expect(DatabaseFilterSelectors.filterCondition(page)).not.toBeAttached();
    await expect(DatabaseFilterSelectors.sortCondition(page)).not.toBeAttached();
  });

  test('should expand when filters are added and collapse when removed', async ({
    page,
    request,
  }) => {
    const embeddedDB = await setupEmbeddedDatabase(page, request);
    await page.waitForTimeout(2000);

    // Add filter
    await embeddedDB.locator('[data-testid="database-actions-filter"]').click({ force: true });
    await page.waitForTimeout(500);

    // Select field from dropdown
    const popoverContent = page.locator('[data-slot="popover-content"]');
    await expect(popoverContent).toBeVisible({ timeout: 10000 });
    await popoverContent.locator('[data-item-id]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Verify filter condition appears
    await expect(
      page.locator('[class*="appflowy-database"]').last().getByTestId('database-filter-condition')
    ).toBeVisible();

    // Remove filter: click the filter condition chip
    await page.locator('[class*="appflowy-database"]').last().getByTestId('database-filter-condition').first().click({ force: true });
    await page.waitForTimeout(500);

    // Click more options
    await page.locator('[data-slot="popover-content"]').getByTestId('filter-more-options-button').click({ force: true });
    await page.waitForTimeout(300);

    // Click delete filter
    await DatabaseFilterSelectors.deleteFilterButton(page).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify filter is removed
    await expect(
      page.locator('[class*="appflowy-database"]').last().getByTestId('database-filter-condition')
    ).not.toBeAttached();
  });
});
