/**
 * Database Checkbox Filter Tests (Desktop Parity)
 *
 * Tests for checkbox field filtering.
 * Migrated from: cypress/e2e/database2/filter-checkbox.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  clickFilterChip,
  deleteFilter,
  assertRowCount,
  CheckboxFilterCondition,
  changeCheckboxFilterCondition,
  getPrimaryFieldId,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  toggleCheckbox,
  typeTextIntoCell,
  FieldType,
} from '../../support/field-type-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';

test.describe('Database Checkbox Filter Tests (Desktop Parity)', () => {
  test('filter by checked checkboxes', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Task One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Task Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Task Three');
    await page.waitForTimeout(500);

    // Check first and third rows
    await toggleCheckbox(page, checkboxFieldId, 0);
    await toggleCheckbox(page, checkboxFieldId, 2);
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter on Checkbox field
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);

    // Change condition to "Is Checked"
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.waitForTimeout(500);

    // Close filter popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify only checked rows visible (Task One and Task Three)
    await assertRowCount(page, 2);
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).toContainText(['Task One']);
    await expect(cells).toContainText(['Task Three']);
    await expect(cells).not.toContainText(['Task Two']);
  });

  test('filter by unchecked checkboxes', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Completed Task');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Pending Task');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Another Pending');
    await page.waitForTimeout(500);

    // Check only the first row
    await toggleCheckbox(page, checkboxFieldId, 0);
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter on Checkbox field
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);

    // Change condition to "Is Unchecked"
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsUnchecked);
    await page.waitForTimeout(500);

    // Close filter popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify only unchecked rows visible (Pending Task and Another Pending)
    await assertRowCount(page, 2);
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).toContainText(['Pending Task']);
    await expect(cells).toContainText(['Another Pending']);
    await expect(cells).not.toContainText(['Completed Task']);
  });

  test('toggle checkbox updates filtered view', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Task A');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Task B');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Task C');
    await page.waitForTimeout(500);

    // Add filter for "Is Checked"
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // No rows should be visible (none are checked)
    await assertRowCount(page, 0);

    // Delete the filter
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await deleteFilter(page);
    await page.waitForTimeout(500);

    // Verify all rows are back
    await assertRowCount(page, 3);

    // Check one row
    await toggleCheckbox(page, checkboxFieldId, 0);
    await page.waitForTimeout(500);

    // Re-add filter for "Is Checked"
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Now 1 row should be visible
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText(['Task A']);
  });

  test('checkbox filter - delete filter restores all rows', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Task One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Task Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Task Three');
    await page.waitForTimeout(500);

    // Check first and third rows
    await toggleCheckbox(page, checkboxFieldId, 0);
    await toggleCheckbox(page, checkboxFieldId, 2);
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter for "Is Checked"
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 2 checked rows
    await assertRowCount(page, 2);

    // Delete the filter
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await deleteFilter(page);
    await page.waitForTimeout(500);

    // All rows should be visible again
    await assertRowCount(page, 3);
  });

  test('checkbox filter - change condition dynamically', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // Enter names
    await typeTextIntoCell(page, primaryFieldId, 0, 'Checked Task');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Unchecked Task');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Also Checked');
    await page.waitForTimeout(500);

    // Check first and third rows
    await toggleCheckbox(page, checkboxFieldId, 0);
    await toggleCheckbox(page, checkboxFieldId, 2);
    await page.waitForTimeout(500);

    await assertRowCount(page, 3);

    // Add filter for "Is Checked"
    await addFilterByFieldName(page, 'Checkbox');
    await page.waitForTimeout(500);
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 2 checked rows
    await assertRowCount(page, 2);

    // Change to "Is Unchecked"
    await clickFilterChip(page);
    await page.waitForTimeout(300);
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsUnchecked);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should show 1 unchecked row
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
    ).toContainText('Unchecked Task');
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).not.toContainText(['Checked Task']);
  });
});
