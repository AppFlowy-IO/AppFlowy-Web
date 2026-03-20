import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Basic Text Editing Tests
 * Migrated from: cypress/e2e/editor/basic/text_editing.cy.ts
 *
 * Note: Platform-specific keys (Cmd vs Ctrl, Option vs Alt) are handled
 * by detecting the OS at runtime. Playwright uses 'Meta' for Cmd on macOS.
 */
test.describe('Basic Text Editing', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';
  const cmdKey = isMac ? 'Meta' : 'Control';
  const wordJumpKey = isMac ? 'Alt' : 'Control';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: sign in, create a fresh blank document page.
   */
  async function setupEditor(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(1000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  test.describe('Deletion', () => {
    test.skip('should delete character forward using Delete key', async () => {
      // TODO: Skipped - Delete key behavior is flaky in headless environments with Slate editor.
      // The original Cypress test was also skipped.
    });

    test('should delete word backward', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Hello World Test');
      await page.waitForTimeout(200);

      // Use platform-specific key for word deletion: Option+Backspace (Mac) or Ctrl+Backspace (Win)
      await page.keyboard.press(`${wordJumpKey}+Backspace`);
      await page.waitForTimeout(200);

      const editor = EditorSelectors.slateEditor(page);
      await expect(editor).toContainText('Hello World');
      await expect(editor).not.toContainText('Hello World Test');
    });

    test('should delete word forward', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Hello World Test');
      await page.waitForTimeout(200);

      // Move to start of "World"
      await page.keyboard.press('Home');
      // "Hello " is 6 chars
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForTimeout(200);

      // Delete "World" forward: Option+Delete (Mac) or Ctrl+Delete (Win)
      await page.keyboard.press(`${wordJumpKey}+Delete`);
      await page.waitForTimeout(200);

      const editor = EditorSelectors.slateEditor(page);
      await expect(editor).toContainText('Hello');
      await expect(editor).toContainText('Test');
      await expect(editor).not.toContainText('World');
    });
  });

  test.describe('Selection and Deletion', () => {
    test('should select all and delete multiple blocks', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Block 1');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Block 2');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Block 3');
      await page.waitForTimeout(500);

      await page.keyboard.press(`${cmdKey}+A`);
      await page.waitForTimeout(200);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      const editor = EditorSelectors.slateEditor(page);
      await expect(editor).not.toContainText('Block 1');
      await expect(editor).not.toContainText('Block 2');
      await expect(editor).not.toContainText('Block 3');
    });

    test('should replace selection with typed text', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Hello World');
      await page.waitForTimeout(200);

      // Select "World" using word-level selection (more reliable than character-by-character)
      await page.keyboard.press('End');
      await page.keyboard.press(`Shift+${wordJumpKey}+ArrowLeft`);
      await page.waitForTimeout(200);

      await page.keyboard.type('AppFlowy');
      await page.waitForTimeout(200);
      const editor = EditorSelectors.slateEditor(page);
      await expect(editor).toContainText('Hello AppFlowy');
      await expect(editor).not.toContainText('Hello World');
    });

    test.skip('should delete selected text within a block', async () => {
      // TODO: Skipped - Selection and deletion within a block is flaky in headless.
      // The original Cypress test was also skipped.
    });
  });

  test.describe('Document Structure', () => {
    test('should handle text with headings', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Document Title');
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.type('/heading', { delay: 100 });
      await page.waitForTimeout(1000);

      // Try to click Heading 1 from slash menu
      const heading1Button = page.getByTestId('slash-menu-heading1');
      const heading1Visible = await heading1Button.isVisible().catch(() => false);
      if (heading1Visible) {
        await heading1Button.click();
      } else {
        const heading1Text = page.getByText('Heading 1').first();
        const textVisible = await heading1Text.isVisible().catch(() => false);
        if (textVisible) {
          await heading1Text.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }

      await page.waitForTimeout(500);
      await page.keyboard.type('Main Heading', { delay: 50 });

      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.type('Some content text', { delay: 50 });
      await page.waitForTimeout(1000);

      await expect(EditorSelectors.slateEditor(page)).toContainText('Document Title');
      await expect(EditorSelectors.slateEditor(page)).toContainText('Main Heading');
      await expect(EditorSelectors.slateEditor(page)).toContainText('Some content text');
    });

    test('should handle lists', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Shopping List');
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Type /bullet
      await page.keyboard.type('/bullet', { delay: 100 });
      await page.waitForTimeout(1000);

      const bulletButton = page.getByTestId('slash-menu-bulletedList');
      const bulletVisible = await bulletButton.isVisible().catch(() => false);
      if (bulletVisible) {
        await bulletButton.click();
      } else {
        const bulletText = page.getByText('Bulleted list').first();
        const textVisible = await bulletText.isVisible().catch(() => false);
        if (textVisible) {
          await bulletText.click();
        } else {
          await page.keyboard.press('Escape');
          await page.keyboard.type('- ');
        }
      }

      await page.waitForTimeout(500);
      await page.keyboard.type('Apples');
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.type('Bananas');
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.type('Oranges');

      await page.waitForTimeout(1000);
      await expect(EditorSelectors.slateEditor(page)).toContainText('Shopping List');
      await expect(EditorSelectors.slateEditor(page)).toContainText('Apples');
      await expect(EditorSelectors.slateEditor(page)).toContainText('Bananas');
      await expect(EditorSelectors.slateEditor(page)).toContainText('Oranges');
    });
  });
});
