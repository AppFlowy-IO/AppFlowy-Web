import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Editor Lists Manipulation Tests
 * Migrated from: cypress/e2e/editor/lists/editor_lists.cy.ts
 */
test.describe('Editor Lists Manipulation', () => {
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
    await page.waitForTimeout(2000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  test.describe('List Items', () => {
    test('should indent and outdent list items', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('- Item 1');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Item 2');
      await page.waitForTimeout(200);

      // Both items should be at root level before indent
      const item2Block = page.locator('[data-block-type="bulleted_list"]', { hasText: 'Item 2' });
      await expect(item2Block).toBeVisible();

      // Indent with Tab — Item 2 should become a child of Item 1
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);

      // After indent: Item 2's parent block should be Item 1 (a bulleted_list)
      const item1Block = page.locator('[data-block-type="bulleted_list"]', { hasText: 'Item 1' });
      const nestedItem2 = item1Block.locator('[data-block-type="bulleted_list"]', { hasText: 'Item 2' });
      await expect(nestedItem2).toBeVisible();

      // Outdent with Shift+Tab — Item 2 should return to root level
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(200);

      // After outdent: Item 2 should no longer be nested inside Item 1
      await expect(nestedItem2).not.toBeVisible();
      // Both items should still exist at top level
      await expect(item1Block).toBeVisible();
      await expect(item2Block).toBeVisible();
    });

    test('should convert empty list item to paragraph on Enter', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('- Item 1');
      await page.keyboard.press('Enter');
      // Press Enter on empty list item to convert to paragraph
      await page.keyboard.press('Enter');
      await page.keyboard.type('Paragraph Text');
      await expect(page.getByText('Paragraph Text')).toBeVisible();
    });

    test('should toggle todo checkbox', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('[] Todo Item');
      await page.waitForTimeout(200);

      // Click the checkbox icon to toggle
      await page.locator('span.text-block-icon').first().click();
      await page.waitForTimeout(200);
      await expect(page.locator('.checked')).toBeAttached();

      // Click again to uncheck
      await page.locator('span.text-block-icon').first().click();
      await expect(page.locator('.checked')).not.toBeAttached();
    });
  });

  test.describe('Slash Menu Lists', () => {
    test('should show list options in slash menu', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/');
      await page.waitForTimeout(1000);
      await expect(page.getByTestId('slash-menu-bulletedList')).toBeVisible();
      await expect(page.getByTestId('slash-menu-numberedList')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('should allow selecting Bulleted list from slash menu', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/');
      await page.waitForTimeout(1000);
      await page.getByTestId('slash-menu-bulletedList').click();
      await page.waitForTimeout(1000);
      await page.keyboard.type('Test bullet item');
      await page.waitForTimeout(500);
      await expect(EditorSelectors.slateEditor(page)).toContainText('Test bullet item');
    });
  });
});
