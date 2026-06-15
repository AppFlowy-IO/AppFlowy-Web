import { test, expect } from '@playwright/test';
import { EditorSelectors, SlashCommandSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Panel Selection - Shift+Arrow Keys Tests
 * Migrated from: cypress/e2e/editor/basic/panel_selection.cy.ts
 */
test.describe('Panel Selection - Shift+Arrow Keys', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: sign in, navigate to Getting started, clear editor.
   */
  async function setupEditor(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(2000);

    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
  }

  test.describe('Slash Panel Selection', () => {
    test('should allow Shift+Arrow selection when slash panel is open', async ({ page, request }) => {
      await setupEditor(page, request);

      // Type some text first
      await page.keyboard.type('Hello World');
      await page.waitForTimeout(200);

      // Open slash panel
      await page.keyboard.type('/');
      await page.waitForTimeout(500);

      // Verify slash panel is open
      await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();

      // Type search text
      await page.keyboard.type('head');
      await page.waitForTimeout(200);

      // Now try Shift+Left to select text - this should work after the fix
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForTimeout(200);

      // Close panel first
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // The text "head" should still be visible (since we selected but didn't delete)
      await expect(EditorSelectors.slateEditor(page)).toContainText('head');
    });

    test('should allow Shift+Right selection when slash panel is open', async ({ page, request }) => {
      await setupEditor(page, request);

      // Type some text first
      await page.keyboard.type('Test Content');
      await page.waitForTimeout(200);

      // Move cursor to after "Test "
      await page.keyboard.press('Home');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForTimeout(200);

      // Open slash panel
      await page.keyboard.type('/');
      await page.waitForTimeout(500);

      // Verify slash panel is open
      await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();

      // Type search text
      await page.keyboard.type('para');
      await page.waitForTimeout(200);

      // Try Shift+Right to extend selection
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');
      await page.waitForTimeout(200);

      // Close panel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Verify editor still has content
      await expect(EditorSelectors.slateEditor(page)).toContainText('Test');
    });

    test('should still block plain Arrow keys when panel is open', async ({ page, request }) => {
      await setupEditor(page, request);

      // Type some text
      await page.keyboard.type('Sample Text');
      await page.waitForTimeout(200);

      // Open slash panel
      await page.keyboard.type('/');
      await page.waitForTimeout(500);

      // Verify slash panel is open
      await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();

      // Type search text
      await page.keyboard.type('heading');
      await page.waitForTimeout(200);

      // Press plain ArrowLeft (without Shift) - should be blocked
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200);

      // Panel should still be open (cursor didn't move away from trigger position)
      await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();

      // Close panel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Verify content
      await expect(EditorSelectors.slateEditor(page)).toContainText('Sample Text');
    });
  });

  test.describe('Mention Panel Selection', () => {
    test('should allow Shift+Arrow selection when mention panel is open', async ({ page, request }) => {
      await setupEditor(page, request);

      // Type some text first
      await page.keyboard.type('Hello ');
      await page.waitForTimeout(200);

      // Open mention panel with @
      await page.keyboard.type('@');
      await page.waitForTimeout(500);

      // Type to search
      await page.keyboard.type('test');
      await page.waitForTimeout(200);

      // Try Shift+Left to select - should work after fix
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForTimeout(200);

      // Close panel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Editor should still have content
      await expect(EditorSelectors.slateEditor(page)).toContainText('Hello');
    });
  });
});
