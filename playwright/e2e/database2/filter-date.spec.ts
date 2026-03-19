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
 * Click on a date cell to open the date picker.
 * Uses dispatchEvent for reliability (same approach as select cell clicking).
 */
async function clickDateCell(page: import('@playwright/test').Page, fieldId: string, rowIndex: number): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.dispatchEvent('click', { bubbles: true });
  // Wait for the date picker popover to appear
  await expect(page.locator('[data-radix-popper-content-wrapper]').last()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
}

/**
 * Select a date in the date picker by day number.
 * Waits for the popover calendar to be visible and iterates over day buttons
 * to find the correct one, excluding "day-outside" (adjacent month) buttons.
 */
async function selectDateByDay(page: import('@playwright/test').Page, day: number): Promise<void> {
  // Wait for the date picker popover to be fully rendered
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await expect(popover).toBeVisible({ timeout: 5000 });
  // Wait a bit for the calendar to render inside the popover
  await page.waitForTimeout(300);

  const dayButtons = popover.locator('button');
  const count = await dayButtons.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const btn = dayButtons.nth(i);
    const text = (await btn.textContent())?.trim();
    if (text !== String(day)) continue;
    const cls = (await btn.getAttribute('class')) || '';
    if (cls.includes('day-outside')) continue;
    // Use evaluate click for reliability with React event handlers
    await btn.evaluate(el => (el as HTMLElement).click());
    clicked = true;
    break;
  }
  if (!clicked) {
    throw new Error(`selectDateByDay: Could not find day ${day} button in date picker (${count} buttons found)`);
  }
  await page.waitForTimeout(500);
}

/**
 * Change the date filter condition
 */
