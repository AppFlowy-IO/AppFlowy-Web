import { test, expect } from '@playwright/test';
import {
  ModalSelectors,
  PageSelectors,
  SidebarSelectors,
  TrashSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';
import { deletePageByName } from '../../support/page/page-actions';
import { closeModalsIfOpen } from '../../support/test-helpers';

/**
 * Delete Page, Verify in Trash, and Restore Tests
 * Migrated from: cypress/e2e/page/delete-page-verify-trash.cy.ts
 */
test.describe('Delete Page, Verify in Trash, and Restore Tests', () => {
  let testEmail: string;
  let testPageName: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
    testPageName = `test-page-${Date.now()}`;
  });

  test.describe('Delete Page, Verify in Trash, and Restore', () => {
    test('should create a page, delete it, verify in trash, restore it, and verify it is back in sidebar', async ({
      page,
      request,
    }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) {
          return;
        }
      });

      // Step 1: Login
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to fully load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);
      await expect(PageSelectors.newPageButton(page)).toBeVisible({ timeout: 20000 });

      // Step 2: Create a new page
      await PageSelectors.newPageButton(page).click();
      await page.waitForTimeout(1000);

      // Handle the new page modal
      const modal = ModalSelectors.newPageModal(page);
      await expect(modal).toBeVisible();
      await modal.getByTestId('space-item').first().click();
      await page.waitForTimeout(500);
      await modal.getByRole('button', { name: 'Add' }).click();
      await page.waitForTimeout(3000);

      // Close any modals
      await closeModalsIfOpen(page);

      // Set the page title
      const titleInput = PageSelectors.titleInput(page).first();
      await expect(titleInput).toBeVisible();
      await page.waitForTimeout(1000);

      await titleInput.click({ force: true });
      await page.keyboard.press('Control+A');
      await titleInput.pressSequentially(testPageName, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // Step 3: Verify the page exists in sidebar
      await expandSpace(page);
      await page.waitForTimeout(1000);

      const pageTexts = await PageSelectors.names(page).allTextContents();
      const trimmedNames = pageTexts.map((t) => t.trim());
      const pageExists = trimmedNames.some((name) => name === testPageName || name === 'Untitled');
      expect(pageExists).toBe(true);

      // Determine the actual page name to delete
      let pageToDelete = testPageName;
      if (!trimmedNames.includes(testPageName)) {
        pageToDelete = 'Untitled';
      }

      // Step 4: Delete the page
      await deletePageByName(page, pageToDelete);
      await page.waitForTimeout(2000);

      // Step 5: Navigate to trash page
      await TrashSelectors.sidebarTrashButton(page).click();
      await page.waitForTimeout(2000);
      await expect(page).toHaveURL(/\/app\/trash/);

      // Step 6: Verify the deleted page exists in trash
      await expect(TrashSelectors.table(page)).toBeVisible();

      const rows = TrashSelectors.rows(page);
      const rowCount = await rows.count();
      let foundPage = false;
      for (let i = 0; i < rowCount; i++) {
        const rowText = await rows.nth(i).textContent();
        if (rowText?.includes(testPageName) || rowText?.includes('Untitled')) {
          foundPage = true;
          break;
        }
      }
      expect(foundPage).toBe(true);

      // Step 7: Verify restore and delete buttons are present
      const firstRow = rows.first();
      await expect(firstRow.getByTestId('trash-restore-button')).toBeVisible();
      await expect(firstRow.getByTestId('trash-delete-button')).toBeVisible();

      // Step 8: Restore the deleted page
      const cellText = await firstRow.locator('td').first().textContent();
      const restoredPageName = cellText?.trim() || 'Untitled';

      await firstRow.getByTestId('trash-restore-button').click();
      await page.waitForTimeout(2000);

      // Step 9: Verify the page is removed from trash
      await page.waitForTimeout(2000);
      const trashRowCount = await page.getByTestId('trash-table-row').count();
      if (trashRowCount > 0) {
        const remainingRows = page.getByTestId('trash-table-row');
        const remainingCount = await remainingRows.count();
        let pageStillInTrash = false;
        for (let i = 0; i < remainingCount; i++) {
          const text = await remainingRows.nth(i).textContent();
          if (text?.includes(restoredPageName)) {
            pageStillInTrash = true;
          }
        }
        expect(pageStillInTrash).toBe(false);
      }

      // Step 10: Navigate back to the main workspace
      await page.goto('/app');
      await page.waitForTimeout(3000);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 10000 });

      // Step 11: Verify the restored page exists in sidebar
      await expandSpace(page);
      await page.waitForTimeout(1000);

      const pagesAfterRestore = await PageSelectors.names(page).allTextContents();
      const trimmedAfterRestore = pagesAfterRestore.map((t) => t.trim());
      const pageRestored = trimmedAfterRestore.some(
        (name) => name === restoredPageName || name === testPageName || name === 'Untitled'
      );
      expect(pageRestored).toBe(true);
    });
  });
});
