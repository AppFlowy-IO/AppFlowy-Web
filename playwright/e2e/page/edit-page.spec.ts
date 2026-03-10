import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DropdownSelectors,
  EditorSelectors,
  PageSelectors,
  SpaceSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../support/test-helpers';

/**
 * Page Edit Tests
 * Migrated from: cypress/e2e/page/edit-page.cy.ts
 */
test.describe('Page Edit Tests', () => {
  let testEmail: string;
  let testPageName: string;
  let testContent: string[];

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
    testPageName = 'e2e test-edit page';
    testContent = [
      'AppFlowy Web',
      'AppFlowy Web is a modern open-source project management tool that helps you manage your projects and tasks efficiently.',
    ];
  });

  test.describe('Page Content Editing Tests', () => {
    test('should sign up, create a page, edit with multiple lines, and verify content', async ({
      page,
      request,
    }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) {
          return;
        }
      });

      // Step 1: Sign in
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for sidebar to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);

      // Step 2: Create a new page using inline add in General space
      // Expand General space
      await SpaceSelectors.itemByName(page, 'General').first().click();
      await page.waitForTimeout(500);

      // Use inline add button on General space
      const generalSpace = SpaceSelectors.itemByName(page, 'General').first();
      const inlineAdd = generalSpace.getByTestId('inline-add-page').first();
      await expect(inlineAdd).toBeVisible();
      await inlineAdd.click();
      await page.waitForTimeout(1000);

      // Select first item (Page) from the menu
      await DropdownSelectors.menuItem(page).first().click();
      await page.waitForTimeout(1000);

      // Handle the new page modal if it appears
      const newPageModal = page.getByTestId('new-page-modal');
      if ((await newPageModal.count()) > 0) {
        await page.getByTestId('space-item').first().click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Add' }).click();
        await page.waitForTimeout(3000);
      }

      // Close any remaining modal dialogs
      await closeModalsIfOpen(page);

      // Click the newly created "Untitled" page
      await PageSelectors.itemByName(page, 'Untitled').click();
      await page.waitForTimeout(1000);

      // Step 3: Add content to the page editor
      await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });
      await EditorSelectors.firstEditor(page).click({ force: true });
      await page.keyboard.type(testContent.join('\n'));
      await page.waitForTimeout(2000);

      // Step 4: Verify the content was added
      for (const line of testContent) {
        await expect(page.getByText(line)).toBeVisible();
      }
    });
  });
});
