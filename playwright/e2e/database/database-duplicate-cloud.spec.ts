/**
 * Cloud Database Duplication Tests
 *
 * Tests that duplicating a database creates an independent copy:
 * - Row counts match
 * - Edits in duplicate don't affect original
 * - Row document content is independent
 *
 * Migrated from: cypress/e2e/database/database-duplicate-cloud.cy.ts
 *
 * NOTE: This test uses a specific pre-existing user (export_user@appflowy.io)
 * with password-based login and requires the "Database 1" under
 * General > Getting started to exist.
 */
import { test, expect } from '@playwright/test';
import {
  AuthSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  ViewActionSelectors,
} from '../../support/selectors';
import { expandSpaceByName } from '../../support/page-utils';

const _exportUserEmail = 'export_user@appflowy.io';
const _exportUserPassword = 'AppFlowy!@123';
const _testDatabaseName = 'Database 1';
const _spaceName = 'General';
const _gettingStartedPageName = 'Getting started';

test.describe('Cloud Database Duplication', () => {
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

  test('should duplicate Database 1 and verify data independence', async ({ page }) => {
    // Step 1: Visit login page
    await page.goto('/login', { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // Step 2: Enter email
    await expect(AuthSelectors.emailInput(page)).toBeVisible({ timeout: 30000 });
    await AuthSelectors.emailInput(page).fill(_exportUserEmail);
    await page.waitForTimeout(500);

    // Step 3: Click "Sign in with password" button
    await expect(AuthSelectors.passwordSignInButton(page)).toBeVisible();
    await AuthSelectors.passwordSignInButton(page).click();
    await page.waitForTimeout(1000);

    // Step 4: Verify we're on the password page
    await expect(page).toHaveURL(/action=enterPassword/);

    // Step 5: Enter password
    await expect(AuthSelectors.passwordInput(page)).toBeVisible();
    await AuthSelectors.passwordInput(page).fill(_exportUserPassword);
    await page.waitForTimeout(500);

    // Step 6: Submit password
    await AuthSelectors.passwordSubmitButton(page).click();

    // Step 7: Wait for successful login
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(5000);

    // Step 8: Wait for data sync
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(5000);

    // Step 9: Clean up existing duplicate databases
    const copySuffix = ' (Copy)';
    const duplicatePrefix = `${_testDatabaseName}${copySuffix}`;

    const existingDuplicates = page.getByTestId('page-name').filter({ hasText: duplicatePrefix });
    const dupeCount = await existingDuplicates.count();
    for (let i = 0; i < dupeCount; i++) {
      const pageName = (await existingDuplicates.first().innerText()).trim();
      if (pageName.startsWith(duplicatePrefix)) {
        await PageSelectors.moreActionsButton(page, pageName).click({ force: true });
        await page.waitForTimeout(500);
        await ViewActionSelectors.deleteButton(page).click({ force: true });
        await page.waitForTimeout(500);
        const confirmBtn = page.getByTestId('confirm-delete-button');
        if ((await confirmBtn.count()) > 0) {
          await confirmBtn.click({ force: true });
        }
        await page.waitForTimeout(1000);
      }
    }

    // Step 10: Expand General space and navigate to Database 1
    await expandSpaceByName(page, _spaceName);
    await page.waitForTimeout(1000);

    // Expand Getting started
    const gettingStartedItem = PageSelectors.itemByName(page, _gettingStartedPageName);
    const expandToggle = gettingStartedItem.locator('[data-testid="outline-toggle-expand"]');
    if ((await expandToggle.count()) > 0) {
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Wait for Database 1 to appear and click it
    await expect(PageSelectors.nameContaining(page, _testDatabaseName).first()).toBeVisible({ timeout: 30000 });
    await PageSelectors.nameContaining(page, _testDatabaseName).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Step 11: Wait for database grid to load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 12: Count original rows
    const originalRowCount = await DatabaseGridSelectors.dataRows(page).count();
    expect(originalRowCount).toBeGreaterThan(0);

    // Step 13: Duplicate the database
    await PageSelectors.moreActionsButton(page, _testDatabaseName).click({ force: true });
    await page.waitForTimeout(500);
    await ViewActionSelectors.duplicateButton(page).click({ force: true });
    await page.waitForTimeout(3000);

    // Step 14: Wait for duplicate to appear in sidebar
    await expect(PageSelectors.nameContaining(page, duplicatePrefix).first()).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(2000);

    // Step 15: Open the duplicated database
    await PageSelectors.nameContaining(page, duplicatePrefix).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Step 16: Wait for duplicated database grid to load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 17: Verify duplicated row count matches original
    const duplicatedRowCount = await DatabaseGridSelectors.dataRows(page).count();
    expect(duplicatedRowCount).toBe(originalRowCount);

    // Step 18: Edit a cell in the duplicated database
    const marker = `db-duplicate-marker-${Date.now()}`;
    await DatabaseGridSelectors.cells(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(marker);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify marker was added
    await expect(DatabaseGridSelectors.cells(page).first()).toContainText(marker);

    // Step 19: Navigate back to original database
    await expandSpaceByName(page, _spaceName);
    await page.waitForTimeout(500);

    // Re-expand Getting started if needed
    const gsItem = PageSelectors.itemByName(page, _gettingStartedPageName);
    const gsExpand = gsItem.locator('[data-testid="outline-toggle-expand"]');
    if ((await gsExpand.count()) > 0) {
      await gsExpand.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Find original Database 1 (not the copy)
    const dbPages = PageSelectors.nameContaining(page, _testDatabaseName);
    const dbCount = await dbPages.count();
    for (let i = 0; i < dbCount; i++) {
      const text = (await dbPages.nth(i).innerText()).trim();
      if (!text.includes('(Copy)')) {
        await dbPages.nth(i).click({ force: true });
        break;
      }
    }
    await page.waitForTimeout(3000);

    // Step 20: Wait for original database grid to load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 21: Verify the marker is NOT in the original database
    const allCellTexts = await DatabaseGridSelectors.cells(page).allInnerTexts();
    const markerFound = allCellTexts.some((text) => text.includes(marker));
    expect(markerFound).toBeFalsy();

    // Step 22: Cleanup - delete the duplicated database
    const dupePageName = await PageSelectors.nameContaining(page, duplicatePrefix).first().innerText();
    await PageSelectors.moreActionsButton(page, dupePageName.trim()).click({ force: true });
    await page.waitForTimeout(500);
    await ViewActionSelectors.deleteButton(page).click({ force: true });
    await page.waitForTimeout(500);
    const confirmDelete = page.getByTestId('confirm-delete-button');
    if ((await confirmDelete.count()) > 0) {
      await confirmDelete.click({ force: true });
    }
  });
});
