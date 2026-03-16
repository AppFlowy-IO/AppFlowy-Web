/**
 * Embedded Database - Plus Button View Creation Tests
 *
 * Tests plus button view creation, auto-selection, and scroll into view.
 * Migrated from: cypress/e2e/embeded/database/linked-database-plus-button.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database - Plus Button View Creation', () => {
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

  /** Helper to create a document with an embedded linked database */
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

    // Create document
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Handle new page modal
    const newPageModal = page.getByTestId('new-page-modal');
    if ((await newPageModal.count()) > 0) {
      await ModalSelectors.spaceItemInModal(page).first().click({ force: true });
      await page.waitForTimeout(500);
      await page.locator('button').filter({ hasText: 'Add' }).click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(3000);
    }

    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });

    // Insert linked database via slash menu
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
    await page.waitForTimeout(1000);

    // Select database
    await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });
    const loadingText = page.getByText('Loading...');
    if ((await loadingText.count()) > 0) {
      await expect(loadingText).not.toBeVisible({ timeout: 15000 });
    }

    const popover = page.locator('.MuiPopover-paper').last();
    await expect(popover).toBeVisible();
    await popover.getByText(dbName, { exact: false }).first().click({ force: true });
    await page.waitForTimeout(3000);

    return page.locator('[class*="appflowy-database"]').last();
  }

  test('should create new view using + button and auto-select it', async ({ page, request }) => {
    const embeddedDB = await setupEmbeddedDatabase(page, request);
    await expect(embeddedDB).toBeVisible({ timeout: 15000 });

    // Verify we start with 1 tab
    const viewTabs = embeddedDB.locator('[data-testid^="view-tab-"]');
    await expect(viewTabs).toHaveCount(1, { timeout: 10000 });

    // The embedded database may be inside a MUI Dialog (ViewModal).
    // Close the dialog first so that Radix dropdown portals render above everything.
    const dialog = page.locator('[role="dialog"]');
    if (await dialog.isVisible().catch(() => false)) {
      // Click the "expand" button to open the page as a full page instead
      const expandBtn = dialog.locator('button').first();
      if (await expandBtn.isVisible().catch(() => false)) {
        await expandBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    // Re-locate embedded database after potential navigation
    const embeddedDBFresh = page.locator('[class*="appflowy-database"]').last();
    await expect(embeddedDBFresh).toBeVisible({ timeout: 15000 });
    const viewTabsFresh = embeddedDBFresh.locator('[data-testid^="view-tab-"]');
    await expect(viewTabsFresh).toHaveCount(1, { timeout: 10000 });

    // Click the + button to create a new view
    const plusButton = embeddedDBFresh.locator('[data-testid="add-view-button"]');
    await plusButton.scrollIntoViewIfNeeded();
    await plusButton.click({ force: true });
    await page.waitForTimeout(500);

    // Wait for the dropdown menu to appear (Radix DropdownMenu)
    const dropdownMenu = page.locator('[data-slot="dropdown-menu-content"]').last();
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });

    // Click "Board" menu item - use evaluate to bypass potential z-index issues
    const boardOption = dropdownMenu.locator('[role="menuitem"]').filter({ hasText: /board/i });
    await expect(boardOption.first()).toBeVisible({ timeout: 3000 });
    await boardOption.first().click();

    // Wait for dropdown to close (confirms click processed)
    await expect(dropdownMenu).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Wait for the new view tab to appear
    await expect(viewTabsFresh).toHaveCount(2, { timeout: 15000 });

    // Verify the new tab is visible and auto-selected
    const lastTab = viewTabsFresh.last();
    await expect(lastTab).toBeVisible();
    await expect(lastTab).toHaveAttribute('data-state', 'active', { timeout: 5000 });
  });
});
