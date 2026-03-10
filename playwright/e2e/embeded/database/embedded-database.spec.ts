/**
 * Embedded Database Tests
 *
 * Tests inserting and editing embedded database via slash command.
 * Migrated from: cypress/e2e/embeded/database/embedded-database.cy.ts
 */
import { test, expect } from '@playwright/test';
import { BlockSelectors, DatabaseGridSelectors, SlashCommandSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database', () => {
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

  test('inserts and edits embedded database via slash command', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 1: Create a document page
    const docViewId = await createDocumentPageAndNavigate(page);

    // Step 2: Open slash menu and insert Grid database
    const editor = page.locator(`#editor-${docViewId}`);
    await expect(editor).toBeVisible();
    await editor.click({ position: { x: 200, y: 100 }, force: true });
    await editor.pressSequentially('/', { delay: 50 });
    await page.waitForTimeout(500);

    const slashPanel = SlashCommandSelectors.slashPanel(page);
    await expect(slashPanel).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });

    // Step 3: Verify embedded database block appears
    await expect(
      editor.locator(BlockSelectors.blockSelector('grid'))
    ).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);

    // Step 4: Verify database grid is interactive
    const dbGrid = editor.locator('[data-testid="database-grid"]');
    await expect(dbGrid.getByText('New row')).toBeVisible();
    await expect(dbGrid).toContainText('Name');
    await expect(dbGrid).toContainText('Type');
  });
});
