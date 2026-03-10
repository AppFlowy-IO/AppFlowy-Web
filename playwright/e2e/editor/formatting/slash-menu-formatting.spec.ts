import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Slash Menu - Text Formatting Tests
 * Migrated from: cypress/e2e/editor/formatting/slash-menu-formatting.cy.ts
 */
test.describe('Slash Menu - Text Formatting', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should show text formatting options in slash menu', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    // Navigate to Getting started page
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(5000); // Give page time to fully load

    // Focus on editor
    await expect(EditorSelectors.slateEditor(page)).toBeVisible();
    await EditorSelectors.slateEditor(page).click();
    await page.waitForTimeout(1000);

    // Type slash to open menu
    await page.keyboard.type('/');
    await page.waitForTimeout(1000);

    // Verify text formatting options are visible
    await expect(page.getByText('Text')).toBeVisible();
    await expect(page.getByText('Heading 1')).toBeVisible();
    await expect(page.getByText('Heading 2')).toBeVisible();
    await expect(page.getByText('Heading 3')).toBeVisible();

    // Close menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should allow selecting Heading 1 from slash menu', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    // Navigate to Getting started page
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(5000);

    // Focus on editor and move to end
    await expect(EditorSelectors.slateEditor(page)).toBeVisible();
    await EditorSelectors.slateEditor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Type slash to open menu
    await page.keyboard.type('/');
    await page.waitForTimeout(1000);

    // Click Heading 1
    await page.getByText('Heading 1').click();
    await page.waitForTimeout(1000);

    // Type some text
    await page.keyboard.type('Test Heading');
    await page.waitForTimeout(500);

    // Verify the text was added
    await expect(EditorSelectors.slateEditor(page)).toContainText('Test Heading');
  });
});
