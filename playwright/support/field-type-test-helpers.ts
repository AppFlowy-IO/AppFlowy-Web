/**
 * Shared helpers for field type E2E tests (Playwright)
 * Migrated from: cypress/support/field-type-test-helpers.ts
 *
 * These helpers are used across multiple test files to avoid code duplication.
 */
import { Page, Locator } from '@playwright/test';
import {
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
} from './selectors';
import { generateRandomEmail, setupPageErrorHandling } from './test-config';
import { loginAndCreateGrid, typeTextIntoCell } from './filter-test-helpers';

// Re-export shared helpers for backwards compatibility
export { generateRandomEmail, setupPageErrorHandling, loginAndCreateGrid, typeTextIntoCell };

/**
 * Common beforeEach setup for field type tests.
 * @deprecated Use `setupPageErrorHandling(page)` from `test-config` instead.
 */
export function setupFieldTypeTest(page: Page): void {
  setupPageErrorHandling(page);
}

/**
 * Helper to extract fieldId from the last field header's data-testid
 */
export async function getLastFieldId(page: Page): Promise<string> {
  const testId = await GridFieldSelectors.allFieldHeaders(page)
    .last()
    .getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Helper to get all cells for a specific field (column)
 */
export function getCellsForField(page: Page, fieldId: string): Locator {
  return DatabaseGridSelectors.cellsForField(page, fieldId);
}

/**
 * Helper to get data row cells for a field (DATA ROWS ONLY)
 */
export function getDataRowCellsForField(page: Page, fieldId: string): Locator {
  return DatabaseGridSelectors.dataRowCellsForField(page, fieldId);
}

/**
 * Add a new property/field of the specified type
 */
export async function addNewProperty(page: Page, fieldType: number): Promise<void> {
  await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="grid-new-property-button"]');
    if (el) (el as HTMLElement).click();
  });
  await page.waitForTimeout(1200);

  // Hover over type trigger to open submenu
  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();
  await trigger.hover();
  await page.waitForTimeout(600);

  // Select the field type
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType)
    .first()
    .scrollIntoViewIfNeeded();
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType)
    .first()
    .click({ force: true });
  await page.waitForTimeout(800);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Edit the last property/field to change its type
 */
export async function editLastProperty(page: Page, newType: number): Promise<void> {
  await GridFieldSelectors.allFieldHeaders(page).last().click({ force: true });
  await page.waitForTimeout(600);

  const editMenuItem = PropertyMenuSelectors.editPropertyMenuItem(page);
  if ((await editMenuItem.count()) > 0) {
    await editMenuItem.click({ force: true });
    await page.waitForTimeout(500);
  }

  // Hover over type trigger to open submenu
  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();
  await trigger.hover();
  await page.waitForTimeout(600);

  await PropertyMenuSelectors.propertyTypeOption(page, newType)
    .first()
    .scrollIntoViewIfNeeded();
  await PropertyMenuSelectors.propertyTypeOption(page, newType)
    .first()
    .click({ force: true });
  await page.waitForTimeout(800);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
