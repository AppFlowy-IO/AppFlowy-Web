import { Page, Locator, expect } from '@playwright/test';
import { DropdownSelectors } from './selectors';

/**
 * General test helper utilities for Playwright E2E tests
 * Migrated from: cypress/support/test-helpers.ts
 */

/**
 * Console message types captured by Cypress's console-logger.
 * Cypress only intercepts console.log, console.error, console.warn
 * (NOT console.debug or console.info). Playwright uses 'warning' for
 * console.warn.
 */
export const CYPRESS_CAPTURED_TYPES = new Set(['log', 'error', 'warning']);

/**
 * Closes any open modals or dialogs by pressing Escape
 */
export async function closeModalsIfOpen(page: Page): Promise<void> {
  const hasModal = await page.locator('[role="dialog"], .MuiDialog-container, [data-testid*="modal"]').count();
  if (hasModal > 0) {
    console.log('Closing open modal dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
}

/**
 * Wait for the dropdown menu to appear and click a menu item.
 * Used after clicking AddPageSelectors.inlineAddButton.
 *
 * @param hasText - If provided, clicks the menu item matching this text (e.g. 'Grid').
 *                  If omitted, clicks the first menu item (Document).
 */
export async function clickAddPageMenuItem(page: Page, hasText?: string): Promise<void> {
  const dropdown = DropdownSelectors.content(page);
  await expect(dropdown).toBeVisible({ timeout: 5000 });
  const menuItem = hasText
    ? dropdown.locator('[role="menuitem"]').filter({ hasText })
    : dropdown.locator('[role="menuitem"]').first();
  await menuItem.click({ force: true });
}

/**
 * Dismiss a dialog by pressing Escape, if one is currently open.
 * Waits for the dialog to become hidden before returning.
 */
export async function dismissDialogIfPresent(page: Page): Promise<void> {
  if (await page.locator('[role="dialog"]').count() > 0) {
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
}

/**
 * Standardized logging utilities for test output
 */
export const testLog = {
  step: (num: number, msg: string) => console.log(`=== Step ${num}: ${msg} ===`),
  info: (msg: string) => console.log(msg),
  success: (msg: string) => console.log(`✓ ${msg}`),
  error: (msg: string) => console.error(`✗ ${msg}`),
  warn: (msg: string) => console.warn(`⚠ ${msg}`),
  data: (label: string, value: unknown) => console.log(`${label}: ${JSON.stringify(value, null, 2)}`),
  testStart: (testName: string) =>
    console.log(`\n╔════════════════════════════════════════════════════════════════╗\n║  TEST: ${testName.padEnd(55)}║\n╚════════════════════════════════════════════════════════════════╝`),
  testEnd: (testName: string) => console.log(`\n✅ TEST COMPLETED: ${testName}\n`),
};

/**
 * Generate a random string for test data
 */
export function randomString(length = 8): string {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
}

/**
 * Check if an element exists without failing the test
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}
