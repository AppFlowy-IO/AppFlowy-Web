/**
 * Database Date Filter Tests (Desktop Parity)
 *
 * Tests for date/datetime field filtering.
 * Migrated from: cypress/e2e/database2/filter-date.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  setupFilterTest,
  loginAndCreateGrid,
  typeTextIntoCell,
  addFilterByFieldName,
  clickFilterChip,
  deleteFilter,
  assertRowCount,
  getPrimaryFieldId,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
} from '../../support/field-type-helpers';
import { DatabaseGridSelectors, FieldType } from '../../support/selectors';

/**
 * Date filter condition enum values
 */
enum DateFilterCondition {
  DateIs = 0,
  DateBefore = 1,
  DateAfter = 2,
  DateOnOrBefore = 3,
  DateOnOrAfter = 4,
  DateWithin = 5,
  DateIsEmpty = 6,
  DateIsNotEmpty = 7,
}

/**
 * Click on a date cell to open the date picker
 */
async function clickDateCell(page: import('@playwright/test').Page, fieldId: string, rowIndex: number): Promise<void> {
  await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Select a date in the date picker by day number
 */
async function selectDateByDay(page: import('@playwright/test').Page, day: number): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  const dayButtons = await popover.locator('button').all();
  for (const btn of dayButtons) {
    const text = await btn.textContent();
    if (text?.trim() !== String(day)) continue;
    const cls = await btn.getAttribute('class');
    if (cls && cls.includes('day-outside')) continue;
    await btn.click({ force: true });
    break;
  }
  await page.waitForTimeout(500);
}

/**
 * Change the date filter condition
 */
async function changeDateFilterCondition(page: import('@playwright/test').Page, condition: DateFilterCondition): Promise<void> {
  await page.getByTestId('filter-condition-trigger').click({ force: true });
  await page.waitForTimeout(500);
  await page.getByTestId(`filter-condition-${condition}`).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Set a date in the filter date picker
 */
async function setFilterDate(page: import('@playwright/test').Page, day: number): Promise<void> {
  await page.getByTestId('date-filter-date-picker').click({ force: true });
  await page.waitForTimeout(500);
  await selectDateByDay(page, day);
}

/**
 * Helper to get the date field ID after adding a DateTime field
 */
async function getDateFieldId(page: import('@playwright/test').Page): Promise<string> {
  const lastHeader = page.locator('[data-testid^="grid-field-header-"]').last();
  const testId = await lastHeader.getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

test.describe('Database Date Filter Tests (Desktop Parity)', () => {
  test('filter by date is on specific date', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Event on 15th');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Event on 20th');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Event on 15th too');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 20);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIs);
    await page.waitForTimeout(500);

    await setFilterDate(page, 15);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).toContainText(['Event on 15th', 'Event on 15th too']);
    await expect(cells).not.toContainText(['Event on 20th']);
  });

  test('filter by date is before', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 5);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 25);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateBefore);
    await page.waitForTimeout(500);

    await setFilterDate(page, 15);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 1);
    const cells2 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells2).toContainText(['Early Event']);
    await expect(cells2).not.toContainText(['Mid Event']);
    await expect(cells2).not.toContainText(['Late Event']);
  });

  test('filter by date is after', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'First Week');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Second Week');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Fourth Week');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 7);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 14);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 28);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateAfter);
    await page.waitForTimeout(500);

    await setFilterDate(page, 14);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 1);
    const cells3 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells3).toContainText(['Fourth Week']);
    await expect(cells3).not.toContainText(['First Week']);
    await expect(cells3).not.toContainText(['Second Week']);
  });

  test('filter by date is empty', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Date');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Empty Date 1');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Empty Date 2');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 10);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIsEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);
    const cells4 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells4).toContainText(['Empty Date 1', 'Empty Date 2']);
    await expect(cells4).not.toContainText(['Has Date']);
  });

  test('filter by date is not empty', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Date 1');
    await typeTextIntoCell(page, primaryFieldId, 1, 'No Date');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Has Date 2');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 5);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 20);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIsNotEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);
    const cells5 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells5).toContainText(['Has Date 1', 'Has Date 2']);
    await expect(cells5).not.toContainText(['No Date']);
  });

  test('filter by date is on or before', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 5);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 25);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateOnOrBefore);
    await page.waitForTimeout(500);

    await setFilterDate(page, 15);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);
    const cells6 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells6).toContainText(['Early Event', 'Mid Event']);
    await expect(cells6).not.toContainText(['Late Event']);
  });

  test('filter by date is on or after', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 5);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 25);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateOnOrAfter);
    await page.waitForTimeout(500);

    await setFilterDate(page, 15);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);
    const cells7 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells7).toContainText(['Mid Event', 'Late Event']);
    await expect(cells7).not.toContainText(['Early Event']);
  });

  test('date filter - delete filter restores all rows', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Event One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Event Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Event Three');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 10);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 15);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 25);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIs);
    await page.waitForTimeout(500);

    await setFilterDate(page, 10);
    await page.waitForTimeout(500);

    // Close date picker popover and filter popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    await assertRowCount(page, 1);

    await clickFilterChip(page);
    await page.waitForTimeout(500);
    await deleteFilter(page);
    await page.waitForTimeout(3000);

    await assertRowCount(page, 3);
  });

  test('date filter - change condition dynamically', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Date');
    await typeTextIntoCell(page, primaryFieldId, 1, 'No Date');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Also Has Date');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 10);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 20);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);
    await changeDateFilterCondition(page, DateFilterCondition.DateIsEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 1);

    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeDateFilterCondition(page, DateFilterCondition.DateIsNotEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);

    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeDateFilterCondition(page, DateFilterCondition.DateBefore);
    await page.waitForTimeout(500);
    await setFilterDate(page, 15);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 1);
  });
});
