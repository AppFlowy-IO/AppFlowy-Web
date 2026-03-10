import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Slash Menu - Text Formatting Tests
 * Migrated from: cypress/e2e/editor/formatting/slash-menu-formatting.cy.ts
 */
test.describe('Slash Menu - Text Formatting', () => {
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

  test('should show text formatting options in slash menu', async ({ page, request }) => {
    await setupEditor(page, request);

    // Type slash to open menu
    await page.keyboard.type('/');
    await page.waitForTimeout(1000);

    // Verify text formatting options are visible
    await expect(page.getByTestId('slash-menu-text')).toBeVisible();
    await expect(page.getByTestId('slash-menu-heading1')).toBeVisible();
    await expect(page.getByTestId('slash-menu-heading2')).toBeVisible();
    await expect(page.getByTestId('slash-menu-heading3')).toBeVisible();

    // Close menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should allow selecting Heading 1 from slash menu', async ({ page, request }) => {
    await setupEditor(page, request);

    // Type slash to open menu
    await page.keyboard.type('/');
    await page.waitForTimeout(1000);

    // Click Heading 1
    await page.getByTestId('slash-menu-heading1').click();
    await page.waitForTimeout(1000);

    // Type some text
    await page.keyboard.type('Test Heading');
    await page.waitForTimeout(500);

    // Verify the text was added
    await expect(EditorSelectors.slateEditor(page)).toContainText('Test Heading');
  });
});
