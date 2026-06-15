/**
 * Database Relative Date Filter Tests
 *
 * Mirrors the desktop BDD scenario from AppFlowy-Premium PR #965:
 *   AppFlowy-Premium/frontend/appflowy_flutter/integration_test/desktop/
 *     bdd/database/grid/relative_date_filter.feature
 *
 * Both tests use the same row names, date arithmetic, and assertion order
 * (see playwright/support/relative-date-anchors.ts).
 */
import { test, expect, Page, Locator } from '@playwright/test';

import { addFieldWithType, addRows } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  assertRowCount,
  clickFilterChip,
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import {
  getRelativeDateAnchors,
  RELATIVE_DATE_FIELD_NAME,
} from '../../support/relative-date-anchors';
import { DatabaseGridSelectors, FieldType, GridFieldSelectors, PropertyMenuSelectors } from '../../support/selectors';

// Mirrors src/application/database-yjs/fields/date/date.type.ts.
enum DateFilterCondition {
  DateStartsToday = 16,
  DateStartsYesterday = 17,
  DateStartsTomorrow = 18,
  DateStartsThisWeek = 19,
  DateStartsLastWeek = 20,
  DateStartsNextWeek = 21,
}

async function getDateFieldId(page: Page): Promise<string> {
  const lastHeader = page.locator('[data-testid^="grid-field-header-"]').last();
  const testId = await lastHeader.getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

async function renameField(page: Page, fieldId: string, newName: string): Promise<void> {
  await GridFieldSelectors.fieldHeader(page, fieldId).last().click({ force: true });
  await page.waitForTimeout(400);
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
  await page.waitForTimeout(400);

  const nameInput = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.clear();
  await nameInput.fill(newName);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

async function clickDateCell(page: Page, fieldId: string, rowIndex: number): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.dispatchEvent('click', { bubbles: true });
  await expect(page.locator('[data-radix-popper-content-wrapper]').last()).toBeVisible({
    timeout: 5000,
  });
  await page.waitForTimeout(250);
}

// Navigate the open react-day-picker popover to the target month, then click the day.
// Robust to dates in adjacent months (e.g. last/next week crossing a month boundary).
async function setDateInOpenPicker(page: Page, target: Date): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await expect(popover).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(150);

  const targetLabel = target.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  for (let i = 0; i < 24; i++) {
    const caption = popover.locator('text=/^[A-Z][a-z]+ \\d{4}$/').first();
    await expect(caption).toBeVisible({ timeout: 5000 });
    const currentText = ((await caption.textContent()) ?? '').trim();
    if (currentText === targetLabel) break;

    const [monthName, yearStr] = currentText.split(' ');
    const currentMonthDate = new Date(`${monthName} 1, ${yearStr}`);
    const dir = currentMonthDate.getTime() < target.getTime() ? 'next-month' : 'previous-month';
    await popover.locator(`button[name="${dir}"]`).click();
    await page.waitForTimeout(150);
  }

  // Click the day — skip "day-outside" buttons so we land on the target month's day.
  const dayButtons = popover.locator('button');
  const count = await dayButtons.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const btn = dayButtons.nth(i);
    const text = (await btn.textContent())?.trim();
    if (text !== String(target.getDate())) continue;
    const cls = (await btn.getAttribute('class')) || '';
    if (cls.includes('day-outside')) continue;
    await btn.evaluate((el) => (el as HTMLElement).click());
    clicked = true;
    break;
  }
  if (!clicked) {
    throw new Error(`setDateInOpenPicker: could not click day ${target.getDate()} in ${targetLabel}`);
  }
  await page.waitForTimeout(300);
}

async function setCellDate(page: Page, dateFieldId: string, rowIndex: number, target: Date): Promise<void> {
  await clickDateCell(page, dateFieldId, rowIndex);
  await setDateInOpenPicker(page, target);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

async function changeDateFilterCondition(page: Page, condition: DateFilterCondition): Promise<void> {
  const trigger = page.getByTestId('filter-condition-trigger');
  await expect(trigger).toBeVisible({ timeout: 5000 });
  await trigger.click({ force: true });
  await page.waitForTimeout(300);
  const item = page.getByTestId(`filter-condition-${condition}`);
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click({ force: true });
  await page.waitForTimeout(300);
}

async function expectVisibleRowNames(cells: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    await expect(cells).toContainText([name]);
  }
}

