import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Toolbar Interaction Tests
 * Migrated from: cypress/e2e/editor/toolbar/editor_toolbar.cy.ts
 */
test.describe('Toolbar Interaction', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: sign in and create a fresh empty document page.
   */
  async function setupEditor(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(2000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  /**
   * Helper: select text within the current block to trigger the selection toolbar.
   * Uses Home+Shift+End instead of Ctrl+A to avoid cross-block selection
   * (which hides list/quote buttons in the toolbar).
   */
  async function showToolbar(page: import('@playwright/test').Page) {
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(500);
    await expect(EditorSelectors.selectionToolbar(page)).toBeVisible();
  }

  test('should open Link popover via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Link text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="link-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('.MuiPopover-root').last()).toBeVisible();
    await expect(page.locator('.MuiPopover-root').last().locator('input')).toBeAttached();
  });

  test('should open Text Color picker via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Colored text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="text-color-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();
    expect(divCount).toBeGreaterThan(0);
  });

  test('should open Background Color picker via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Highlighted text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="bg-color-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();
    expect(divCount).toBeGreaterThan(0);
  });

  test('should allow converting block type via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Convert me');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="heading-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('.MuiPopover-root').last()).toBeVisible();
    await expect(EditorSelectors.heading1Button(page)).toBeAttached();
  });

  test('should apply Bulleted List via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('List Item');
    await showToolbar(page);

    await page.getByTestId('toolbar-bulleted-list-button').click({ force: true });

    await page.waitForTimeout(200);
    await expect(EditorSelectors.slateEditor(page)).toContainText('List Item');
    await expect(BlockSelectors.blockByType(page, 'bulleted_list')).toBeVisible();
  });

  test('should apply Numbered List via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Numbered Item');
    await showToolbar(page);

    await page.getByTestId('toolbar-numbered-list-button').click({ force: true });

    await page.waitForTimeout(200);
    await expect(BlockSelectors.blockByType(page, 'numbered_list')).toBeVisible();
  });

  test('should apply Quote via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Quote Text');
    await showToolbar(page);

    await page.getByTestId('toolbar-quote-button').click({ force: true });

    await page.waitForTimeout(200);
    await expect(BlockSelectors.blockByType(page, 'quote')).toBeVisible();
  });

  test('should apply Inline Code via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Code Text');
    await showToolbar(page);

    // Use defined selector for code button
    await EditorSelectors.codeButton(page).click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('span.bg-border-primary')).toContainText('Code Text');
  });
});
