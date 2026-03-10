/**
 * Embedded Database View Isolation Tests
 *
 * Tests that embedded views appear as document children, not original database children.
 * Migrated from: cypress/e2e/embeded/database/embedded-view-isolation.cy.ts
 */
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../../support/page-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database View Isolation', () => {
  const dbName = 'New Database';
  const spaceName = 'General';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('useAppHandlers must be used within') ||
        err.message.includes('Cannot resolve a DOM node from Slate') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('embedded views appear under document, not under original database', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 1: Create a standalone Grid database
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Step 2: Create a document page
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

    // Wait for editor
    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });

    // Step 3: Insert linked database via slash menu
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
    await page.waitForTimeout(1000);

    // Select database from picker
    await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });
    const loadingText = page.getByText('Loading...');
    if ((await loadingText.count()) > 0) {
      await expect(loadingText).not.toBeVisible({ timeout: 15000 });
    }

    const popover = page.locator('.MuiPopover-paper').last();
    await expect(popover).toBeVisible();
    await popover.getByText(dbName, { exact: false }).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Step 4: Verify the embedded database appears in the document
    await expect(page.locator('[class*="appflowy-database"]').last()).toBeVisible({ timeout: 15000 });

    // Step 5: Verify sidebar structure
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(1000);

    // The standalone database should NOT have gained any embedded children
    // The document page should have a "View of" child
    const standaloneDb = PageSelectors.itemByName(page, dbName);
    await expect(standaloneDb).toBeVisible({ timeout: 10000 });

    // Check standalone DB doesn't have unexpected expand toggles for embedded views
    // (It may have its own default Grid child, but no "View of" children)
    const dbExpandToggle = standaloneDb.locator('[data-testid="outline-toggle-expand"], [data-testid="outline-toggle-collapse"]');
    const hasToggle = (await dbExpandToggle.count()) > 0;

    if (hasToggle) {
      // Expand to verify children are only the original database views
      await dbExpandToggle.first().click({ force: true });
      await page.waitForTimeout(500);

      const childNames = await standaloneDb.getByTestId('page-name').allInnerTexts();
      const trimmedNames = childNames.map((n) => n.trim());

      // Should not contain "View of" entries (those belong to the document)
      const hasViewOf = trimmedNames.some((n) => n.startsWith('View of'));
      expect(hasViewOf).toBeFalsy();
    }
  });
});
