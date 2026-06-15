/**
 * Database Grid Edit Operations E2E Tests
 *
 * Tests creating a grid, refreshing, editing first row, and verifying persistence.
 * Migrated from: cypress/e2e/database/grid-edit-operations.cy.ts
 */
import { test, expect } from '@playwright/test';
import { AddPageSelectors, DatabaseGridSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';

test.describe('Database Grid Edit Operations', () => {
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

  test('should create a database grid page, refresh, edit first row, and verify the changes', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user in the app
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // When: creating a new grid database via the add page menu
    await expect(AddPageSelectors.inlineAddButton(page).first()).toBeVisible({ timeout: 10000 });
    await AddPageSelectors.inlineAddButton(page).first().click();
    await page.waitForTimeout(1000);
    await expect(AddPageSelectors.addGridButton(page)).toBeVisible({ timeout: 10000 });
    await AddPageSelectors.addGridButton(page).click();
    await page.waitForTimeout(8000);

    // Then: the grid should persist after a page refresh
    const currentUrl = page.url();
    await page.reload();
    await page.waitForTimeout(5000);

    const urlParts = currentUrl.split('/');
    const lastPart = urlParts[urlParts.length - 1] || '';
    if (lastPart) {
      await expect(page).toHaveURL(new RegExp(lastPart));
    }

    await waitForGridReady(page);

    // When: editing the first cell with test text
    await page.waitForTimeout(2000);
    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(1000);

    const testText = 'Test Edit ' + Date.now();
    await page.keyboard.type(testText);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Then: the edit should persist after another refresh
    await page.reload();
    await page.waitForTimeout(5000);
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
    await expect(DatabaseGridSelectors.grid(page)).toContainText(testText.substring(0, 10));
  });
});
