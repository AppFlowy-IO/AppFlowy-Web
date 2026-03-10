import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  ChatSelectors,
  ModelSelectorSelectors,
  PageSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Chat Provider Stability E2E Tests
 * Migrated from: cypress/e2e/chat/chat-provider-stability.cy.ts
 *
 * Verifies that the chat message handler, model selection, and settings
 * loader work correctly after provider stabilization fixes.
 *
 * Regression tests for:
 * - MessagesHandlerProvider: unmemoized provider value causing unnecessary re-renders
 * - useChatSettingsLoader: missing mount guard for async fetch
 * - selectedModelName/messageIds causing cascade callback recreations
 *
 * TODO: The original Cypress test imported from '../../support/chat-mocks':
 *   mockChatSettings, mockModelList, mockUpdateChatSettings,
 *   mockEmptyChatMessages, mockRelatedQuestions
 * These chat-mocks utilities need to be migrated to Playwright support.
 * For now, these tests run without mocks (against real or dev endpoints).
 */

test.describe('Chat Provider Stability', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });
  });

  /**
   * Helper: Sign in, navigate, and open a new AI Chat
   */
  async function openAIChat(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeAttached({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(1000);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
    await AddPageSelectors.addAIChatButton(page).click();
    await page.waitForTimeout(2000);
    await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });
  }

  test('should load chat and display model selector without errors', async ({ page, request }) => {
    await openAIChat(page, request);

    // Model selector should be visible (chat settings loaded successfully)
    await expect(ModelSelectorSelectors.button(page)).toBeVisible();

    // Open model selector popover
    await ModelSelectorSelectors.button(page).click();
    await page.waitForTimeout(1000);

    // Model options should be listed
    await expect(ModelSelectorSelectors.options(page).first()).toBeAttached();

    // Close popover
    await page.mouse.click(0, 0);
    await page.waitForTimeout(500);
  });

  test('should handle model selection change without re-render cascade', async ({ page, request }) => {
    await openAIChat(page, request);

    // Open model selector
    await expect(ModelSelectorSelectors.button(page)).toBeVisible();
    await ModelSelectorSelectors.button(page).click();
    await page.waitForTimeout(1000);

    // Select a different model (if available)
    const optionsCount = await ModelSelectorSelectors.options(page).count();
    if (optionsCount > 1) {
      await ModelSelectorSelectors.options(page).nth(1).click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Chat input should still be functional after model change
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // Format controls should still work
    // Default responseMode is FormatResponse, so FormatGroup starts visible
    await expect(ChatSelectors.formatGroup(page)).toBeAttached({ timeout: 10000 });
    // Clicking toggle switches to Auto mode, hiding FormatGroup
    await expect(ChatSelectors.formatToggle(page)).toBeVisible();
    await ChatSelectors.formatToggle(page).click();
    await expect(ChatSelectors.formatGroup(page)).toHaveCount(0);
    // Clicking again switches back to FormatResponse, showing FormatGroup
    await ChatSelectors.formatToggle(page).click();
    await expect(ChatSelectors.formatGroup(page)).toBeAttached();
  });

  test('should handle rapid chat navigation without unmount errors', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeAttached({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(1000);

    // Create first AI chat
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
    await AddPageSelectors.addAIChatButton(page).click();
    await page.waitForTimeout(2000);
    await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });

    // Navigate away while chat settings may still be loading
    // (tests useChatSettingsLoader mount guard)
    await PageSelectors.items(page).first().hover({ force: true });
    await page.waitForTimeout(500);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
    await AddPageSelectors.addAIChatButton(page).click();
    await page.waitForTimeout(2000);

    // Second chat should load successfully
    await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });
    await expect(ModelSelectorSelectors.button(page)).toBeVisible();
  });
});