async function changeDateFilterCondition(page: import('@playwright/test').Page, condition: DateFilterCondition): Promise<void> {
  const trigger = page.getByTestId('filter-condition-trigger');
  await expect(trigger).toBeVisible({ timeout: 5000 });
  await trigger.click({ force: true });
  await page.waitForTimeout(500);
  const conditionItem = page.getByTestId(`filter-condition-${condition}`);
  await expect(conditionItem).toBeVisible({ timeout: 5000 });
  await conditionItem.click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Set a date in the filter date picker
 */
async function setFilterDate(page: import('@playwright/test').Page, day: number): Promise<void> {
  const picker = page.getByTestId('date-filter-date-picker');
  await expect(picker).toBeVisible({ timeout: 5000 });
  await picker.click({ force: true });
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
    // Given: a grid with a date field and three rows with dates (two matching, one different)
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const matchDay = todayDay === 12 ? 13 : 12;
    const otherDay = todayDay === 22 ? 23 : 22;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Event A');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Event B');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Event A2');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, matchDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, otherDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, matchDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date is" filter set to the matching day
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIs);
    await page.waitForTimeout(500);

    await setFilterDate(page, matchDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the two rows with the matching date are shown
    await assertRowCount(page, 2);
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).toContainText(['Event A', 'Event A2']);
    // And: the row with the different date is hidden
    await expect(cells).not.toContainText(['Event B']);
  });

  test('filter by date is before', async ({ page, request }) => {
    // Given: a grid with a date field and three rows with early, mid, and late dates
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const earlyDay = todayDay === 5 ? 4 : 5;
    const midDay = todayDay === 15 ? 14 : 15;
    const lateDay = todayDay === 25 ? 24 : 25;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, earlyDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, midDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, lateDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date before" filter set to the mid day
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateBefore);
    await page.waitForTimeout(500);

    await setFilterDate(page, midDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the early event row is shown
    await assertRowCount(page, 1);
    const cells2 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells2).toContainText(['Early Event']);
    // And: mid and late event rows are hidden
    await expect(cells2).not.toContainText(['Mid Event']);
    await expect(cells2).not.toContainText(['Late Event']);
  });

  test('filter by date is after', async ({ page, request }) => {
    // Given: a grid with a date field and three rows with early, mid, and late dates
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const earlyDay = todayDay === 7 ? 6 : 7;
    const midDay = todayDay === 14 ? 13 : 14;
    const lateDay = todayDay === 27 ? 26 : 27;

    await typeTextIntoCell(page, primaryFieldId, 0, 'First Week');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Second Week');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Fourth Week');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, earlyDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, midDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, lateDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date after" filter set to the mid day
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateAfter);
    await page.waitForTimeout(500);

    await setFilterDate(page, midDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the late date row is shown
    await assertRowCount(page, 1);
    const cells3 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells3).toContainText(['Fourth Week']);
    // And: early and mid date rows are hidden
    await expect(cells3).not.toContainText(['First Week']);
    await expect(cells3).not.toContainText(['Second Week']);
  });

  test('filter by date is empty', async ({ page, request }) => {
    // Given: a grid with a date field where only one row has a date set
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
    await selectDateByDay(page, 12);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date is empty" filter
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIsEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the two rows without dates are shown
    await assertRowCount(page, 2);
    const cells4 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells4).toContainText(['Empty Date 1', 'Empty Date 2']);
    // And: the row with a date is hidden
    await expect(cells4).not.toContainText(['Has Date']);
  });

  test('filter by date is not empty', async ({ page, request }) => {
    // Given: a grid with a date field where two rows have dates and one does not
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
    await selectDateByDay(page, 6);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, 21);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date is not empty" filter
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIsNotEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the two rows with dates are shown
    await assertRowCount(page, 2);
    const cells5 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells5).toContainText(['Has Date 1', 'Has Date 2']);
    // And: the row without a date is hidden
    await expect(cells5).not.toContainText(['No Date']);
  });

  test('filter by date is on or before', async ({ page, request }) => {
    // Given: a grid with a date field and three rows with early, mid, and late dates
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const earlyDay = todayDay === 5 ? 4 : 5;
    const midDay = todayDay === 15 ? 16 : 15;
    const lateDay = todayDay === 25 ? 24 : 25;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, earlyDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, midDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, lateDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date on or before" filter set to the mid day
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateOnOrBefore);
    await page.waitForTimeout(500);

    await setFilterDate(page, midDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: early and mid event rows are shown (on or before the boundary)
    await assertRowCount(page, 2);
    const cells6 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells6).toContainText(['Early Event', 'Mid Event']);
    // And: the late event row is hidden
    await expect(cells6).not.toContainText(['Late Event']);
  });

  test('filter by date is on or after', async ({ page, request }) => {
    // Given: a grid with a date field and three rows with early, mid, and late dates
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const earlyDay = todayDay === 5 ? 4 : 5;
    const midDay = todayDay === 15 ? 16 : 15;
    const lateDay = todayDay === 25 ? 24 : 25;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Early Event');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Mid Event');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Late Event');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, earlyDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, midDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, lateDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date on or after" filter set to the mid day
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateOnOrAfter);
    await page.waitForTimeout(500);

    await setFilterDate(page, midDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: mid and late event rows are shown (on or after the boundary)
    await assertRowCount(page, 2);
    const cells7 = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells7).toContainText(['Mid Event', 'Late Event']);
    // And: the early event row is hidden
    await expect(cells7).not.toContainText(['Early Event']);
  });

  test('date filter - delete filter restores all rows', async ({ page, request }) => {
    // Given: a grid with a date field and three rows each with different dates
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const filterDay = todayDay === 8 ? 9 : 8;
    const otherDay1 = todayDay === 15 ? 16 : 15;
    const otherDay2 = todayDay === 25 ? 26 : 25;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Event One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Event Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Event Three');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, filterDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, otherDay1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, otherDay2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date is" filter that narrows to one row
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    await changeDateFilterCondition(page, DateFilterCondition.DateIs);
    await page.waitForTimeout(500);

    await setFilterDate(page, filterDay);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: only the matching row is shown
    await assertRowCount(page, 1);

    // When: deleting the filter
    await clickFilterChip(page);
    await page.waitForTimeout(500);
    await deleteFilter(page);
    await page.waitForTimeout(3000);

    // Then: all three rows are restored
    await assertRowCount(page, 3);
  });

  test('date filter - change condition dynamically', async ({ page, request }) => {
    // Given: a grid with a date field where two rows have dates and one does not
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);
    const dateFieldId = await getDateFieldId(page);

    const todayDay = new Date().getDate();
    const earlyDay = todayDay === 10 ? 9 : 10;
    const lateDay = todayDay === 20 ? 19 : 20;
    const midDay = todayDay === 15 ? 14 : 15;

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Date');
    await typeTextIntoCell(page, primaryFieldId, 1, 'No Date');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Also Has Date');
    await page.waitForTimeout(500);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, earlyDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickDateCell(page, dateFieldId, 2);
    await selectDateByDay(page, lateDay);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // When: adding a "date is empty" filter
    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);
    await changeDateFilterCondition(page, DateFilterCondition.DateIsEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the row without a date is shown
    await assertRowCount(page, 1);

    // When: changing the filter condition to "date is not empty"
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeDateFilterCondition(page, DateFilterCondition.DateIsNotEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the two rows with dates are shown
    await assertRowCount(page, 2);

    // When: changing the filter condition to "date before" with mid day
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeDateFilterCondition(page, DateFilterCondition.DateBefore);
    await page.waitForTimeout(500);
    await setFilterDate(page, midDay);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: only the early date row is shown
    await assertRowCount(page, 1);
  });
});
