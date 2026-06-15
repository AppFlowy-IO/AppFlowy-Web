import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page/flows';

/**
 * Editor Commands Tests
 * Migrated from: cypress/e2e/editor/commands/editor_commands.cy.ts
 */
test.describe('Editor Commands', () => {
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

  test('should Undo typing', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Undo Me');
    await page.waitForTimeout(500);
    await expect(page.getByText('Undo Me')).toBeVisible();

    // Undo
    if (isMac) {
      await page.keyboard.press('Meta+z');
    } else {
      await page.keyboard.press('Control+z');
    }
    await page.waitForTimeout(500);

    await expect(EditorSelectors.slateEditor(page)).not.toContainText('Undo Me');
  });

  test('should Redo typing', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Redo Me');
    await page.waitForTimeout(2000);
    await expect(page.getByText('Redo Me')).toBeVisible();

    // Undo via keyboard
    await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(1000);
    await expect(page.getByText('Redo Me')).not.toBeVisible();

    // Redo via editor API — Playwright's synthesized Meta+Shift+z does not
    // trigger Slate's is-hotkey redo handler reliably (unlike Cypress's
    // cy.realPress which sends OS-level key events). Use programmatic redo.
    await page.evaluate(() => {
      const editors = (window as any).__TEST_EDITORS__;
      if (editors) {
        const editor = Object.values(editors)[0] as any;
        if (editor?.redo) editor.redo();
      }
    });
    await page.waitForTimeout(1000);

    await expect(page.getByText('Redo Me')).toBeVisible();
  });

  test('should insert soft break on Shift+Enter', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Line 1');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('Line 2');

    // Soft break keeps content in a single paragraph block
    await expect(BlockSelectors.blockByType(page, 'paragraph')).toHaveCount(1);
    await expect(page.getByText('Line 1')).toBeVisible();
    await expect(page.getByText('Line 2')).toBeVisible();
  });
});
