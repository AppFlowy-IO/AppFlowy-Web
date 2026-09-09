import { expect, Page } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { addFieldWithType, addRows, loginAndCreateGrid, typeTextIntoCell } from '../../support/field-type-helpers';
import { DatabaseGridSelectors, FieldType, SortSelectors } from '../../support/selectors';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();
const numberFieldIds = new WeakMap<Page, string>();
const groupHeaders = (page: Page) => page.locator('[data-testid^="grid-group-header-"]');
const numberControl = (page: Page, name: string) => page.getByTestId(`grid-number-group-${name}`);

function numberFieldId(page: Page): string {
  const fieldId = numberFieldIds.get(page);

  if (!fieldId) throw new Error('The number grouping field has not been created');
  return fieldId;
}

// Bucket notation states the boundary contract without depending on translated labels.
function bucketId(page: Page, bucket: string): string {
  if (bucket === 'empty') return numberFieldId(page);

  const value = /^([=<>])\s*(.+)$/.exec(bucket);

  if (value) {
    const prefix = value[1] === '=' ? 'value' : value[1] === '<' ? 'below' : 'above';

    return `number_${prefix}_${value[2]}`;
  }

  const range = /^\[([^,]+),\s*([^,]+)(\)|\])$/.exec(bucket);

  if (!range) throw new Error(`Unsupported number bucket: ${bucket}`);
  return `number_interval_${range[3] === ']' ? 'closed_' : ''}${range[1].trim()}_${range[2].trim()}`;
}

async function openNumberGroupSettings(page: Page) {
  const menu = page.getByTestId('grid-group-settings-menu');

  if (await menu.isVisible()) return;

  const trigger = page.getByTestId('grid-group-settings-trigger');

  if (!(await trigger.isVisible())) await page.getByTestId('database-actions-settings').click();
  await trigger.click();
  await expect(menu).toBeVisible();
}

async function closeNumberGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('grid-group-settings-menu')).toBeHidden();
}

async function fillRange(page: Page, start: string, end: string, interval: string) {
  await numberControl(page, 'start').click();
  await numberControl(page, 'start').fill(start);
  await numberControl(page, 'end').click();
  await numberControl(page, 'end').fill(end);
  await numberControl(page, 'interval').click();
  await numberControl(page, 'interval').fill(interval);
}

async function expectSavedRange(page: Page, start: string, end: string, interval: string) {
  await openNumberGroupSettings(page);
  await expect(numberControl(page, 'mode-range')).toHaveAttribute('aria-checked', 'true');
  await expect(numberControl(page, 'start')).toHaveValue(start);
  await expect(numberControl(page, 'end')).toHaveValue(end);
  await expect(numberControl(page, 'interval')).toHaveValue(interval);
  await closeNumberGroupSettings(page);
}

async function setHideEmpty(page: Page, hide: boolean) {
  await openNumberGroupSettings(page);
  const toggle = page.getByTestId('grid-hide-empty-groups-toggle');

  if ((await toggle.getAttribute('aria-checked')) !== String(hide)) await toggle.click();
  await closeNumberGroupSettings(page);
  await openNumberGroupSettings(page);
  await expect(toggle).toHaveAttribute('aria-checked', String(hide));
  await closeNumberGroupSettings(page);
}

Given('a Grid contains the following numbers for number grouping', async ({ page, request }, table: DataTable) => {
  setupPageErrorHandling(page);
  // Keep every configured default bucket mounted so DOM assertions cover the whole order.
  await page.setViewportSize({ width: 1600, height: 3200 });
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const values = table.hashes().map((row) => row.value);
  const fieldId = await addFieldWithType(page, FieldType.Number);

  expect(fieldId).not.toBe('');
  numberFieldIds.set(page, fieldId);
  const initialRows = await DatabaseGridSelectors.dataRows(page).count();

  expect(values.length).toBeGreaterThanOrEqual(initialRows);
  await addRows(page, values.length - initialRows);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(values.length);

  for (const [index, value] of values.entries()) {
    if (value !== '<empty>') await typeTextIntoCell(page, fieldId, index, value);
  }
});

When('I group the Grid by its number field', async ({ page }) => {
  await openNumberGroupSettings(page);
  await page.getByTestId(`grid-group-by-field-${numberFieldId(page)}`).click();
  await closeNumberGroupSettings(page);
  await expect(groupHeaders(page).first()).toBeVisible();
});

Then(
  'number grouping uses Range with Start {string}, End {string}, and Interval {string}',
  async ({ page }, start: string, end: string, interval: string) => {
    await expectSavedRange(page, start, end, interval);
  }
);

When('I select Exact value number grouping', async ({ page }) => {
  await openNumberGroupSettings(page);
  await numberControl(page, 'mode-exact').click();
  await closeNumberGroupSettings(page);
  await openNumberGroupSettings(page);
  await expect(numberControl(page, 'mode-exact')).toHaveAttribute('aria-checked', 'true');
  await closeNumberGroupSettings(page);
});

