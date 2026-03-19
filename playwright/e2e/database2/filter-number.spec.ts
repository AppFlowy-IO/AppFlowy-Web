/**
 * Number Filter Tests (Desktop Parity)
 * Migrated from: cypress/e2e/database2/filter-number.cy.ts
 *
 * Desktop test data (v020GridFileName):
 * - 10 rows total
 * - Number column: -1, -2, 0.1, 0.2, 1, 2, 10, 11, 12, (empty)
 * - 9 rows with numbers, 1 row empty
 */
import { test, expect } from '@playwright/test';
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  clickFilterChip,
  changeFilterCondition,
  deleteFilter,
  assertRowCount,
  NumberFilterCondition,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
} from '../../support/selectors';
import { addFieldWithType, addRows, FieldType } from '../../support/field-type-helpers';

/**
 * Type a number into a cell (uses input, not textarea, for number cells)
 */
async function typeNumberIntoCell(
  page: import('@playwright/test').Page,
  fieldId: string,
  cellIndex: number,
  value: string
) {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(cellIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await cell.click(); // Double click to enter edit mode

  const input = page.locator('input:visible, textarea:visible').first();
  await expect(input).toBeVisible({ timeout: 8000 });
  await input.clear();
  await input.pressSequentially(value, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/**
 * Setup test data matching desktop v020 database:
 * Numbers: -1, -2, 0.1, 0.2, 1, 2, 10, 11, 12, (empty) - 10 rows
 */
async function setupV020NumberData(page: import('@playwright/test').Page, numberFieldId: string) {
  const numbers = ['-1', '-2', '0.1', '0.2', '1', '2', '10', '11', '12'];

  // Add 7 more rows (default grid has 3 rows, we need 10)
  await addRows(page, 7);

  // Type numbers into the first 9 rows (row 10 stays empty)
  for (let i = 0; i < numbers.length; i++) {
    await typeNumberIntoCell(page, numberFieldId, i, numbers[i]);
  }
}

test.describe('Database Number Filter Tests (Desktop Parity)', () => {
  test('number filter - Equal condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    await assertRowCount(page, 1);
  });

  test('number filter - NotEqual condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.NotEqual);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show all rows except the one with 1 (8 rows - excludes 1 and empty)
    await assertRowCount(page, 8);
  });

  test('number filter - GreaterThan condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows > 1: 2, 10, 11, 12 (4 rows)
    await assertRowCount(page, 4);
  });

  test('number filter - LessThan condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.LessThan);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows < 1: -2, -1, 0.1, 0.2 (4 rows)
    await assertRowCount(page, 4);
  });

  test('number filter - GreaterThanOrEqualTo condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.GreaterThanOrEqualTo);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows >= 1: 1, 2, 10, 11, 12 (5 rows)
    await assertRowCount(page, 5);
  });

  test('number filter - LessThanOrEqualTo condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.LessThanOrEqualTo);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows <= 1: -2, -1, 0.1, 0.2, 1 (5 rows)
    await assertRowCount(page, 5);
  });

  test('number filter - NumberIsEmpty condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.NumberIsEmpty);

    // Should show rows with empty number (1 row)
    await assertRowCount(page, 1);
  });

  test('number filter - NumberIsNotEmpty condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.NumberIsNotEmpty);

    // Should show rows with non-empty number (9 rows)
    await assertRowCount(page, 9);
  });

  test('number filter - negative numbers', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.LessThan);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('0', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show negative numbers: -2, -1 (2 rows)
    await assertRowCount(page, 2);
  });

  test('number filter - decimal numbers', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.LessThan);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show 0.1, 0.2, -1, -2 (4 rows with values < 1)
    await assertRowCount(page, 4);
  });

  test('number filter - delete filter restores all rows', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Numbers');
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('100', { delay: 30 });
    await page.waitForTimeout(500);

    // No rows match > 100
    await assertRowCount(page, 0);

    // Delete the filter
    await clickFilterChip(page);
    await deleteFilter(page);

    // All rows should be visible again
    await assertRowCount(page, 10);
  });

  test('number filter - change condition dynamically', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(500);
    await setupV020NumberData(page, numberFieldId);

    await assertRowCount(page, 10);

    // Add filter with Equal
    await addFilterByFieldName(page, 'Numbers');
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('1', { delay: 30 });
    await page.waitForTimeout(500);
    await assertRowCount(page, 1);

    // Change to GreaterThan
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    // Value is still 1, so should show 2, 10, 11, 12 (4 rows)
    await assertRowCount(page, 4);

    // Change to NumberIsEmpty (content should be ignored)
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeFilterCondition(page, NumberFilterCondition.NumberIsEmpty);
    await assertRowCount(page, 1);
  });
});
