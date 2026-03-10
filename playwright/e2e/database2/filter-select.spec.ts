/**
 * Database Select Filter Tests (Desktop Parity)
 *
 * Tests for single select and multi select field filtering.
 * Migrated from: cypress/e2e/database2/filter-select.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  clickFilterChip,
  deleteFilter,
  assertRowCount,
  getPrimaryFieldId,
  SelectFilterCondition,
  createSelectOption,
  clickSelectCell,
  selectExistingOption,
  selectFilterOption,
  changeSelectFilterCondition,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  typeTextIntoCell,
  FieldType,
} from '../../support/field-type-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';

test.describe('Database Select Filter Tests (Desktop Parity)', () => {
  test('filter by single select option', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'High Priority Item');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Medium Priority Item');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Low Priority Item');
    await page.waitForTimeout(500);

    // Create and assign options
    await clickSelectCell(page, selectFieldId, 0);
    await createSelectOption(page, 'High');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 1);
    await createSelectOption(page, 'Medium');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 2);
    await createSelectOption(page, 'Low');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter on Select field
    await addFilterByFieldName(page, 'Select');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await page.waitForTimeout(500);

    await selectFilterOption(page, 'High');
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Only High priority row should be visible
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText(['High Priority Item']);
  });

  test('filter by single select is empty', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'With Status');
    await typeTextIntoCell(page, primaryFieldId, 1, 'No Status');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Also No Status');
    await page.waitForTimeout(500);

    // Only set status for first row
    await clickSelectCell(page, selectFieldId, 0);
    await createSelectOption(page, 'Active');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Select');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIsEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Only rows without status visible
    await assertRowCount(page, 2);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).not.toContainText(['With Status']);
  });

  test('filter by multi select contains option', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const multiSelectFieldId = await addFieldWithType(page, FieldType.MultiSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Frontend Developer');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Backend Developer');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Fullstack Developer');
    await page.waitForTimeout(500);

    // First row: add "React" tag
    await clickSelectCell(page, multiSelectFieldId, 0);
    await createSelectOption(page, 'React');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Second row: add "Node" tag
    await clickSelectCell(page, multiSelectFieldId, 1);
    await createSelectOption(page, 'Node');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Third row: add both tags
    await clickSelectCell(page, multiSelectFieldId, 2);
    await selectExistingOption(page, 'React');
    await selectExistingOption(page, 'Node');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Multiselect');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionContains);
    await page.waitForTimeout(500);

    await selectFilterOption(page, 'React');
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Rows with "React" tag
    await assertRowCount(page, 2);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText(['Frontend Developer', 'Fullstack Developer']);
  });

  test('filter by multi select is not empty', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const multiSelectFieldId = await addFieldWithType(page, FieldType.MultiSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Tagged Item');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Untagged Item');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Another Tagged');
    await page.waitForTimeout(500);

    // Add tag to first and third rows
    await clickSelectCell(page, multiSelectFieldId, 0);
    await createSelectOption(page, 'Important');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, multiSelectFieldId, 2);
    await selectExistingOption(page, 'Important');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Multiselect');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIsNotEmpty);
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Only tagged rows visible
    await assertRowCount(page, 2);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText(['Tagged Item', 'Another Tagged']);
  });

  test('filter by single select option is not', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Active Item');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Inactive Item');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Another Active');
    await page.waitForTimeout(500);

    await clickSelectCell(page, selectFieldId, 0);
    await createSelectOption(page, 'Active');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 1);
    await createSelectOption(page, 'Inactive');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 2);
    await selectExistingOption(page, 'Active');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Select');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIsNot);
    await page.waitForTimeout(500);

    await selectFilterOption(page, 'Active');
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Only Inactive Item visible
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
    ).toContainText('Inactive Item');
  });

  test('filter by multi select does not contain option', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const multiSelectFieldId = await addFieldWithType(page, FieldType.MultiSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Python');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Has JavaScript');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Has Both');
    await page.waitForTimeout(500);

    await clickSelectCell(page, multiSelectFieldId, 0);
    await createSelectOption(page, 'Python');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, multiSelectFieldId, 1);
    await createSelectOption(page, 'JavaScript');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, multiSelectFieldId, 2);
    await selectExistingOption(page, 'Python');
    await selectExistingOption(page, 'JavaScript');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Multiselect');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionDoesNotContain);
    await page.waitForTimeout(500);

    await selectFilterOption(page, 'Python');
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Only row without Python
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
    ).toContainText('Has JavaScript');
  });

  test('select filter - delete filter restores all rows', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Item One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Item Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Item Three');
    await page.waitForTimeout(500);

    await clickSelectCell(page, selectFieldId, 0);
    await createSelectOption(page, 'Status A');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 1);
    await createSelectOption(page, 'Status B');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickSelectCell(page, selectFieldId, 2);
    await selectExistingOption(page, 'Status A');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    await addFilterByFieldName(page, 'Select');
    await page.waitForTimeout(500);

    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await page.waitForTimeout(500);

    await selectFilterOption(page, 'Status A');
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 2);

    // Delete the filter
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await deleteFilter(page);
    await page.waitForTimeout(500);

    // All rows visible again
    await assertRowCount(page, 3);
  });

  test('select filter - change condition dynamically', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1000);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Has Status');
    await typeTextIntoCell(page, primaryFieldId, 1, 'No Status');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Different Status');
    await page.waitForTimeout(500);

    // First row: set "Open" status
    await clickSelectCell(page, selectFieldId, 0);
    await createSelectOption(page, 'Open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Second row: no status (leave empty)

    // Third row: set "Closed" status
    await clickSelectCell(page, selectFieldId, 2);
    await createSelectOption(page, 'Closed');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter with "Is Empty"
    await addFilterByFieldName(page, 'Select');
    await page.waitForTimeout(500);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIsEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 1 row (No Status)
    await assertRowCount(page, 1);

    // Change to "Is Not Empty"
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIsNotEmpty);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 2 rows (Has Status, Different Status)
    await assertRowCount(page, 2);

    // Change to "Option Is" and select "Open"
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await page.waitForTimeout(500);
    await selectFilterOption(page, 'Open');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 1 row (Has Status with Open)
    await assertRowCount(page, 1);
  });
});
