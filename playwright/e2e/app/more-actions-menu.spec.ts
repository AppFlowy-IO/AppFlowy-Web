import { test, expect } from '@playwright/test';
import { DropdownSelectors, PageSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Tests for More Actions menu after removing unnecessary useMemo.
 * Verifies that the menu renders correctly and all items function as expected.
 * Migrated from: cypress/e2e/app/more-actions-menu.cy.ts
 */
test.describe('More Actions Menu', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });
  });

  test('should render all menu items correctly in More Actions popover', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Find a page and hover to reveal more actions button
    await PageSelectors.itemByName(page, 'Getting started').locator('> div').first().hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the more actions button
    await PageSelectors.moreActionsButton(page).first().click({ force: true });

    // Verify the menu is visible
    await expect(DropdownSelectors.content(page)).toBeVisible();

    // Verify core menu items are rendered
    const menuContent = DropdownSelectors.content(page);
    await expect(menuContent.getByText('Delete')).toBeVisible();
    await expect(menuContent.getByText('Duplicate')).toBeVisible();
    await expect(menuContent.getByText('Move to')).toBeVisible();
  });

  test('should close menu on Escape key', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Find a page and hover to reveal more actions button
    await PageSelectors.itemByName(page, 'Getting started').locator('> div').first().hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the more actions button to open menu
    await PageSelectors.moreActionsButton(page).first().click({ force: true });

    // Verify menu is open
    await expect(DropdownSelectors.content(page)).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify menu is closed
    await expect(DropdownSelectors.content(page)).not.toBeVisible();
  });

  test('should not have render errors after removing useMemo', async ({ page, request }) => {
    // TODO: cy.getConsoleLogs() is a Cypress-specific custom command.
    // In Playwright, we collect console messages via page.on('console', ...).
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text().toLowerCase();
        if (
          text.includes('moreactions') ||
          text.includes('cannot read property') ||
          text.includes('is not a function')
        ) {
          consoleErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Open more actions menu
    await PageSelectors.itemByName(page, 'Getting started').locator('> div').first().hover({ force: true });
    await page.waitForTimeout(1000);

    await PageSelectors.moreActionsButton(page).first().click({ force: true });
    await expect(DropdownSelectors.content(page)).toBeVisible();

    // Check for render errors
    expect(consoleErrors.length).toBe(0);
  });
});
