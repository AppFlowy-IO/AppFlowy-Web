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
    } else {
      // No toggle means no children — which is also correct (no embedded views leaked)
      expect(await dbExpandToggle.count()).toBe(0);
    }

    // Step 11: Create a SECOND view in the embedded database (using + button)
    // Navigate back to the document page first
    // The document was just created and is named "Untitled" by default
    await page.getByTestId('page-name').filter({ hasText: 'Untitled' }).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Find the embedded database container
    const embeddedDB = page.locator('[class*="appflowy-database"]').last();
    await expect(embeddedDB).toBeVisible({ timeout: 10000 });

    // Click the + button to add a new view
    await embeddedDB.getByTestId('add-view-button').scrollIntoViewIfNeeded();
    await embeddedDB.getByTestId('add-view-button').click({ force: true });
    await page.waitForTimeout(500);

    // Select Board view type from dropdown
    const viewMenu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(viewMenu).toBeVisible({ timeout: 5000 });
    await viewMenu.locator('[role="menuitem"]').filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(3000);

    // Step 12: Verify second view was created (now 2 tabs in the embedded database)
    const embeddedDBFresh = page.locator('[class*="appflowy-database"]').last();
    const viewTabs = embeddedDBFresh.locator('[data-testid^="view-tab-"]');
    await expect(viewTabs).toHaveCount(2, { timeout: 10000 });

    // Step 13: Navigate to the original standalone database
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(500);

    // Verify original database still has no "View of" children
    const standaloneDbAfter = PageSelectors.itemByName(page, dbName);
    const dbToggleAfter = standaloneDbAfter.locator(
      '[data-testid="outline-toggle-expand"], [data-testid="outline-toggle-collapse"]'
    );
    const hasToggleAfter = (await dbToggleAfter.count()) > 0;
    if (hasToggleAfter) {
      await dbToggleAfter.first().click({ force: true });
      await page.waitForTimeout(500);
      const childNamesAfter = await standaloneDbAfter.getByTestId('page-name').allInnerTexts();
      const hasViewOfAfter = childNamesAfter.some((n) => n.trim().startsWith('View of'));
      expect(hasViewOfAfter).toBeFalsy();
    }

    // Click on the standalone database to navigate to it
    await PageSelectors.nameContaining(page, dbName).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Step 14: Create a new view directly in the standalone database
    const standaloneDBView = page.locator('[class*="appflowy-database"]').first();
    await expect(standaloneDBView).toBeVisible({ timeout: 10000 });

    await standaloneDBView.getByTestId('add-view-button').scrollIntoViewIfNeeded();
    await standaloneDBView.getByTestId('add-view-button').click({ force: true });
    await page.waitForTimeout(500);

    // Select Board view type from dropdown
    const standaloneViewMenu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(standaloneViewMenu).toBeVisible({ timeout: 5000 });
    await standaloneViewMenu.locator('[role="menuitem"]').filter({ hasText: 'Board' }).click({ force: true });
    await page.waitForTimeout(3000);

    // Step 15: Verify tab count in standalone database (at least 2: original Grid + new Board)
    const standaloneDBFresh = page.locator('[class*="appflowy-database"]').first();
    const standaloneTabs = standaloneDBFresh.locator('[data-testid^="view-tab-"]');
    await expect(standaloneTabs).toHaveCount(2, { timeout: 10000 });

    // Step 16: Verify the standalone database tabs don't include "linked" views from the embedded database
    const standaloneTabTexts = await standaloneTabs.allInnerTexts();
    const hasLinkedViewOfTab = standaloneTabTexts.some((t) => t.trim().startsWith('View of'));
    expect(hasLinkedViewOfTab).toBeFalsy();
  });
});