async function expectHiddenRowNames(cells: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    await expect(cells).not.toContainText([name]);
  }
}

test.describe('Database Relative Date Filter Tests', () => {
  test('relative date filters return the correct rows', async ({ page, request }) => {
    test.setTimeout(180_000); // 9-row seed + 6 filter switches takes a while.

    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    // Given: a grid with a "Due Date" date field (matches desktop scenario field name).
    const primaryFieldId = await getPrimaryFieldId(page);
    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(800);
    const dateFieldId = await getDateFieldId(page);
    await renameField(page, dateFieldId, RELATIVE_DATE_FIELD_NAME);

    // And: the grid has the nine relative-date anchor rows.
    const anchors = getRelativeDateAnchors();
    // Grid starts with 3 rows; add 6 more to reach 9.
    await addRows(page, anchors.length - 3);
    await page.waitForTimeout(500);

    for (let i = 0; i < anchors.length; i++) {
      await typeTextIntoCell(page, primaryFieldId, i, anchors[i].name);
    }
    for (let i = 0; i < anchors.length; i++) {
      await setCellDate(page, dateFieldId, i, anchors[i].date);
    }
    await assertRowCount(page, anchors.length);

    // When: the user adds a today date filter on field 'Due Date'.
    await addFilterByFieldName(page, RELATIVE_DATE_FIELD_NAME);
    await page.waitForTimeout(500);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsToday);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    let cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);

    // Then: the today row is shown; yesterday/tomorrow rows are hidden.
    await expectVisibleRowNames(cells, ['Today task']);
    await expectHiddenRowNames(cells, ['Yesterday task', 'Tomorrow task']);

    // When: condition → Yesterday.
    await clickFilterChip(page);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsYesterday);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expectVisibleRowNames(cells, ['Yesterday task']);
    await expectHiddenRowNames(cells, ['Today task', 'Tomorrow task']);

    // When: condition → Tomorrow.
    await clickFilterChip(page);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsTomorrow);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expectVisibleRowNames(cells, ['Tomorrow task']);
    await expectHiddenRowNames(cells, ['Today task', 'Yesterday task']);

    // When: condition → This week.
    await clickFilterChip(page);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsThisWeek);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expectVisibleRowNames(cells, ['ThisMon task', 'ThisSun task']);
    await expectHiddenRowNames(cells, ['LastMon task', 'NextMon task']);

    // When: condition → Last week.
    await clickFilterChip(page);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsLastWeek);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expectVisibleRowNames(cells, ['LastMon task', 'LastSun task']);
    await expectHiddenRowNames(cells, ['ThisMon task', 'NextMon task']);

    // When: condition → Next week.
    await clickFilterChip(page);
    await changeDateFilterCondition(page, DateFilterCondition.DateStartsNextWeek);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expectVisibleRowNames(cells, ['NextMon task', 'NextSun task']);
    await expectHiddenRowNames(cells, ['ThisMon task', 'LastMon task']);
  });

  // Web-only UX assertion: the date input disappears for relative conditions.
  test('relative date filter hides the date input', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    await addFieldWithType(page, FieldType.DateTime);
    await page.waitForTimeout(1000);

    await addFilterByFieldName(page, 'Date');
    await page.waitForTimeout(500);

    // Default condition is "DateStartsOn" (0) — date picker is shown.
    await expect(page.getByTestId('date-filter-date-picker')).toBeVisible({ timeout: 5000 });

    await changeDateFilterCondition(page, DateFilterCondition.DateStartsToday);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('date-filter-date-picker')).toHaveCount(0);

    await changeDateFilterCondition(page, 0 as DateFilterCondition); // DateStartsOn
    await page.waitForTimeout(500);
    await expect(page.getByTestId('date-filter-date-picker')).toBeVisible({ timeout: 5000 });
  });
});
