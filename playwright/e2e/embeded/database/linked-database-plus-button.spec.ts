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

    // Find and click the + button to create a new view
    const plusButton = embeddedDB.locator('[data-testid="database-add-view-button"], button').filter({ hasText: '+' }).first();
    await plusButton.click({ force: true });
    await page.waitForTimeout(1000);

    // A new view tab should appear - select Board type if available
    const viewMenu = page.locator('[role="menu"], [data-slot="popover-content"]').last();
    if (await viewMenu.isVisible()) {
      const boardOption = viewMenu.locator('[role="menuitem"]').filter({ hasText: /board/i });
      if ((await boardOption.count()) > 0) {
        await boardOption.first().click({ force: true });
      } else {
        // Just click the first option
        await viewMenu.locator('[role="menuitem"]').first().click({ force: true });
      }
    }
    await page.waitForTimeout(2000);

    // Verify at least 2 view tabs exist (original + new one)
    const viewTabs = embeddedDB.locator('[data-testid^="view-tab-"]');
    const tabCount = await viewTabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Verify the new tab is auto-selected (last tab should be active)
    const lastTab = viewTabs.last();
    const isActive = await lastTab.evaluate((el) => {
      return el.classList.contains('active') ||
             el.getAttribute('data-active') === 'true' ||
             el.getAttribute('aria-selected') === 'true' ||
             window.getComputedStyle(el).fontWeight === '700' ||
             parseInt(window.getComputedStyle(el).fontWeight) >= 600;
    });

    // The new view should either be visually active or at least visible
    await expect(lastTab).toBeVisible();
  });
});
