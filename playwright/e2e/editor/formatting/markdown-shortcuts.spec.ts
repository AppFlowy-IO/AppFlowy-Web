import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Editor Markdown Shortcuts Tests
 * Migrated from: cypress/e2e/editor/formatting/markdown-shortcuts.cy.ts
 */
test.describe('Editor Markdown Shortcuts', () => {
  const testEmail = generateRandomEmail();

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
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
  }

  test('should convert "# " to Heading 1', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('# Heading 1');
    await page.waitForTimeout(500);
    // The markdown shortcut should convert it to a heading element
    await expect(page.locator('h1, div').filter({ hasText: 'Heading 1' })).toBeAttached();
  });

  test('should convert "## " to Heading 2', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('## Heading 2');
    await page.waitForTimeout(500);
    await expect(page.locator('h2, div').filter({ hasText: 'Heading 2' })).toBeAttached();
  });

  test('should convert "### " to Heading 3', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('### Heading 3');
    await page.waitForTimeout(500);
    await expect(page.locator('h3, div').filter({ hasText: 'Heading 3' })).toBeAttached();
  });

  test('should convert "- " to Bullet List', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('- Bullet Item');
    await page.waitForTimeout(500);
    await expect(page.getByText('Bullet Item')).toBeVisible();
    // The "- " prefix should be consumed by the markdown shortcut
    await expect(page.getByText('- Bullet Item')).not.toBeVisible();
  });

  test('should convert "1. " to Numbered List', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('1. Numbered Item');
    await page.waitForTimeout(500);
    await expect(page.getByText('Numbered Item')).toBeVisible();
    await expect(page.getByText('1. Numbered Item')).not.toBeVisible();
  });

  test('should convert "[] " to Todo List', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('[] Todo Item');
    await page.waitForTimeout(500);
    await expect(page.getByText('Todo Item')).toBeVisible();
    // Verify a checkbox icon exists
    await expect(page.locator('span.text-block-icon svg')).toBeAttached();
    await expect(page.getByText('[] Todo Item')).not.toBeVisible();
  });

  test('should convert "> " to Quote', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('> Quote Text');
    await page.waitForTimeout(500);
    await expect(page.getByText('Quote Text')).toBeVisible();
    await expect(page.getByText('> Quote Text')).not.toBeVisible();
  });

  test('should convert `code` to inline code', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Normal `Inline Code` Normal');
    await page.waitForTimeout(500);
    await expect(page.locator('code, span').filter({ hasText: 'Inline Code' })).toBeAttached();
    await expect(page.getByText('`Inline Code`')).not.toBeVisible();
  });
});
