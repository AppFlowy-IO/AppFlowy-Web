/**
 * Database Embedded ↔ Modal Sync Test
 *
 * Verifies that editing a database in the center modal (ViewModal) correctly
 * persists to the embedded database view within the document page —
 * confirming Y.Doc instance sharing via row doc cache deduplication.
 */
import { test, expect } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { editFirstGridCell } from '../../../support/duplicate-test-helpers';
import { getSlashMenuItemName } from '../../../support/i18n-constants';
import {
  createDocumentPageAndNavigate,
} from '../../../support/page-utils';
import {
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

test.describe('Database Embedded ↔ Modal Sync', () => {
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

  test('edits in center modal should sync to embedded database in document', async ({
    page,
    request,
  }) => {
    // --- Given: Sign in and create a Document page ---
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    const docViewId = await createDocumentPageAndNavigate(page);

    // --- When: Insert a new Grid database via slash menu ---
    const editor = page.locator(`#editor-${docViewId}`);

    await expect(editor).toBeVisible();
    await editor.click({ position: { x: 200, y: 100 }, force: true });
    await editor.pressSequentially('/', { delay: 50 });
    await page.waitForTimeout(500);

    const slashPanel = SlashCommandSelectors.slashPanel(page);

    await expect(slashPanel).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });
    await page.waitForTimeout(5000);

    // --- And: The center modal (ViewModal) opens with the new database ---
    const modal = page.locator('.MuiDialog-paper');

    await expect(modal).toBeVisible({ timeout: 15000 });

    // Wait for the database grid to be visible inside the modal
    const modalGrid = modal.locator('[data-testid="database-grid"]');

    await expect(modalGrid).toBeVisible({ timeout: 15000 });

    // --- And: Edit the first cell in the modal ---
    // Wait for the row and its editor before typing. The grid can be visible
    // while its primary cell is still hydrating, so a forced click followed by
    // global keyboard input does not establish that the cell received the edit.
    await editFirstGridCell(page, modalGrid, 'Updated Value');

    // --- And: Close the center modal ---
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    if (await modal.isVisible()) {
      await page.mouse.click(10, 10);
      await page.waitForTimeout(2000);
    }

    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // --- Then: The embedded database in the document should display the updated value ---
    const embeddedDB = page.locator('[class*="appflowy-database"]').last();

    await expect(embeddedDB).toBeVisible({ timeout: 15000 });
    await expect(embeddedDB.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 10000 });
    await expect(embeddedDB).toContainText('Updated Value', { timeout: 15000 });
  });
});
