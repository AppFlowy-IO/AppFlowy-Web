/**
 * Database Container - Embedded Create/Delete Tests
 *
 * Tests embedded database container creation and deletion.
 * Migrated from: cypress/e2e/embeded/database/database-container-embedded-create-delete.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  BlockSelectors,
  PageSelectors,
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import {
  expandSpaceByName,
  ensurePageExpandedByViewId,
  createDocumentPageAndNavigate,
} from '../../../support/page-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Database Container - Embedded Create/Delete', () => {
  const dbName = 'New Database';
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

  test('creates an embedded database container and removes it when the block is deleted', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1) Create a document page
    const docViewId = await createDocumentPageAndNavigate(page);

    // 2) Insert an embedded Grid database via slash menu
    const editor = page.locator(`#editor-${docViewId}`);
    await expect(editor).toBeVisible();
    await editor.click({ position: { x: 200, y: 100 }, force: true });
    await editor.pressSequentially('/', { delay: 50 });
    await page.waitForTimeout(500);

    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });

    // Close any extra dialog that isn't the document editor
    await page.waitForTimeout(1000);
    const dialogs = page.locator('[role="dialog"]');
    if ((await dialogs.count()) > 0) {
      // Check if dialog is NOT the document itself - close it
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // The embedded database block should exist in the editor
    await expect(editor.locator(BlockSelectors.blockSelector('grid'))).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // 3) Verify sidebar: document has a child database container with a child view
    await expandSpaceByName(page, spaceName);
    await ensurePageExpandedByViewId(page, docViewId);

    // Find the container under the document
    const docPageItem = page
      .locator(`[data-testid="page-item"]:has(> [data-testid="page-${docViewId}"])`)
      .first();
    const containerName = docPageItem.getByTestId('page-name').filter({ hasText: dbName });
    await expect(containerName.first()).toBeVisible({ timeout: 30000 });

    // 4) Delete the database block from the document
    // Navigate back to document if needed
    await page.getByTestId(`page-${docViewId}`).first().click({ force: true });
    await page.waitForTimeout(800);

    // Delete the grid block via hover controls drag handle context menu
    const gridBlock = editor.locator(BlockSelectors.blockSelector('grid')).first();
    await expect(gridBlock).toBeVisible();

    // Hover over the grid block to show hover controls
    await gridBlock.hover();
    await page.waitForTimeout(500);

    // Click the drag handle to open the block action menu
    const hoverControls = BlockSelectors.hoverControls(page);
    await expect(hoverControls).toBeVisible({ timeout: 5000 });
    const dragHandle = BlockSelectors.dragHandle(page);
    await dragHandle.click();
    await page.waitForTimeout(500);

    // Click "Delete" from the controls menu (uses MUI Button, not role="menuitem")
    const controlsMenu = page.getByTestId('controls-menu');
    await expect(controlsMenu).toBeVisible({ timeout: 5000 });
    const deleteOption = controlsMenu.getByTestId('delete');
    await expect(deleteOption).toBeVisible({ timeout: 5000 });
    await deleteOption.click({ force: true });

    await page.waitForTimeout(2000);

    // Verify the database block is removed from the document
    await expect(editor.locator(BlockSelectors.blockSelector('grid'))).not.toBeAttached();

    // Wait for cache expiry and cascade deletion
    await page.waitForTimeout(6000);

    // 5) Verify sidebar: document no longer has the database container child
    await expandSpaceByName(page, spaceName);

    // Collapse and re-expand to force fresh API fetch
    const pageItem = page
      .locator(`[data-testid="page-item"]:has(> [data-testid="page-${docViewId}"])`)
      .first();

    const collapseToggle = pageItem.locator('[data-testid="outline-toggle-collapse"]');
    if ((await collapseToggle.count()) > 0) {
      await collapseToggle.first().click({ force: true });
      await page.waitForTimeout(500);
    }

    const expandToggle = pageItem.locator('[data-testid="outline-toggle-expand"]');
    if ((await expandToggle.count()) > 0) {
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // After fresh fetch, the document should have no child named "New Database"
    await expect(pageItem.getByTestId('page-name').filter({ hasText: dbName })).not.toBeVisible({ timeout: 15000 });
  });
});
