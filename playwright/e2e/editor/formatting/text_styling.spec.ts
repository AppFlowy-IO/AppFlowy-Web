import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Editor Text Styling & Formatting Tests
 * Migrated from: cypress/e2e/editor/formatting/text_styling.cy.ts
 */
test.describe('Editor Text Styling & Formatting', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';
  const cmdModifier = isMac ? 'Meta' : 'Control';

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
   * Helper: type text then select all to show toolbar.
   */
  async function showToolbar(page: import('@playwright/test').Page, text = 'SelectMe') {
    await page.keyboard.type(text);
    await page.waitForTimeout(200);
    // Select within current block only (Home+Shift+End) to avoid cross-block selection
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(500);
    await expect(EditorSelectors.selectionToolbar(page)).toBeVisible();
  }

  test.describe('Keyboard Shortcuts', () => {
    test('should apply Bold using shortcut', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Normal ');
      await page.keyboard.press(`${cmdModifier}+b`);
      await page.keyboard.type('Bold');
      await page.waitForTimeout(200);
      await expect(page.locator('strong')).toContainText('Bold');
    });

    test('should apply Italic using shortcut', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Normal ');
      await page.keyboard.press(`${cmdModifier}+i`);
      await page.keyboard.type('Italic');
      await page.waitForTimeout(200);
      await expect(page.locator('em')).toContainText('Italic');
    });

    test('should apply Underline using shortcut', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Normal ');
      await page.keyboard.press(`${cmdModifier}+u`);
      await page.keyboard.type('Underline');
      await page.waitForTimeout(200);
      await expect(page.locator('u')).toContainText('Underline');
    });

    test('should apply Strikethrough using shortcut', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Normal ');
      await page.keyboard.press(`${cmdModifier}+Shift+x`);
      await page.keyboard.type('Strikethrough');
      await page.waitForTimeout(200);
      await expect(
        page.locator('s, del, strike, [style*="text-decoration: line-through"]')
      ).toContainText('Strikethrough');
    });

    test('should apply Code using shortcut', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Normal Code');
      await page.waitForTimeout(200);
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.waitForTimeout(500);

      // Use platform-specific shortcut for inline code
      await page.keyboard.press(`${cmdModifier}+e`);
      await page.waitForTimeout(500);

      await expect(page.locator('span.bg-border-primary')).toContainText('Code');
    });
  });

  test.describe('Toolbar Buttons', () => {
    test('should apply Bold via toolbar', async ({ page, request }) => {
      await setupEditor(page, request);

      await showToolbar(page, 'Bold Text');
      await EditorSelectors.boldButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await expect(page.locator('strong')).toContainText('Bold Text');
    });

    test('should apply Italic via toolbar', async ({ page, request }) => {
      await setupEditor(page, request);

      await showToolbar(page, 'Italic Text');
      await EditorSelectors.italicButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await expect(page.locator('em')).toContainText('Italic Text');
    });

    test('should apply Underline via toolbar', async ({ page, request }) => {
      await setupEditor(page, request);

      await showToolbar(page, 'Underline Text');
      await EditorSelectors.underlineButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await expect(page.locator('u')).toContainText('Underline Text');
    });

    test('should apply Strikethrough via toolbar', async ({ page, request }) => {
      await setupEditor(page, request);

      await showToolbar(page, 'Strike Text');
      await EditorSelectors.strikethroughButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await expect(
        page.locator('s, del, strike, [style*="text-decoration: line-through"]')
      ).toContainText('Strike Text');
    });
  });
});
