/**
 * Database Sort Regression Tests (Desktop Parity)
 *
 * Tests for sort edge cases and regression issues.
 * Migrated from: cypress/e2e/database/sort-regression.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  changeFilterCondition,
  enterFilterText,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  addRows,
  FieldType,
} from '../../support/field-type-helpers';
import {
  setupSortTest,
  addSortByFieldName,
  assertRowOrder,
  openSortMenu,
  toggleSortDirection,
  closeSortMenu,
  getCellValuesInOrder,
} from '../../support/sort-test-helpers';
import { DatabaseGridSelectors, SortSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Database Sort Regression Tests (Desktop Parity)', () => {
  test('non-sort edit keeps row order', async ({ page, request }) => {
    setupSortTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Add a Number field
    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(1000);

    await addRows(page, 2);
    await page.waitForTimeout(500);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Charlie');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Alpha');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Beta');

    // Enter numbers
    await typeTextIntoCell(page, numberFieldId, 0, '1');
    await typeTextIntoCell(page, numberFieldId, 1, '2');
    await typeTextIntoCell(page, numberFieldId, 2, '3');
    await page.waitForTimeout(500);

    // Sort by Name
    await addSortByFieldName(page, 'Name');
    await page.waitForTimeout(1000);

    // Verify sorted order: Alpha, Beta, Charlie
    await assertRowOrder(page, primaryFieldId, ['Alpha', 'Beta', 'Charlie']);

    // Edit the number field (non-sorted) - should NOT change row order
    await typeTextIntoCell(page, numberFieldId, 0, '999');
    await page.waitForTimeout(500);

    // Verify order is still Alpha, Beta, Charlie
    await assertRowOrder(page, primaryFieldId, ['Alpha', 'Beta', 'Charlie']);
  });

  test('filter + sort keeps row order on non-sort edit', async ({ page, request }) => {
    setupSortTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Add a Number field
    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(1000);

    await addRows(page, 4);
    await page.waitForTimeout(500);

    // Enter names with "A_" prefix for filtering
    await typeTextIntoCell(page, primaryFieldId, 0, 'A_Charlie');
    await typeTextIntoCell(page, primaryFieldId, 1, 'B_Skip');
    await typeTextIntoCell(page, primaryFieldId, 2, 'A_Alpha');
    await typeTextIntoCell(page, primaryFieldId, 3, 'A_Beta');
    await typeTextIntoCell(page, primaryFieldId, 4, 'B_Skip2');

    // Enter numbers
    await typeTextIntoCell(page, numberFieldId, 0, '1');
    await typeTextIntoCell(page, numberFieldId, 1, '2');
    await typeTextIntoCell(page, numberFieldId, 2, '3');
    await typeTextIntoCell(page, numberFieldId, 3, '4');
    await typeTextIntoCell(page, numberFieldId, 4, '5');
    await page.waitForTimeout(500);

    // Add filter: Name starts with "A"
    await addFilterByFieldName(page, 'Name');
    await page.waitForTimeout(500);
    await changeFilterCondition(page, TextFilterCondition.TextStartsWith);
    await page.waitForTimeout(500);
    await enterFilterText(page, 'A');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Sort by Name
    await addSortByFieldName(page, 'Name');
    await page.waitForTimeout(1000);

    // Verify filtered and sorted order: A_Alpha, A_Beta, A_Charlie
    await assertRowOrder(page, primaryFieldId, ['A_Alpha', 'A_Beta', 'A_Charlie']);

    // Edit number in first visible row (should be A_Alpha after sort)
    await typeTextIntoCell(page, numberFieldId, 0, '100');
    await page.waitForTimeout(500);

    // Verify order is still A_Alpha, A_Beta, A_Charlie
    await assertRowOrder(page, primaryFieldId, ['A_Alpha', 'A_Beta', 'A_Charlie']);
  });

  test('case-insensitive alphabetical sort', async ({ page, request }) => {
    setupSortTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Grid starts with 3 rows, add 1 more for 4 total
    await addRows(page, 1);
    await page.waitForTimeout(500);

    // Enter mixed-case names
    await typeTextIntoCell(page, primaryFieldId, 0, 'banana');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Apple');
    await typeTextIntoCell(page, primaryFieldId, 2, 'CHERRY');
    await typeTextIntoCell(page, primaryFieldId, 3, 'date');
    await page.waitForTimeout(500);

    // Sort by Name
    await addSortByFieldName(page, 'Name');
    await page.waitForTimeout(1000);

    // Verify case-insensitive order
    const values = await getCellValuesInOrder(page, primaryFieldId);
    const nonEmptyValues = values.filter((v) => v !== '');
    const lowered = nonEmptyValues.map((v) => v.toLowerCase());
    const sorted = [...lowered].sort();
    expect(lowered).toEqual(sorted);
  });

  test('case-insensitive sort with ascending/descending toggle', async ({ page, request }) => {
    setupSortTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await addRows(page, 2);
    await page.waitForTimeout(500);

    // Enter mixed-case names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Zebra');
    await typeTextIntoCell(page, primaryFieldId, 1, 'apple');
    await typeTextIntoCell(page, primaryFieldId, 2, 'MANGO');
    await page.waitForTimeout(500);

    // Sort by Name (ascending)
    await addSortByFieldName(page, 'Name');
    await page.waitForTimeout(1000);

    // Verify ascending order: apple first
    const firstCell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first();
    const firstText = await firstCell.textContent();
    expect(firstText?.trim().toLowerCase()).toBe('apple');

    // Toggle to descending
    await openSortMenu(page);
    await toggleSortDirection(page, 0);
    await closeSortMenu(page);
    await page.waitForTimeout(500);

    // Verify descending order: Zebra first
    const firstCellDesc = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first();
    const firstTextDesc = await firstCellDesc.textContent();
    expect(firstTextDesc?.trim().toLowerCase()).toBe('zebra');
  });
});
