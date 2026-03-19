/**
 * Text Filter Tests (Desktop Parity)
 * Migrated from: cypress/e2e/database2/filter-text.cy.ts
 *
 * Desktop test data (v020GridFileName):
 * - 10 rows total
 * - Name column: A, B, C, D, E, (empty), (empty), (empty), (empty), (empty)
 * - 5 rows with names (A-E), 5 rows with empty names
 */
import { test, expect } from '@playwright/test';
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  changeFilterCondition,
  deleteFilter,
  assertRowCount,
  getPrimaryFieldId,
  TextFilterCondition,
  generateRandomEmail,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  RowControlsSelectors,
} from '../../support/selectors';
import { addRows } from '../../support/field-type-helpers';

/**
 * Setup test data matching desktop v020 database:
 * Names: A, B, C, D, E, and 5 empty rows (10 total)
 */
async function setupV020TestData(page: import('@playwright/test').Page, primaryFieldId: string) {
  // Default grid has 3 rows, we need 10 total => add 7 more
  await addRows(page, 7);

  // Type text into the first 5 rows (rows 6-10 stay empty)
  const names = ['A', 'B', 'C', 'D', 'E'];
  for (let i = 0; i < names.length; i++) {
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).nth(i);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await cell.click(); // Double click to enter edit mode

    const textarea = page.locator('textarea:visible').first();
    await expect(textarea).toBeVisible({ timeout: 8000 });
    await textarea.clear();
    await textarea.pressSequentially(names[i], { delay: 30 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

test.describe('Database Text Filter Tests (Desktop Parity)', () => {
  test('text filter - TextIs condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    // Add filter on Name field
    await addFilterByFieldName(page, 'Name');

    // Change condition to TextIs
    await changeFilterCondition(page, TextFilterCondition.TextIs);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should only show the row with exactly "A"
    await assertRowCount(page, 1);
  });

  test('text filter - TextIsNot condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextIsNot);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show all rows except "A" (9 rows)
    await assertRowCount(page, 9);
  });

  test('text filter - TextContains condition (default)', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    // Default condition is TextContains
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show row with "A"
    await assertRowCount(page, 1);
  });

  test('text filter - TextDoesNotContain condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextDoesNotContain);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show all rows that don't contain "A" (9 rows)
    await assertRowCount(page, 9);
  });

  test('text filter - TextStartsWith condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextStartsWith);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows starting with "A"
    await assertRowCount(page, 1);
  });

  test('text filter - TextEndsWith condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextEndsWith);
    const filterInput = DatabaseFilterSelectors.filterInput(page);
    await filterInput.clear();
    await filterInput.pressSequentially('A', { delay: 30 });
    await page.waitForTimeout(500);

    // Should show rows ending with "A"
    await assertRowCount(page, 1);
  });

  test('text filter - TextIsEmpty condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextIsEmpty);

    // Should show rows with empty Name field (5 rows)
    await assertRowCount(page, 5);
  });

  test('text filter - TextIsNotEmpty condition', async ({ page, request }) => {
    setupFilterTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    const fieldId = await getPrimaryFieldId(page);
    await setupV020TestData(page, fieldId);

    await assertRowCount(page, 10);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextIsNotEmpty);

    // Should show rows with non-empty Name field (5 rows: A, B, C, D, E)
    await assertRowCount(page, 5);
  });
});
