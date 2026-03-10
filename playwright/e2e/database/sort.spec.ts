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

test.describe('Database Sort Tests (Desktop Parity)', () => {
  test.describe('Basic Sort Operations', () => {
    test('text sort - ascending', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      // Add rows with data: C, A, B (out of order)
      await addRows(page, 2); // Now have 3 rows total
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'C');
      await typeTextIntoCell(page, primaryFieldId, 1, 'A');
      await typeTextIntoCell(page, primaryFieldId, 2, 'B');
      await page.waitForTimeout(500);

      // Add sort by Name field (ascending by default)
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // Verify order is now A, B, C
      await assertRowOrder(page, primaryFieldId, ['A', 'B', 'C']);
    });

    test('text sort - descending', async ({ page, request }) => {
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

      // Add sort by Name field
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // Toggle to descending
      await openSortMenu(page);
      await toggleSortDirection(page, 0);
      await closeSortMenu(page);
      await page.waitForTimeout(500);

      // Verify order is now C, B, A
      await assertRowOrder(page, primaryFieldId, ['C', 'B', 'A']);
    });

    test('number sort - ascending', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      // Add a Number field
      const numberFieldId = await addFieldWithType(page, FieldType.Number);
      await page.waitForTimeout(500);

      // Add rows and enter numbers out of order
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

      // Verify numbers were entered
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, numberFieldId).first()
      ).toContainText('30');

      // Add sort by the Number field (default name is "Numbers")
      await addSortByFieldName(page, 'Numbers');
      await page.waitForTimeout(1000);

      // Verify order is now Row2 (10), Row3 (20), Row1 (30)
      await assertRowOrder(page, primaryFieldId, ['Row2', 'Row3', 'Row1']);
    });

    test('number sort - descending', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const numberFieldId = await addFieldWithType(page, FieldType.Number);
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

      // Add sort by Number field
      await addSortByFieldName(page, 'Numbers');
      await page.waitForTimeout(500);

      // Toggle to descending
      await openSortMenu(page);
      await toggleSortDirection(page, 0);
      await closeSortMenu(page);
      await page.waitForTimeout(500);

      // Verify order is now Row2 (30), Row3 (20), Row1 (10)
      await assertRowOrder(page, primaryFieldId, ['Row2', 'Row3', 'Row1']);
    });

    test('checkbox sort', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      // Add a Checkbox field
      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      // Add rows
      await addRows(page, 2);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Checked');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Unchecked');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Also Checked');
      await page.waitForTimeout(500);

      // Check first and third rows
      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(300);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // Add sort by Checkbox field
      await addSortByFieldName(page, 'Checkbox');
      await page.waitForTimeout(1000);

      // Unchecked should be first (false < true in default ascending)
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
      ).toContainText('Unchecked');
    });
  });

  test.describe('Multiple Sorts', () => {
    test('multiple sorts - checkbox then text', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      // We need 4 rows (default grid has 3)
      const currentRows = await DatabaseGridSelectors.dataRows(page).count();
      const rowsToAdd = Math.max(0, 4 - currentRows);
      if (rowsToAdd > 0) {
        await addRows(page, rowsToAdd);
      }
      await page.waitForTimeout(500);

      // Set up data
      await typeTextIntoCell(page, primaryFieldId, 0, 'Beta');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Alpha');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Delta');
      await typeTextIntoCell(page, primaryFieldId, 3, 'Charlie');
      await page.waitForTimeout(500);

      // Check rows 0 and 2 (Beta and Delta)
      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(300);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // Add first sort by checkbox
      await addSortByFieldName(page, 'Checkbox');
      await page.waitForTimeout(500);

      // Add second sort by name
      await openSortMenu(page);
      await page.waitForTimeout(300);
      await SortSelectors.addSortButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(1000);

      // Expected order: unchecked sorted (Alpha, Charlie) then checked sorted (Beta, Delta)
      await assertRowOrder(page, primaryFieldId, ['Alpha', 'Charlie', 'Beta', 'Delta']);
    });
  });

  test.describe('Sort Management', () => {
    test('delete sort', async ({ page, request }) => {
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

      // Add sort
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // Verify sorted
      await assertRowOrder(page, primaryFieldId, ['A', 'B', 'C']);

      // Delete sort
      await openSortMenu(page);
      await deleteSort(page, 0);
      await page.waitForTimeout(500);

      // Sort condition chip should not exist
      await expect(SortSelectors.sortCondition(page)).toHaveCount(0);
    });

    test('delete all sorts', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      // Add Number field
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

      // Add multiple sorts
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(500);

      // Add second sort
      await openSortMenu(page);
      await SortSelectors.addSortButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Numbers').click({ force: true });
      await page.waitForTimeout(500);

      // Delete all sorts
      await openSortMenu(page);
      await deleteAllSorts(page);
      await page.waitForTimeout(500);

      // Sort condition chip should not exist
      await expect(SortSelectors.sortCondition(page)).toHaveCount(0);
    });

    test('edit field name updates sort display', async ({ page, request }) => {
      setupSortTest(page);
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);

      const primaryFieldId = await getPrimaryFieldId(page);

      await addRows(page, 1);
      await page.waitForTimeout(500);

      await typeTextIntoCell(page, primaryFieldId, 0, 'A');
      await typeTextIntoCell(page, primaryFieldId, 1, 'B');
      await page.waitForTimeout(500);

      // Add sort by Name
      await addSortByFieldName(page, 'Name');
      await page.waitForTimeout(1000);

      // Rename the Name field to "Title"
      await GridFieldSelectors.fieldHeader(page, primaryFieldId).last().click({ force: true });
      await page.waitForTimeout(500);
      await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
      await page.waitForTimeout(500);

      // Find the name input and change it
      const nameInput = page.locator('input[value="Name"]');
      await nameInput.clear();
      await nameInput.fill('Title');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Verify sort still works and shows updated field name
      await expect(SortSelectors.sortCondition(page)).toHaveCount(1);

      // The sort panel should show "Title" now
      await openSortMenu(page);
      await expect(
        page.locator('[data-radix-popper-content-wrapper]').last()
      ).toContainText('Title');
    });
  });
});
