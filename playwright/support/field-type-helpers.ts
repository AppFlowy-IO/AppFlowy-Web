/**
 * Field Type helpers for database E2E tests (Playwright)
 * Migrated from: cypress/support/field-type-helpers.ts
 *
 * Provides utilities for changing field types and verifying data transformations
 */
import { Page, APIRequestContext, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  FieldType,
} from './selectors';
import { generateRandomEmail } from './test-config';
import { signInAndWaitForApp } from './auth-flow-helpers';
import { waitForGridReady, createDatabaseView } from './database-ui-helpers';

// Re-export for convenience
export { generateRandomEmail, FieldType };

/**
 * Common beforeEach setup for field type tests
 */
export function setupFieldTypeTest(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return;
    }
  });
}

/**
 * Login and create a new grid for field type testing
 */
export async function loginAndCreateGrid(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await signInAndWaitForApp(page, request, email);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(2000);

  // Create a new grid
  await createDatabaseView(page, 'Grid', 7000);
  await waitForGridReady(page);
}

/**
 * Get field ID by header name
 */
export async function getFieldIdByName(page: Page, fieldName: string): Promise<string> {
  const header = page.locator('[data-testid^="grid-field-header-"]').filter({ hasText: fieldName }).first();
  const testId = await header.getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Click on a field header by field ID to open the field menu
 * Uses .last() because there can be both sticky and regular headers
 */
export async function clickFieldHeaderById(page: Page, fieldId: string): Promise<void> {
  await page.getByTestId(`grid-field-header-${fieldId}`).last().click({ force: true });
  await page.waitForTimeout(800);
}

/**
 * Click on a field header to open the field menu (legacy - by name)
 */
export async function clickFieldHeader(page: Page, fieldName: string): Promise<void> {
  await page.locator('[data-testid^="grid-field-header-"]').filter({ hasText: fieldName }).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Change a field's type by field ID
 */
export async function changeFieldTypeById(page: Page, fieldId: string, newFieldType: FieldType): Promise<void> {
  await clickFieldHeaderById(page, fieldId);

  // Click "Edit property" button
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
  await page.waitForTimeout(800);

  // Click on the type trigger
  await PropertyMenuSelectors.propertyTypeTrigger(page).first().click({ force: true });
  await page.waitForTimeout(500);

  // Select the new field type
  await PropertyMenuSelectors.propertyTypeOption(page, newFieldType).first().click({ force: true });
  await page.waitForTimeout(1000);

  // Close by pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Change a field's type by name (legacy)
 */
export async function changeFieldType(page: Page, fieldName: string, newFieldType: FieldType): Promise<void> {
  await clickFieldHeader(page, fieldName);
  await page.waitForTimeout(500);

  await PropertyMenuSelectors.editPropertyMenuItem(page).click({ force: true });
  await page.waitForTimeout(500);

  await PropertyMenuSelectors.propertyTypeTrigger(page).click({ force: true });
  await page.waitForTimeout(500);

  await PropertyMenuSelectors.propertyTypeOption(page, newFieldType).click({ force: true });
  await page.waitForTimeout(800);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Add a new field with specific type
 * Returns the field ID of the newly created field
 */
export async function addFieldWithType(page: Page, fieldType: FieldType): Promise<string> {
  // Click new property button via JS click to bypass potential overlay
  await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="grid-new-property-button"]');
    if (el) (el as HTMLElement).click();
  });
  await page.waitForTimeout(1200);

  // Hover over property type trigger
  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();
  await trigger.hover();
  await page.waitForTimeout(600);

  // Select the field type
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType).first().scrollIntoViewIfNeeded();
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType).first().click({ force: true });
  await page.waitForTimeout(800);

  // Close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Get the field ID from the last header
  const testId = await GridFieldSelectors.allFieldHeaders(page).last().getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Type text into a cell at the specified index
 * NOTE: Uses Enter to save the value, not Escape.
 */
export async function typeTextIntoCell(page: Page, fieldId: string, cellIndex: number, text: string): Promise<void> {
  // Close any open popover from previous operations
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Click to enter edit mode using JS dispatch to avoid sticky header overlap.
  // In the grid, the header row can be sticky and intercept coordinate-based clicks
  // on cells in the first visible row. Using evaluate() clicks directly on the
  // cell element, matching Cypress's realClick() behavior.
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(cellIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((el) => (el as HTMLElement).click());

  // Wait for the cell to become active
  await page.waitForTimeout(1500);

  // The textarea should appear when the cell becomes active
  const textarea = page.locator('textarea:visible').first();
  await expect(textarea).toBeVisible({ timeout: 8000 });
  await textarea.clear();

  // Replace newlines with Shift+Enter
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.press('Shift+Enter');
    }
    await textarea.pressSequentially(lines[i], { delay: 30 });
  }

  // Press Enter to save
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/**
 * Get text content of a cell by field ID and row index
 */
export async function getCellTextContent(page: Page, fieldId: string, rowIndex: number): Promise<string> {
  const text = await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex).textContent();
  return (text || '').trim();
}

/**
 * Get all cell contents for a field
 */
export async function getAllCellContents(page: Page, fieldId: string): Promise<string[]> {
  const cells = DatabaseGridSelectors.dataRowCellsForField(page, fieldId);
  const count = await cells.count();
  const contents: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await cells.nth(i).textContent();
    contents.push((text || '').trim());
  }
  return contents;
}

/**
 * Click a checkbox cell to toggle it
 */
export async function toggleCheckbox(page: Page, fieldId: string, rowIndex: number): Promise<void> {
  // Use JS evaluate click to bypass sticky header overlap.
  // Playwright's force:true click dispatches at coordinates which may hit the
  // sticky header row instead of the data cell underneath.
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(500);
}

/**
 * Add more rows to the grid
 * Uses the "New row" button at the bottom of the grid for reliability.
 * The row menu dropdown approach (row-accessory-button → row-menu-insert-below)
 * doesn't work reliably in Playwright because force:true click doesn't dispatch
 * events directly to the element like Cypress does.
 */
export async function addRows(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await DatabaseGridSelectors.newRowButton(page).click();
    await page.waitForTimeout(500);
  }
}

/**
 * Assert the number of visible data rows in the grid
 */
export async function assertRowCount(page: Page, expectedCount: number): Promise<void> {
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(expectedCount, { timeout: 10000 });
}

/**
 * Get the primary field ID (first column, Name field)
 */
export async function getPrimaryFieldId(page: Page): Promise<string> {
  const testId = await page.locator('[data-testid^="grid-field-header-"]').first().getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Field type display names for logging
 */
export const FieldTypeNames: Record<number, string> = {
  0: 'RichText',
  1: 'Number',
  2: 'DateTime',
  3: 'SingleSelect',
  4: 'MultiSelect',
  5: 'Checkbox',
  6: 'URL',
  7: 'Checklist',
  8: 'LastEditedTime',
  9: 'CreatedTime',
  10: 'Relation',
  11: 'Summary',
  12: 'Translate',
  13: 'Time',
  14: 'Media',
};
