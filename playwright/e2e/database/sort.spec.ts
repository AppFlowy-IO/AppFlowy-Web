/**
 * Database Sort Tests (Desktop Parity)
 *
 * Tests sorting functionality for database views.
 * Migrated from: cypress/e2e/database/sort.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
  assertRowCount,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  addRows,
  toggleCheckbox,
  FieldType,
} from '../../support/field-type-helpers';
import {
  setupSortTest,
  addSortByFieldName,
  openSortMenu,
  toggleSortDirection,
  deleteSort,
  deleteAllSorts,
  assertRowOrder,
  closeSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  SortSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

test.describe('Database Sort Tests (Desktop Parity)', () => {
  test.describe('Basic Sort Operations', () => {
    test('text sort - ascending', async ({ page, request }) => {
      // Given: a grid with rows containing text C, A, B (out of order)
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'C');
      await typeTextIntoCell(page, primaryFieldId, 1, 'A');
      await typeTextIntoCell(page, primaryFieldId, 2, 'B');
      await page.waitForTimeout(500);

      // When: adding an ascending sort by the Name field
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // Then: rows are reordered to A, B, C
      await assertRowOrder(page, primaryFieldId, ['A', 'B', 'C']);
    });

    test('text sort - descending', async ({ page, request }) => {
      // Given: a grid with rows containing text A, C, B
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'A');
      await typeTextIntoCell(page, primaryFieldId, 1, 'C');
      await typeTextIntoCell(page, primaryFieldId, 2, 'B');
      await page.waitForTimeout(500);

      // When: adding a sort by Name and toggling to descending
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      await openSortMenu(page);
      await toggleSortDirection(page, 0);
      await closeSortMenu(page);
      await page.waitForTimeout(500);

      // Then: rows are reordered to C, B, A
      await assertRowOrder(page, primaryFieldId, ['C', 'B', 'A']);
    });

    test('number sort - ascending', async ({ page, request }) => {
      // Given: a grid with a Number field and rows with values 30, 10, 20
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const numberFieldId = await addFieldWithType(page, FieldType.Number);
      testLog.info(`Number field ID: ${numberFieldId}`);
      await page.waitForTimeout(500);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Row1');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Row2');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Row3');
      await page.waitForTimeout(300);

      await typeTextIntoCell(page, numberFieldId, 0, '30');
      await page.waitForTimeout(300);
      await typeTextIntoCell(page, numberFieldId, 1, '10');
      await page.waitForTimeout(300);
      await typeTextIntoCell(page, numberFieldId, 2, '20');
      await page.waitForTimeout(500);

      // And: the numbers are confirmed in the cells
      testLog.info('Verifying numbers were entered...');
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, numberFieldId).first()
      ).toContainText('30');

      // When: adding an ascending sort by the Numbers field
      await addSortByFieldName(page, 'Numbers');
      await page.waitForTimeout(1000);

      // Then: rows are reordered by number ascending - Row2 (10), Row3 (20), Row1 (30)
      await assertRowOrder(page, primaryFieldId, ['Row2', 'Row3', 'Row1']);
    });

    test('number sort - descending', async ({ page, request }) => {
      // Given: a grid with a Number field and rows with values 10, 30, 20
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const numberFieldId = await addFieldWithType(page, FieldType.Number);
      testLog.info(`Number field ID: ${numberFieldId}`);
      await page.waitForTimeout(500);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Row1');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Row2');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Row3');
      await page.waitForTimeout(300);

      await typeTextIntoCell(page, numberFieldId, 0, '10');
      await page.waitForTimeout(300);
      await typeTextIntoCell(page, numberFieldId, 1, '30');
      await page.waitForTimeout(300);
      await typeTextIntoCell(page, numberFieldId, 2, '20');
      await page.waitForTimeout(500);

      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, numberFieldId).first()
      ).toContainText('10');

      // When: adding a sort by Numbers and toggling to descending
      await addSortByFieldName(page, 'Numbers');
      await page.waitForTimeout(500);

      await openSortMenu(page);
      await toggleSortDirection(page, 0);
      await closeSortMenu(page);
      await page.waitForTimeout(500);

      // Then: rows are reordered by number descending - Row2 (30), Row3 (20), Row1 (10)
      await assertRowOrder(page, primaryFieldId, ['Row2', 'Row3', 'Row1']);
    });

    test('checkbox sort', async ({ page, request }) => {
      // Given: a grid with a Checkbox field where rows 0 and 2 are checked
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Checked');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Unchecked');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Also Checked');
      await page.waitForTimeout(500);

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(300);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // When: adding an ascending sort by the Checkbox field
      await addSortByFieldName(page, 'Checkbox');
      await page.waitForTimeout(1000);

      // Then: the unchecked row appears first (false < true)
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
      ).toContainText('Unchecked');
    });
  });

  test.describe('Multiple Sorts', () => {
    test('multiple sorts - checkbox then text', async ({ page, request }) => {
      // Given: a grid with 4 rows and a Checkbox field, where Beta and Delta are checked
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      const currentRows = await DatabaseGridSelectors.dataRows(page).count();
      const rowsToAdd = Math.max(0, 4 - currentRows);
      if (rowsToAdd > 0) {
        await addRows(page, rowsToAdd);
      }
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Beta');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Alpha');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Delta');
      await typeTextIntoCell(page, primaryFieldId, 3, 'Charlie');
      await page.waitForTimeout(500);

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(300);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // When: adding a sort by Checkbox first
      await addSortByFieldName(page, 'Checkbox');
      await page.waitForTimeout(500);

      // And: adding a second sort by Name
      await openSortMenu(page);
      await page.waitForTimeout(300);
      await SortSelectors.addSortButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(1000);

      // Then: unchecked rows are sorted alphabetically first, then checked rows
      await assertRowOrder(page, primaryFieldId, ['Alpha', 'Charlie', 'Beta', 'Delta']);
    });
  });

  test.describe('Sort Management', () => {
    test('delete sort', async ({ page, request }) => {
      // Given: a grid with rows C, A, B and an active ascending sort by Name
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'C');
      await typeTextIntoCell(page, primaryFieldId, 1, 'A');
      await typeTextIntoCell(page, primaryFieldId, 2, 'B');
      await page.waitForTimeout(500);

      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      await assertRowOrder(page, primaryFieldId, ['A', 'B', 'C']);

      // When: deleting the sort
      await openSortMenu(page);
      await deleteSort(page, 0);
      await page.waitForTimeout(500);

      // Then: the sort condition chip is removed
      await expect(SortSelectors.sortCondition(page)).toHaveCount(0);
    });

    test('delete all sorts', async ({ page, request }) => {
      // Given: a grid with a Number field, rows, and two active sorts (Name and Numbers)
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const numberFieldId = await addFieldWithType(page, FieldType.Number);
      await page.waitForTimeout(1000);

      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Row1');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Row2');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Row3');

      await typeTextIntoCell(page, numberFieldId, 0, '3');
      await typeTextIntoCell(page, numberFieldId, 1, '1');
      await typeTextIntoCell(page, numberFieldId, 2, '2');
      await page.waitForTimeout(500);

      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(500);

      await openSortMenu(page);
      await SortSelectors.addSortButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Numbers').click({ force: true });
      await page.waitForTimeout(500);

      // When: deleting all sorts at once
      await openSortMenu(page);
      await deleteAllSorts(page);
      await page.waitForTimeout(500);

      // Then: no sort condition chips remain
      await expect(SortSelectors.sortCondition(page)).toHaveCount(0);
    });

    test('edit field name updates sort display', async ({ page, request }) => {
      // Given: a grid with an active sort by the Name field
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      await addRows(page, 1);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'A');
      await typeTextIntoCell(page, primaryFieldId, 1, 'B');
      await page.waitForTimeout(500);

      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // When: renaming the Name field to "Title"
      await GridFieldSelectors.fieldHeader(page, primaryFieldId).last().click({ force: true });
      await page.waitForTimeout(500);
      await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
      await page.waitForTimeout(500);

      const nameInput = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.clear();
      await nameInput.fill('Title');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Then: the sort condition chip still exists
      await expect(SortSelectors.sortCondition(page)).toHaveCount(1);

      // And: the sort panel displays the updated field name "Title"
      await openSortMenu(page);
      await expect(
        page.locator('[data-radix-popper-content-wrapper]').last()
      ).toContainText('Title');
    });
  });
});
