import { test, expect } from '@playwright/test';
import { PageSelectors, ModalSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';
import { deletePageByName } from '../../support/page/page-actions';
import { closeModalsIfOpen } from '../../support/test-helpers';

/**
 * Page Create and Delete Tests
 * Migrated from: cypress/e2e/page/create-delete-page.cy.ts
 */
const isMac = process.platform === 'darwin';

test.describe('Page Create and Delete Tests', () => {
  let testEmail: string;
  let testPageName: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
    testPageName = 'e2e test-create page';
  });

  test.describe('Page Management Tests', () => {
    test('should login, create a page, reload and verify page exists, delete page, reload and verify page is gone', async ({
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

      // Wait for the app to fully load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);

      // Wait for the new page button
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

      // Close any remaining modal dialogs
      await closeModalsIfOpen(page);

      // Set the page title
      const titleInput = PageSelectors.titleInput(page).first();
      await expect(titleInput).toBeVisible();
      await page.waitForTimeout(1000);

      await titleInput.click({ force: true });
      await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
      await titleInput.pressSequentially(testPageName, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // Step 3: Reload and verify the page exists
      await page.reload();
      await page.waitForTimeout(3000);

      // Expand the first space to see its pages
      await expandSpace(page);
      await page.waitForTimeout(1000);

      // Verify the page exists
      const pageNames = PageSelectors.names(page);
      const pageTexts = await pageNames.allTextContents();
      const trimmedNames = pageTexts.map((t) => t.trim());

      let createdPageName = '';
      if (trimmedNames.includes(testPageName)) {
        createdPageName = testPageName;
      } else {
        // If title didn't save properly, find "Untitled" page
        const hasUntitled = trimmedNames.some((name) => name === 'Untitled');
        if (hasUntitled) {
          createdPageName = 'Untitled';
        } else {
          throw new Error(
            `Could not find created page. Expected "${testPageName}", found: ${trimmedNames.join(', ')}`
          );
        }
      }

      // Step 4: Delete the page we just created
      await deletePageByName(page, createdPageName);

      // Step 5: Reload and verify the page is gone
      await page.reload();
      await page.waitForTimeout(3000);

      // Expand the space again
      await expandSpace(page);
      await page.waitForTimeout(1000);

      // Verify the page no longer exists
      const pageNamesAfterDelete = await PageSelectors.names(page).allTextContents();
      const trimmedAfterDelete = pageNamesAfterDelete.map((t) => t.trim());
      const pageStillExists = trimmedAfterDelete.includes(createdPageName);

      expect(pageStillExists).toBe(false);
    });
  });
});
