/**
 * Database Advanced Filter Tests (Desktop Parity)
 *
 * Tests for advanced filter functionality:
 * 1. Normal Mode UI (inline chips)
 * 2. Advanced Mode UI (filter panel)
 * 3. AND/OR Operator Logic
 * 4. Persistence Tests
 * 5. Combined Filter Tests
 *
 * Migrated from: cypress/e2e/database2/filter-advanced.cy.ts
 */
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { DatabaseFilterSelectors, DatabaseGridSelectors } from '../../support/selectors';
import { FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  clickFilterChip,
  assertRowCount,
  navigateAwayAndBack,
  CheckboxFilterCondition,
  changeCheckboxFilterCondition,
  SelectFilterCondition,
  selectFilterOption,
  changeSelectFilterCondition,
} from '../../support/filter-test-helpers';
import { addFieldWithType, toggleCheckbox } from '../../support/field-type-helpers';

// ---- Local helpers ----

async function clickFilterMoreOptions(page: Page): Promise<void> {
  await DatabaseFilterSelectors.filterMoreOptionsButton(page).click({ force: true });
  await page.waitForTimeout(300);
}

async function clickAddToAdvancedFilter(page: Page): Promise<void> {
  await page
    .locator('[data-slot="dropdown-menu-item"]')
    .filter({ hasText: /add to advanced filter/i })
    .click({ force: true });
  await page.waitForTimeout(2000);
}

async function openAdvancedFilterPanel(page: Page): Promise<void> {
  await DatabaseFilterSelectors.advancedFiltersBadge(page).click({ force: true });
  await page.waitForTimeout(500);
}

async function getFilterRowCountInPanel(page: Page): Promise<number> {
  return page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .getByTestId('advanced-filter-row')
    .count();
}

async function deleteFilterInPanelByIndex(page: Page, index: number): Promise<void> {
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .getByTestId('delete-advanced-filter-button')
    .nth(index)
    .click({ force: true });
  await page.waitForTimeout(500);
}

async function deleteAllFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: /delete filter/i }).click({ force: true });
  await page.waitForTimeout(500);
}

async function changeFilterOperator(page: Page, operator: 'And' | 'Or'): Promise<void> {
  const rows = page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .getByTestId('advanced-filter-row');
  const secondRow = rows.nth(1);
  const operatorBtn = secondRow.locator('button').filter({ hasText: /and|or/i }).first();
  await operatorBtn.click({ force: true });
  await page.waitForTimeout(300);

  await page
    .locator('[data-slot="dropdown-menu-item"]')
    .filter({ hasText: new RegExp(`^${operator}$`, 'i') })
    .click({ force: true });
  await page.waitForTimeout(500);
}

function assertFilterBadgeText(page: Page, expectedText: string) {
  return expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toContainText(expectedText);
}

async function assertInlineFiltersVisible(page: Page, count: number): Promise<void> {
  if (count === 0) {
    await expect(DatabaseFilterSelectors.filterCondition(page)).toHaveCount(0);
  } else {
    await expect(DatabaseFilterSelectors.filterCondition(page)).toHaveCount(count);
  }
}

/** Add a checkbox field, enter data, and get helper references */
async function setupWithCheckboxField(
  page: Page,
  request: APIRequestContext,
  names: string[]
) {
  const email = generateRandomEmail();
  await loginAndCreateGrid(page, request, email);
  const primaryFieldId = await getPrimaryFieldId(page);
  const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
  await page.waitForTimeout(1000);

  for (let i = 0; i < names.length; i++) {
    await typeTextIntoCell(page, primaryFieldId, i, names[i]);
  }
  await page.waitForTimeout(500);

  return { primaryFieldId, checkboxFieldId };
}

// ---- Tests ----