Then('Exact value number grouping is selected', async ({ page }) => {
  await openNumberGroupSettings(page);
  await expect(numberControl(page, 'mode-exact')).toHaveAttribute('aria-checked', 'true');
  await closeNumberGroupSettings(page);
});

When(
  'I apply number ranges with Start {string}, End {string}, and Interval {string}',
  async ({ page }, start: string, end: string, interval: string) => {
    await openNumberGroupSettings(page);
    await fillRange(page, start, end, interval);
    await expect(numberControl(page, 'apply')).toBeEnabled();
    await numberControl(page, 'apply').click();
    await closeNumberGroupSettings(page);
    await expectSavedRange(page, start, end, interval);
  }
);

When('I show empty number groups', async ({ page }) => {
  await setHideEmpty(page, false);
});

When('I hide empty number groups', async ({ page }) => {
  await setHideEmpty(page, true);
});

Then('the number groups contain these row counts', async ({ page }, table: DataTable) => {
  for (const { bucket, rows } of table.hashes()) {
    const header = page.getByTestId(`grid-group-header-${bucketId(page, bucket)}`);

    await expect(header, `Expected one displayed number group ${bucket}`).toHaveCount(1);
    await expect(header).toBeVisible();
    await expect(header.getByTestId('grid-group-row-count')).toHaveText(rows);
  }
});

Then('the number group {string} is not displayed', async ({ page }, bucket: string) => {
  await expect(page.getByTestId(`grid-group-header-${bucketId(page, bucket)}`)).toHaveCount(0);
});

Then('the displayed number groups are ordered as follows', async ({ page }, table: DataTable) => {
  const expected = table.hashes().map(({ bucket }) => bucketId(page, bucket));

  await expect
    .poll(() => groupHeaders(page).evaluateAll((headers) => headers.map((header) => header.dataset.groupId)))
    .toEqual(expected);
});

When('I sort number groups {word}', async ({ page }, direction: string) => {
  expect(['ascending', 'descending']).toContain(direction);
  await openNumberGroupSettings(page);
  await numberControl(page, `sort-${direction}`).click();
  await closeNumberGroupSettings(page);
  await openNumberGroupSettings(page);
  await expect(numberControl(page, `sort-${direction}`)).toHaveAttribute('aria-checked', 'true');
  await closeNumberGroupSettings(page);
});

async function expectNumericRowSort(page: Page, direction: string) {
  expect(['ascending', 'descending']).toContain(direction);
  await openSortMenu(page);
  await expect(SortSelectors.sortItem(page)).toHaveCount(1);
  await expect(
    SortSelectors.sortItem(page).getByRole('button', { name: new RegExp(`^${direction}$`, 'i') })
  ).toBeVisible();
  await closeSortMenu(page);
}

When('I sort the Grid rows by its number field {word}', async ({ page }, direction: string) => {
  expect(['ascending', 'descending']).toContain(direction);
  if ((await SortSelectors.sortCondition(page).count()) === 0) {
    // The fixture adds one Number property through the UI with its default name.
    await addSortByFieldName(page, 'Number');
  }

  await openSortMenu(page);
  await changeSortDirection(page, 0, direction === 'ascending' ? SortDirection.Ascending : SortDirection.Descending);
  await closeSortMenu(page);
  await expectNumericRowSort(page, direction);
});

Then('the numeric row sort is {word}', async ({ page }, direction: string) => {
  await expectNumericRowSort(page, direction);
});

Then(
  'number group {string} contains numeric values in this order',
  async ({ page }, bucket: string, table: DataTable) => {
    const id = bucketId(page, bucket);
    const cells = page.locator(
      `[data-index][data-row-key^="group:${id}:row:"] .grid-row-cell[data-column-id="${numberFieldId(page)}"]`
    );

    await expect(cells).toHaveText(table.hashes().map(({ value }) => value));
  }
);

When('I reload the number-grouped Grid', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
  await expect(groupHeaders(page).first()).toBeVisible({ timeout: 30000 });
});

Then('these invalid range drafts cannot be applied or saved', async ({ page }, table: DataTable) => {
  const savedGroupIds = await groupHeaders(page).evaluateAll((headers) =>
    headers.map((header) => header.dataset.groupId)
  );

  for (const { start, end, interval } of table.hashes()) {
    await openNumberGroupSettings(page);
    await fillRange(page, start, end, interval);
    await numberControl(page, 'apply').click();
    await expect(numberControl(page, 'validation')).toBeVisible();
    await closeNumberGroupSettings(page);
    await expectSavedRange(page, '0', '100', '10');
    await expect
      .poll(() => groupHeaders(page).evaluateAll((headers) => headers.map((header) => header.dataset.groupId)))
      .toEqual(savedGroupIds);
  }
});

When('I add a row to number group {string}', async ({ page }, bucket: string) => {
  const header = page.getByTestId(`grid-group-header-${bucketId(page, bucket)}`);

  await header.hover();
  await header.getByTestId('grid-group-new-row').click();
});
