import { test, expect, type Locator } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

/**
 * Toolbar Interaction Tests
 * Migrated from: cypress/e2e/editor/toolbar/editor_toolbar.cy.ts
 */
test.describe('Toolbar Interaction', () => {
  const testEmail = generateRandomEmail();

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
    const viewId = await createDocumentPageAndNavigate(page);
    const editor = page.locator(`#root #editor-${viewId}`);

    await editor.click();
    await expect(editor).toBeFocused();
    // Editable and its selection toolbar share the document's editor host.
    const toolbar = editor.locator('..').getByTestId('selection-toolbar');

    return { editor, toolbar };
  }

  /**
   * Helper: select text within the current block to trigger the selection toolbar.
   * Uses Home+Shift+End instead of Ctrl+A to avoid cross-block selection
   * (which hides list/quote buttons in the toolbar).
   */
  async function showToolbar(editor: Locator, toolbar: Locator) {
    await editor.press('Home');
    await editor.press('Shift+End');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS('opacity', '1');
    await expect(toolbar).toHaveCSS('pointer-events', 'auto');
  }

  test('should open Link popover via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Link text');
    await showToolbar(editor, toolbar);

    await toolbar.locator('[data-testid="link-button"]').click();

    await expect(page.locator('.MuiPopover-root').last()).toBeVisible();
    await expect(page.locator('.MuiPopover-root').last().locator('input')).toBeAttached();
  });

  test('should open Text Color picker via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Colored text');
    await showToolbar(editor, toolbar);

    await toolbar.locator('[data-testid="text-color-button"]').click();

    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();

    expect(divCount).toBeGreaterThan(0);
  });

  test('should open Background Color picker via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Highlighted text');
    await showToolbar(editor, toolbar);

    await toolbar.locator('[data-testid="bg-color-button"]').click();

    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();

    expect(divCount).toBeGreaterThan(0);
  });

  test('should allow converting block type via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Convert me');
    await showToolbar(editor, toolbar);

    await toolbar.locator('[data-testid="heading-button"]').click();

    await expect(page.locator('.MuiPopover-root').last()).toBeVisible();
    await expect(EditorSelectors.heading1Button(page)).toBeAttached();
  });

  test('should apply Bulleted List via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('List Item');
    await showToolbar(editor, toolbar);

    await toolbar.getByTestId('toolbar-bulleted-list-button').click();

    await expect(editor).toContainText('List Item');
    await expect(editor.locator(BlockSelectors.blockSelector('bulleted_list'))).toBeVisible();
  });

  test('should apply Numbered List via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Numbered Item');
    await showToolbar(editor, toolbar);

    await toolbar.getByTestId('toolbar-numbered-list-button').click();

    await expect(editor.locator(BlockSelectors.blockSelector('numbered_list'))).toBeVisible();
  });

  test('should apply Quote via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Quote Text');
    await showToolbar(editor, toolbar);

    await toolbar.getByTestId('toolbar-quote-button').click();

    await expect(editor.locator(BlockSelectors.blockSelector('quote'))).toBeVisible();
  });

  test('should apply Inline Code via toolbar', async ({ page, request }) => {
    const { editor, toolbar } = await setupEditor(page, request);

    await page.keyboard.type('Code Text');
    await showToolbar(editor, toolbar);

    // Use defined selector for code button
    await toolbar.getByTestId('toolbar-code-button').click();

    await expect(editor.locator('span.bg-border-primary')).toContainText('Code Text');
  });
});
