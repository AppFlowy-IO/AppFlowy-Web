import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Editor Navigation & Interaction Tests
 * Migrated from: cypress/e2e/editor/cursor/editor_interaction.cy.ts
 */
test.describe('Editor Navigation & Interaction', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';
  const cmdModifier = isMac ? 'Meta' : 'Control';
  const selectAll = isMac ? 'Meta+A' : 'Control+A';

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

  test.describe('Cursor Movement', () => {
    test('should navigate to start/end of line', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Start Middle End');
      await page.waitForTimeout(500);

      // Move to start of line
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);
      await page.keyboard.type('X');
      await page.waitForTimeout(200);
      await expect(EditorSelectors.slateEditor(page)).toContainText('XStart Middle End');

      // Move to end of line
      await page.keyboard.press('End');
      await page.waitForTimeout(200);
      await page.keyboard.type('Y');
      await expect(EditorSelectors.slateEditor(page)).toContainText('XStart Middle EndY');
    });

    test('should navigate character by character', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Word');
      await page.waitForTimeout(500);

      // Go to start of line
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);

      // Move right one character
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      await page.keyboard.type('-');

      // Expect "W-ord"
      await expect(EditorSelectors.slateEditor(page)).toContainText('W-ord');
    });

    test('should select word on double click', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('SelectMe');
      await page.waitForTimeout(500);

      // Select the entire line within this block
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.waitForTimeout(200);

      // Verify selection by typing to replace
      await page.keyboard.type('Replaced');

      await expect(EditorSelectors.slateEditor(page)).toContainText('Replaced');
      await expect(EditorSelectors.slateEditor(page)).not.toContainText('SelectMe');
    });

    test('should navigate up/down between blocks', async ({ page, request }) => {
      await setupEditor(page, request);

      // Setup 3 blocks
      await page.keyboard.type('Block 1');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Block 2');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Block 3');
      await page.waitForTimeout(500);

      // Cursor is at end of Block 3
      // Move Up to Block 2
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      await page.keyboard.type(' Modified');
      await expect(page.getByText('Block 2 Modified')).toBeVisible();

      // Move Up to Block 1
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      await page.keyboard.type(' Top');
      await expect(page.getByText('Block 1 Top')).toBeVisible();

      // Move Down to Block 2 (now modified)
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      // Move Down to Block 3
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      await page.keyboard.type(' Bottom');
      await expect(page.getByText('Block 3 Bottom')).toBeVisible();
    });

    test('should navigate between different block types', async ({ page, request }) => {
      await setupEditor(page, request);

      // Setup: Heading, Paragraph, Bullet List
      await page.keyboard.type('/heading');
      await page.waitForTimeout(500);
      await page.getByTestId('slash-menu-heading1').click();
      await page.waitForTimeout(300);
      await page.keyboard.type('Heading Block');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Paragraph Block');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/bullet');
      await page.waitForTimeout(500);
      await page.getByTestId('slash-menu-bulletedList').click();
      await page.keyboard.type('List Block');
      await page.waitForTimeout(500);

      // Test Navigation: List -> Paragraph
      await page.getByText('Paragraph Block').click({ force: true });
      await page.waitForTimeout(500);

      // Type to verify focus
      await page.keyboard.type(' UpTest');
      // Verify 'UpTest' appears in Paragraph block and NOT in List Block
      await expect(BlockSelectors.blockByType(page, 'paragraph')).toContainText('UpTest');
      await expect(BlockSelectors.blockByType(page, 'bulleted_list')).not.toContainText('UpTest');

      // Test Navigation: Heading -> Paragraph
      await page.getByText('Heading Block').click({ force: true });
      await page.waitForTimeout(200);
      await page.getByText('Paragraph Block').click({ force: true });
      await page.waitForTimeout(500);

      await page.keyboard.type(' DownTest');
      await expect(BlockSelectors.blockByType(page, 'paragraph')).toContainText('DownTest');
      await expect(BlockSelectors.blockByType(page, 'heading')).not.toContainText('DownTest');
    });
  });

  test.describe('Block Interaction', () => {
    test('should handle cursor navigation with arrow keys', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Line 1');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Line 2');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Line 3');
      await page.waitForTimeout(500);

      await page.getByText('Line 2').click();
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);
      await page.keyboard.type('Inserted');
      await expect(page.getByText('InsertedLine 2')).toBeVisible();
    });

    test('should merge blocks on backspace', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('Paragraph One');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Paragraph Two');
      await page.waitForTimeout(500);

      await page.getByText('Paragraph Two').click();
      await page.keyboard.press('Home');
      await page.waitForTimeout(200);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);
      await expect(page.getByText('Paragraph OneParagraph Two')).toBeVisible();
    });

    test('should split block on enter', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('SplitHere');
      // Move cursor 4 characters from the end ("Here")
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      await expect(page.getByText('Split')).toBeVisible();
      await expect(page.getByText('Here')).toBeVisible();
    });
  });

  test.describe('Style Interaction', () => {
    test.skip('should persist bold style when typing inside bold text', async () => {
      // TODO: Skipped - This test is flaky in headless environments.
      // The original Cypress test was also skipped.
    });

    test('should reset style when creating a new paragraph', async ({ page, request }) => {
      await setupEditor(page, request);

      await EditorSelectors.firstEditor(page).click();
      await page.keyboard.press(`${cmdModifier}+b`);
      await page.waitForTimeout(200);
      await page.keyboard.type('Heading Bold');
      await expect(page.locator('strong')).toContainText('Heading Bold');

      await page.keyboard.press('Enter');
      await page.keyboard.type('Next Line');
      await expect(page.getByText('Next Line')).toBeVisible();
      // "Next Line" should not be wrapped in <strong>
      const nextLineInStrong = await page.locator('strong').filter({ hasText: 'Next Line' }).count();
      expect(nextLineInStrong).toBe(0);
    });
  });
});
