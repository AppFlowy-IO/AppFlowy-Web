import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  HeaderSelectors,
  PageSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Chat Selection Mode Tests
 * Migrated from: cypress/e2e/chat/selection-mode.cy.ts
 *
 * NOTE: This test relies on chat API stubs (mock data) that were provided via
 * cy.intercept in the original Cypress test. The Playwright equivalent uses
 * page.route() to set up the same stubs.
 */

const STUBBED_MESSAGE_ID = 101;
const STUBBED_MESSAGE_CONTENT = 'Stubbed AI answer ready for export';

async function setupChatApiStubs(page: import('@playwright/test').Page) {
  await page.route('**/api/chat/**/message**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            messages: [
              {
                message_id: STUBBED_MESSAGE_ID,
                author: {
                  author_type: 3,
                  author_uuid: 'assistant',
                },
                content: STUBBED_MESSAGE_CONTENT,
                created_at: new Date().toISOString(),
                meta_data: [],
              },
            ],
            has_more: false,
            total: 1,
          },
          message: 'success',
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/chat/**/settings**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            rag_ids: [],
            metadata: {
              ai_model: 'Auto',
            },
          },
          message: 'success',
        }),
      });
    } else if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/ai/**/model/list**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          models: [
            {
              name: 'Auto',
              metadata: { is_default: true, desc: 'Automatically select an AI model' },
            },
            {
              name: 'E2E Test Model',
              provider: 'Test Provider',
              metadata: { is_default: false, desc: 'Stubbed model for testing' },
            },
          ],
        },
        message: 'success',
      }),
    });
  });

  await page.route('**/api/chat/**/**/related_question**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          message_id: `${STUBBED_MESSAGE_ID}`,
          items: [],
        },
        message: 'success',
      }),
    });
  });
}

test.describe('Chat Selection Mode Tests', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('enables message selection mode and toggles message selection', async ({ page, request }) => {
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

    // Set up API stubs before navigating
    await setupChatApiStubs(page);

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.items(page).first()).toBeAttached({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await expandSpace(page);
    await page.waitForTimeout(1000);

    const firstPage = PageSelectors.items(page).first();
    await firstPage.hover({ force: true });
    await page.waitForTimeout(1000);

    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await expect(AddPageSelectors.addAIChatButton(page)).toBeVisible();
    await AddPageSelectors.addAIChatButton(page).click();

    // Wait for stubbed data to load
    await expect(page.getByText(STUBBED_MESSAGE_CONTENT)).toBeVisible({ timeout: 30000 });

    // Click the header's more actions button (not the sidebar's)
    await HeaderSelectors.moreActionsButton(page).click({ force: true });

    await expect(page.locator('[role="menu"]')).toBeAttached();

    const addMessagesMenuItem = page.locator('[role="menuitem"]').filter({ hasText: 'Add messages to page' });
    await expect(addMessagesMenuItem).toBeAttached();
    await addMessagesMenuItem.click({ force: true });

    const selectionBanner = page.locator('.chat-selections-banner');
    await expect(selectionBanner).toBeVisible({ timeout: 10000 });
    await expect(selectionBanner).toContainText('Select messages');

    const firstMessage = page.locator(`[data-message-id="${STUBBED_MESSAGE_ID}"]`);

    // Click the selection toggle button
    await firstMessage.locator('button.w-4.h-4').first().click();

    // Verify the checked state
    await expect(firstMessage.locator('svg.text-primary')).toBeAttached();

    // Verify count
    await expect(selectionBanner).toContainText('1 selected');

    // Cancel selection mode by clicking the last button in the banner
    await selectionBanner.locator('button').last().click({ force: true });

    // Verify banner is gone
    await expect(selectionBanner).toHaveCount(0);

    // Verify selection checkboxes are gone
    await expect(firstMessage.locator('button.w-4.h-4')).toHaveCount(0);
  });
});
