/**
 * Embedded Database - Slash Menu Creation Tests
 *
 * Tests linked database creation via slash menu.
 * Migrated from: cypress/e2e/embeded/database/linked-database-slash-menu.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  EditorSelectors,
  ModalSelectors,
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database - Slash Menu Creation', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should create linked database view via slash menu', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Create a source database to link to
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    const dbName = 'New Database';

    // Create a new document at same level as database
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Handle the new page modal if it appears
    const newPageModal = page.getByTestId('new-page-modal');
    if ((await newPageModal.count()) > 0) {
      await ModalSelectors.spaceItemInModal(page).first().click({ force: true });
      await page.waitForTimeout(500);
      await page.locator('button').filter({ hasText: 'Add' }).click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(3000);
    }

    // Wait for editor to be available
    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });

    // Open slash menu
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Select Linked Grid option
    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
    await page.waitForTimeout(1000);

    // Choose the existing database
    await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });

    // Wait for loading
    const loadingText = page.getByText('Loading...');
    if ((await loadingText.count()) > 0) {
      await expect(loadingText).not.toBeVisible({ timeout: 15000 });
    }

    // Select database from picker
    const popover = page.locator('.MuiPopover-paper').last();
    await expect(popover).toBeVisible();
    const searchInput = popover.locator('input[placeholder*="Search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.fill(dbName);
      await page.waitForTimeout(2000);
    }
    await popover.getByText(dbName, { exact: false }).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify linked database appears
    const startTime = Date.now();
    await expect(page.locator('[class*="appflowy-database"]').last()).toBeVisible({ timeout: 10000 });
    const elapsed = Date.now() - startTime;

    // Allow up to 30s for CI (includes initial load)
    expect(elapsed).toBeLessThan(30000);

    // Verify content is displayed
    await expect(
      page.locator('[class*="appflowy-database"]').last().locator('[data-testid="database-grid"]')
    ).toBeVisible();
  });
});