test.describe('Database Advanced Filter Tests (Desktop Parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupFilterTest(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // =========================================================================
  // SECTION 1: Normal Mode UI Tests
  // =========================================================================

  test.describe('Normal Mode UI', () => {
    test('filter displays as inline chip in normal mode', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Task One', 'Task Two', 'Task Three']
      );

      // Check the first row
      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add a filter - should show as inline chip (normal mode)
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Verify filter is applied (1 checked row)
      await assertRowCount(page, 1);

      // Inline filter chip should be visible, advanced badge should NOT
      await assertInlineFiltersVisible(page, 1);
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toHaveCount(0);
    });

    test('disclosure button shows delete and add to advanced options', async ({
      page,
      request,
    }) => {
      await setupWithCheckboxField(page, request, ['Task One']);

      await addFilterByFieldName(page, 'Checkbox');
      await clickFilterChip(page);
      await clickFilterMoreOptions(page);

      // Verify both options are visible
      await expect(
        page.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: /delete filter/i })
      ).toBeVisible();
      await expect(
        page
          .locator('[data-slot="dropdown-menu-item"]')
          .filter({ hasText: /add to advanced filter/i })
      ).toBeVisible();
    });

    test('transition from normal to advanced mode', async ({ page, request }) => {
      const { primaryFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Task One', 'Task Two', 'Task Three']
      );

      // Add first filter (Name)
      await addFilterByFieldName(page, 'Name');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Add second filter (Checkbox)
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Checkbox').click({ force: true });
      await page.waitForTimeout(1000);

      // Verify normal mode (inline chips visible)
      await assertInlineFiltersVisible(page, 2);

      // Click filter chip → more options → add to advanced
      await clickFilterChip(page);
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // Verify advanced mode
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
      await assertInlineFiltersVisible(page, 0);
      await assertFilterBadgeText(page, '2 rules');
    });
  });

  // =========================================================================
  // SECTION 2: Advanced Mode UI Tests
  // =========================================================================

  test.describe('Advanced Mode UI', () => {
    test('filter panel shows all active filters', async ({ page, request }) => {
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);
      const primaryFieldId = await getPrimaryFieldId(page);

      await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);
      await addFieldWithType(page, FieldType.Number);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Task One');
      await page.waitForTimeout(500);

      // Add 3 filters
      await addFilterByFieldName(page, 'Name');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Checkbox').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Number').click({ force: true });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // Open filter panel and verify all 3 filters
      await openAdvancedFilterPanel(page);
      expect(await getFilterRowCountInPanel(page)).toBe(3);
    });

    test('delete filters one by one from panel', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Task One', 'Task Two', 'Task Three']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add 2 filters
      await addFilterByFieldName(page, 'Name');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Checkbox').click({ force: true });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      await openAdvancedFilterPanel(page);
      expect(await getFilterRowCountInPanel(page)).toBe(2);

      // Delete first filter
      await deleteFilterInPanelByIndex(page, 0);
      expect(await getFilterRowCountInPanel(page)).toBe(1);

      // Delete remaining filter
      await deleteFilterInPanelByIndex(page, 0);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // All rows should be back
      await assertRowCount(page, 3);
    });

    test('delete all filters button clears all filters', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Task One', 'Task Two', 'Task Three']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add checkbox filter (is checked)
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await assertRowCount(page, 2);

      // Add name filter
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      await openAdvancedFilterPanel(page);
      expect(await getFilterRowCountInPanel(page)).toBe(2);

      // Delete all filters
      await deleteAllFilters(page);

      // All 3 rows should be back
      await assertRowCount(page, 3);
      await assertInlineFiltersVisible(page, 0);
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toHaveCount(0);
    });
  });

  // =========================================================================
  // SECTION 3: AND/OR Operator Logic Tests
  // =========================================================================

  test.describe('AND/OR Operator Logic', () => {
    test('AND operator combines filters with intersection logic', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Apple', 'Banana', 'Cherry']
      );

      // Check first two rows
      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 1);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add Checkbox filter (is checked) → 2 rows
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await assertRowCount(page, 2);

      // Add Name filter (contains "Apple")
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Apple', { delay: 30 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // With AND (default), only "Apple" row visible
      await assertRowCount(page, 1);
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
      ).toContainText('Apple');
    });

    test('OR operator combines filters with union logic', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Apple', 'Banana', 'Cherry']
      );

      // Check only first row
      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add Checkbox filter (is checked)
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Add Name filter (contains "Cherry")
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Cherry', { delay: 30 });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // With AND: 0 rows
      await assertRowCount(page, 0);

      // Switch to OR
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // With OR: 2 rows (Apple checked OR Cherry)
      await assertRowCount(page, 2);
      const orCells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
      await expect(orCells).toContainText(['Apple', 'Cherry']);
    });

    test('toggle AND to OR to AND maintains correct logic', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Alpha', 'Beta', 'Gamma']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);

      // Add 2 filters
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Gamma', { delay: 30 });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // AND: 0 rows
      await assertRowCount(page, 0);

      // Switch to OR
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // OR: 2 rows
      await assertRowCount(page, 2);

      // Switch back to AND
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'And');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // AND again: 0 rows
      await assertRowCount(page, 0);
    });

    test('row count updates immediately after operator change', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Item X', 'Item Y', 'Item Z']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);

      // Add 2 filters
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Item Z', { delay: 30 });
      await page.waitForTimeout(500);

      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // AND: 0 rows
      await assertRowCount(page, 0);

      // Toggle OR → 2 rows
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await assertRowCount(page, 2);

      // Toggle AND → 0 rows
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'And');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await assertRowCount(page, 0);

      // Toggle OR → 2 rows
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await assertRowCount(page, 2);
    });

    test('AND is the default operator for multiple filters', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Task A', 'Task B', 'Task C']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 1);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add first filter
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await assertRowCount(page, 2);

      // Add second filter
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Task A', { delay: 30 });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // Default AND: 1 row
      await assertRowCount(page, 1);

      // Verify AND operator is shown
      await openAdvancedFilterPanel(page);
      await expect(
        page.locator('[data-radix-popper-content-wrapper]').last()
      ).toContainText('And');
    });

    test('delete filter maintains operator state', async ({ page, request }) => {
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);
      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);
      await addFieldWithType(page, FieldType.Number);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, primaryFieldId, 0, 'Row 1');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Row 2');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Row 3');
      await page.waitForTimeout(500);

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);

      // Add 3 filters
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Number').click({ force: true });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // Change to OR
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await assertFilterBadgeText(page, '3 rules');

      // Delete middle filter
      await openAdvancedFilterPanel(page);
      await deleteFilterInPanelByIndex(page, 1);
      expect(await getFilterRowCountInPanel(page)).toBe(2);

      // Verify operator is still OR
      await expect(
        page.locator('[data-radix-popper-content-wrapper]').last()
      ).toContainText('Or');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await assertFilterBadgeText(page, '2 rules');
    });
  });

  // =========================================================================
  // SECTION 4: Persistence Tests
  // =========================================================================

  test.describe('Persistence Tests', () => {
    test('advanced filter persists after close and reopen', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['Persist One', 'Persist Two', 'Persist Three']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add 2 filters and convert to advanced mode
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Persist One', { delay: 30 });
      await page.waitForTimeout(500);

      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // With AND: 1 row
      await assertRowCount(page, 1);
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
      await assertFilterBadgeText(page, '2 rules');

      // Navigate away and back
      await navigateAwayAndBack(page);

      // Verify filter persists
      await assertRowCount(page, 1);
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
      await assertFilterBadgeText(page, '2 rules');

      await openAdvancedFilterPanel(page);
      expect(await getFilterRowCountInPanel(page)).toBe(2);
    });

    test('OR operator persists after close and reopen', async ({ page, request }) => {
      const { primaryFieldId, checkboxFieldId } = await setupWithCheckboxField(
        page,
        request,
        ['OR Test One', 'OR Test Two', 'OR Test Three']
      );

      await toggleCheckbox(page, checkboxFieldId, 0);
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);

      // Add 2 filters
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
      await page.waitForTimeout(500);

      await page.getByTestId('text-filter-input').clear();
      await page
        .getByTestId('text-filter-input')
        .pressSequentially('OR Test Three', { delay: 30 });
      await page.waitForTimeout(500);

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // AND: 0 rows
      await assertRowCount(page, 0);

      // Change to OR
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // OR: 2 rows
      await assertRowCount(page, 2);

      // Navigate away and back
      await navigateAwayAndBack(page);

      // Verify OR persists
      await assertRowCount(page, 2);
      await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();

      await openAdvancedFilterPanel(page);
      await expect(
        page.locator('[data-radix-popper-content-wrapper]').last()
      ).toContainText('Or');
    });
  });

  // =========================================================================
  // SECTION 5: Combined Filter Tests
  // =========================================================================

  test.describe('Combined Filter Tests', () => {
    test('checkbox AND single select combined filter', async ({ page, request }) => {
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);
      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);
      const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
      await page.waitForTimeout(1500);

      // Set up data
      await typeTextIntoCell(page, primaryFieldId, 0, 'Checked High');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Unchecked High');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Checked Low');
      await page.waitForTimeout(500);

      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // Create and assign select options
      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(0)
        .click({ force: true });
      await page.waitForTimeout(1000);
      const selectMenu = page.getByTestId('select-option-menu');
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.locator('input').first().clear();
      await selectMenu.locator('input').first().pressSequentially('High', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(1)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.getByText('High').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(2)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.locator('input').first().clear();
      await selectMenu.locator('input').first().pressSequentially('Low', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await assertRowCount(page, 3);

      // Add Checkbox filter (is checked)
      await addFilterByFieldName(page, 'Checkbox');
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Add Select filter (option is High)
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
      await page.waitForTimeout(500);
      await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
      await selectFilterOption(page, 'High');

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // AND: Only "Checked High" (1 row)
      await assertRowCount(page, 1);
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
      ).toContainText('Checked High');

      // Change to OR → all 3 rows
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await assertRowCount(page, 3);
    });

    test('three filters combined with AND/OR', async ({ page, request }) => {
      const email = generateRandomEmail();
      await loginAndCreateGrid(page, request, email);
      const primaryFieldId = await getPrimaryFieldId(page);

      const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
      await page.waitForTimeout(1000);
      const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
      await page.waitForTimeout(1500);

      // Set up data
      await typeTextIntoCell(page, primaryFieldId, 0, 'Alpha');
      await typeTextIntoCell(page, primaryFieldId, 1, 'Beta');
      await typeTextIntoCell(page, primaryFieldId, 2, 'Gamma');
      await page.waitForTimeout(500);

      await toggleCheckbox(page, checkboxFieldId, 0);
      await toggleCheckbox(page, checkboxFieldId, 2);
      await page.waitForTimeout(500);

      // Create and assign select options
      const selectMenu = page.getByTestId('select-option-menu');

      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(0)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.locator('input').first().clear();
      await selectMenu.locator('input').first().pressSequentially('Active', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(1)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.getByText('Active').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await DatabaseGridSelectors.dataRowCellsForField(page, selectFieldId)
        .nth(2)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });
      await selectMenu.locator('input').first().clear();
      await selectMenu.locator('input').first().pressSequentially('Inactive', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await assertRowCount(page, 3);

      // Filter 1: Name contains "Alpha"
      await addFilterByFieldName(page, 'Name');
      await page.getByTestId('text-filter-input').clear();
      await page.getByTestId('text-filter-input').pressSequentially('Alpha', { delay: 30 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Filter 2: Checkbox is checked
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Checkbox').click({ force: true });
      await page.waitForTimeout(500);
      await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Filter 3: Select option is Active
      await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
      await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
      await page.waitForTimeout(500);
      await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
      await selectFilterOption(page, 'Active');

      // Convert to advanced mode
      await clickFilterMoreOptions(page);
      await clickAddToAdvancedFilter(page);

      // Verify 3 filters
      await openAdvancedFilterPanel(page);
      expect(await getFilterRowCountInPanel(page)).toBe(3);

      // AND: Only Alpha (1 row)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await assertRowCount(page, 1);
      await expect(
        DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
      ).toContainText('Alpha');

      // Change to OR → all 3 rows
      await openAdvancedFilterPanel(page);
      await changeFilterOperator(page, 'Or');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await assertRowCount(page, 3);
    });
  });
});
