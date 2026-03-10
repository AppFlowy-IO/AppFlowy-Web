import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  PageSelectors,
  SidebarSelectors,
  ChatSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * AI Chat Creation and Navigation Tests
 * Migrated from: cypress/e2e/chat/create-ai-chat.cy.ts
 */
test.describe('AI Chat Creation and Navigation Tests', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test.describe('Create AI Chat and Open Page', () => {
    test('should create an AI chat and open the chat page without errors', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (
          err.message.includes('No workspace or service found') ||
          err.message.includes('View not found') ||
          err.message.includes('WebSocket') ||
          err.message.includes('connection')
        ) {
          return;
        }
      });

      // Step 1: Login
      console.log('=== Step 1: Login ===');
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for the app to fully load
      console.log('Waiting for app to fully load...');

      // Wait for the sidebar to be visible (indicates app is loaded)
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

      // Wait for at least one page to exist in the sidebar
      await expect(PageSelectors.names(page).first()).toBeAttached({ timeout: 30000 });

      // Additional wait for stability
      await page.waitForTimeout(2000);

      // Now wait for the new page button to be available
      console.log('Looking for new page button...');
      await expect(PageSelectors.newPageButton(page)).toBeAttached({ timeout: 20000 });
      console.log('New page button found!');

      // Step 2: Find a space/document that has the add button
      console.log('=== Step 2: Finding a space/document with add button ===');

      // Expand the first space to see its pages
      await expandSpace(page);
      await page.waitForTimeout(1000);

      // Find the first page item and hover over it to show actions
      console.log('Finding first page item to access add actions...');

      const firstPage = PageSelectors.items(page).first();
      console.log('Hovering over first page to show action buttons...');

      // Hover over the page to reveal the action buttons
      await firstPage.hover({ force: true });
      await page.waitForTimeout(1000);

      // Click the inline add button (plus icon) - inside the page item
      const inlineAddBtn = firstPage.getByTestId('inline-add-page').first();
      await expect(inlineAddBtn).toBeVisible();
      await inlineAddBtn.click({ force: true });

      console.log('Clicked inline add page button');

      // Wait for the dropdown menu to appear
      await page.waitForTimeout(1000);

      // Step 3: Click on AI Chat option from the dropdown
      console.log('=== Step 3: Creating AI Chat ===');

      await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
      await AddPageSelectors.addAIChatButton(page).click();

      console.log('Clicked AI Chat option from dropdown');

      // Wait for navigation to the AI chat page
      await page.waitForTimeout(3000);

      // Step 4: Verify AI Chat page loaded successfully
      console.log('=== Step 4: Verifying AI Chat page loaded ===');

      // Check that the URL contains a view ID (indicating navigation to chat)
      await expect(page).toHaveURL(/\/app\/[^/]+\/[^/?#]+/, { timeout: 20000 });
      console.log('Navigated to AI Chat page');

      // Verify AI Chat container renders
      await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });
      console.log('AI Chat container exists');

      // Verify no error messages are displayed
      const hasErrorMessage = await page.locator('.error-message').count();
      const hasAlert = await page.locator('[role="alert"]').count();
      const bodyText = await page.locator('body').textContent();

      const hasError =
        hasErrorMessage > 0 ||
        hasAlert > 0 ||
        (bodyText && bodyText.includes('Something went wrong'));

      if (hasError) {
        throw new Error('Error detected on AI Chat page');
      }
      console.log('No errors detected on page');

      // Step 5: Basic verification that we're on a chat page
      console.log('=== Step 5: Final verification ===');

      const url = page.url();
      console.log(`Current URL: ${url}`);

      if (url.includes('/app/') && url.split('/').length >= 5) {
        console.log('Successfully navigated to a view page');
      }

      console.log('=== Test completed successfully! ===');
    });
  });
});
