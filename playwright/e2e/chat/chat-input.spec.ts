import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  ModelSelectorSelectors,
  PageSelectors,
  SidebarSelectors,
  ChatSelectors,
  byTestId,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Chat Input Tests
 * Migrated from: cypress/e2e/chat/chat-input.cy.ts
 */
test.describe('Chat Input Tests', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('tests chat input UI controls', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

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

    // Test 1: Format toggle
    const formatGroupExists = await ChatSelectors.formatGroup(page).count();
    if (formatGroupExists > 0) {
      await ChatSelectors.formatToggle(page).click();
      await expect(ChatSelectors.formatGroup(page)).toHaveCount(0);
    }

    await expect(ChatSelectors.formatToggle(page)).toBeVisible({ timeout: 30000 });
    await ChatSelectors.formatToggle(page).click();
    await expect(ChatSelectors.formatGroup(page)).toBeAttached();
    const buttonCount = await ChatSelectors.formatGroup(page).locator('button').count();
    expect(buttonCount).toBeGreaterThanOrEqual(4);
    await ChatSelectors.formatToggle(page).click();
    await expect(ChatSelectors.formatGroup(page)).toHaveCount(0);

    // Test 2: Model selector
    await expect(ModelSelectorSelectors.button(page)).toBeVisible();
    await ModelSelectorSelectors.button(page).click();
    await expect(ModelSelectorSelectors.options(page).first()).toBeAttached();
    await page.mouse.click(0, 0);

    // Test 3: Browse prompts
    await ChatSelectors.browsePromptsButton(page).click();
    const browsePromptsDialog = page.getByRole('dialog', { name: 'Browse prompts' });

    await expect(browsePromptsDialog).toBeAttached();
    await expect(browsePromptsDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(browsePromptsDialog).not.toBeAttached();

    // Test 4: Related views
    await ChatSelectors.relatedViewsButton(page).click();
    await expect(ChatSelectors.relatedViewsPopover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ChatSelectors.relatedViewsPopover(page)).toHaveCount(0);
  });

  test('tests chat input message handling', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

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

    await page.waitForTimeout(3000);
    await expect(ChatSelectors.aiChatContainer(page)).toBeVisible({ timeout: 30000 });

    // Mock API endpoints
    await page.route('**/api/chat/**/message/question', async (route) => {
      const postData = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            message_id: Date.now().toString(),
            content: postData?.content || 'Test message',
            chat_id: 'test-chat-id',
          },
          message: 'success',
        }),
      });
    });

    await page.route('**/api/chat/**/answer/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'data: {"content":"Test response","type":"message"}\n\n',
      });
    });

    const textarea = page.locator('textarea').first();

    // Test 1: Check textarea exists and is ready
    await expect(textarea).toBeVisible();

    // Test 2: Keyboard interactions
    await expect(textarea).toBeEnabled();
    await textarea.fill('');
    await textarea.fill('First line');
    await expect(textarea).toHaveValue(/First line/);

    await page.waitForTimeout(500);

    await textarea.press('Shift+Enter');
    await textarea.type('Second line');
    await expect(textarea).toHaveValue(/First line\nSecond line/);

    // Test 3: Textarea auto-resize
    const initialBox = await textarea.boundingBox();
    const initialHeight = initialBox?.height ?? 0;
    await textarea.fill('');
    await textarea.fill('Line 1');
    await textarea.press('Shift+Enter');
    await textarea.type('Line 2');
    await textarea.press('Shift+Enter');
    await textarea.type('Line 3');
    await textarea.press('Shift+Enter');
    await textarea.type('Line 4');

    await page.waitForTimeout(500);

    const newBox = await textarea.boundingBox();
    const newHeight = newBox?.height ?? 0;
    expect(newHeight).toBeGreaterThanOrEqual(initialHeight);

    // Test 4: Button states
    await textarea.fill('');
    await page.waitForTimeout(500);

    const sendButton = ChatSelectors.sendButton(page);
    await expect(sendButton).toBeAttached();
    const isDisabled = await sendButton.isDisabled();
    expect(isDisabled).toBe(true);

    await textarea.fill('Test message');
    await page.waitForTimeout(500);

    const isDisabledAfterType = await sendButton.isDisabled();
    expect(isDisabledAfterType).toBe(false);

    // Test 5: Message sending
    await textarea.fill('Hello world');
    await page.waitForTimeout(500);

    const questionPromise = page.waitForRequest('**/api/chat/**/message/question');
    await sendButton.click();
    await questionPromise;

    await page.waitForTimeout(2000);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('');

    // Test 6: Special characters
    await page.waitForTimeout(1000);
    const specialMessage = 'Test with special: @#$%';
    await expect(textarea).toBeEnabled();
    await textarea.fill(specialMessage);
    await page.waitForTimeout(500);
    await expect(textarea).toHaveValue(specialMessage);

    // Test 7: Enter sends message
    await textarea.fill('');
    await page.waitForTimeout(500);

    const questionPromise2 = page.waitForRequest('**/api/chat/**/message/question');
    await textarea.fill('Quick test');
    await textarea.press('Enter');
    await questionPromise2;

    await page.waitForTimeout(2000);
    await expect(textarea).toHaveValue('');
  });
});
