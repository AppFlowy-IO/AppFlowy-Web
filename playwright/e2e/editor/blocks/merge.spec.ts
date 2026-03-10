import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Block Merging Tests
 * Migrated from: cypress/e2e/editor/blocks/merge.cy.ts
 */
test.describe('Block Merging', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should merge next block using Backspace at start of block', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(3000);

    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Setup 2 blocks
    await page.keyboard.type('Block 1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Block 2');
    await page.waitForTimeout(500);

    // Click Block 2 to focus
    await page.getByText('Block 2').click();
    await page.waitForTimeout(200);

    // Move to start of line
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);

    // Backspace to merge into Block 1
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Verify merge
    await expect(page.getByText('Block 1Block 2')).toBeVisible();
  });
});
