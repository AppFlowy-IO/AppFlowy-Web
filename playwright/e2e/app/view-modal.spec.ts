import { test, expect } from '@playwright/test';
import { AddPageSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * View Modal Tests
 * Migrated from: cypress/e2e/app/view-modal.cy.ts
 */
test.describe('View Modal', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('creates a document and allows editing in ViewModal', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const modalText = `modal-test-${Date.now()}`;

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 1: Create a new document (opens ViewModal)
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Step 2: Verify ViewModal is open
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });

    // Step 3: Verify URL updated with new document
    await expect(page).toHaveURL(/\/app\/[^/]+\/[^/]+/, { timeout: 15000 });

    // Step 4: Type text in ViewModal editor
    const dialog = page.locator('[role="dialog"]');
    const editor = dialog.locator('[data-slate-editor="true"]').first();
    await editor.click({ position: { x: 5, y: 5 }, force: true });
    await page.keyboard.type(modalText);
    await page.waitForTimeout(1500);

    // Step 5: Verify text appears in editor
    await expect(
      dialog.locator('[data-slate-editor="true"]').first()
    ).toContainText(modalText, { timeout: 10000 });
  });
});
