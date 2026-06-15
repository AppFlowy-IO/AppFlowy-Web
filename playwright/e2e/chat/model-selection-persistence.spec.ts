import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  PageSelectors,
  SidebarSelectors,
  ModelSelectorSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Chat Model Selection Persistence Tests
 * Migrated from: cypress/e2e/chat/model-selection-persistence.cy.ts
 */
test.describe('Chat Model Selection Persistence Tests', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test.describe('Model Selection Persistence', () => {
    test('should persist selected model after page reload', async ({ page, request }) => {
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
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeAttached({ timeout: 30000 });
      await page.waitForTimeout(2000);

      // Step 2: Create an AI Chat
      console.log('=== Step 2: Creating AI Chat ===');

      await expandSpace(page);
      await page.waitForTimeout(1000);

      const firstPage = PageSelectors.items(page).first();
      await firstPage.hover({ force: true });
      await page.waitForTimeout(1000);

      // Click the inline add button inside the page item
      const inlineAddBtn = firstPage.getByTestId('inline-add-page').first();
      await expect(inlineAddBtn).toBeVisible();
      await inlineAddBtn.click({ force: true });

      // Wait for the dropdown menu to appear
      await page.waitForTimeout(1000);

      // Click on the AI Chat option from the dropdown
      await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
      await AddPageSelectors.addAIChatButton(page).click();

      console.log('Created AI Chat');

      // Wait for navigation to the AI chat page
      await page.waitForTimeout(3000);

      // Step 3: Open model selector and select a model
      console.log('=== Step 3: Selecting a Model ===');
      await page.waitForTimeout(2000);

      await expect(ModelSelectorSelectors.button(page)).toBeVisible({ timeout: 10000 });
      await ModelSelectorSelectors.button(page).click();

      console.log('Opened model selector dropdown');
      await page.waitForTimeout(2000);

      // Select a specific model (the first non-Auto model if available)
      const options = ModelSelectorSelectors.options(page);
      const optionCount = await options.count();

      let selectedModel = 'Auto';

      for (let i = 0; i < optionCount; i++) {
        const option = options.nth(i);
        const testId = await option.getAttribute('data-testid');
        if (testId && !testId.includes('model-option-Auto')) {
          selectedModel = testId.replace('model-option-', '');
          console.log(`Selecting model: ${selectedModel}`);
          await option.click();
          break;
        }
      }

      if (selectedModel === 'Auto') {
        console.log('Only Auto model available, selecting it');
        await ModelSelectorSelectors.optionByName(page, 'Auto').click();
      }

      // Wait for the selection to be applied
      await page.waitForTimeout(1000);

      // Verify the model is selected by checking the button text
      console.log(`Verifying model ${selectedModel} is displayed in button`);
      await expect(ModelSelectorSelectors.button(page)).toContainText(selectedModel);

      // Step 4: Save the current URL for reload
      console.log('=== Step 4: Saving current URL ===');
      const chatUrl = page.url();
      console.log(`Current chat URL: ${chatUrl}`);

      // Step 5: Reload the page
      console.log('=== Step 5: Reloading page ===');
      await page.reload();
      await page.waitForTimeout(3000);

      // Step 6: Verify the model selection persisted
      console.log('=== Step 6: Verifying Model Selection Persisted ===');

      await expect(ModelSelectorSelectors.button(page)).toBeVisible({ timeout: 10000 });

      console.log(`Checking if model ${selectedModel} is still selected after reload`);
      await expect(ModelSelectorSelectors.button(page)).toContainText(selectedModel);
      console.log(`Model ${selectedModel} persisted after page reload!`);

      // Step 7: Double-checking selection in dropdown
      console.log('=== Step 7: Double-checking selection in dropdown ===');
      await ModelSelectorSelectors.button(page).click();
      await page.waitForTimeout(1000);

      // Verify the selected model has the selected styling
      const selectedOptionLocator = ModelSelectorSelectors.optionByName(page, selectedModel);
      await expect(selectedOptionLocator).toHaveClass(/bg-fill-content-select/);
      console.log(`Model ${selectedModel} shows as selected in dropdown`);

      // Close the dropdown
      await page.mouse.click(0, 0);

      console.log('=== Test completed successfully! ===');
    });
  });
});
