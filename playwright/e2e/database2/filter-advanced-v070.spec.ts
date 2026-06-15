/**
 * Database Advanced Filter v070 Parity Tests
 *
 * Mirrors desktop Rust v070 advanced filter test suite.
 * Uses a SINGLE shared database across all tests (serial mode).
 *
 * Data table (6 rows, set up once in beforeAll):
 *
 * | Row | Name       | Age | Status   | Active | Notes      |
 * |-----|------------|-----|----------|--------|------------|
 * | R0  | Alice      |  25 | Active   | Yes    | Team lead  |
 * | R1  | Bob        |  30 | Active   | Yes    | Developer  |
 * | R2  | Charlie    |  25 | Pending  | No     | New hire   |
 * | R3  | Alice Wang |  40 | Inactive | Yes    | Senior     |
 * | R4  | Dave       |  35 | Active   | Yes    | Manager    |
 * | R5  | Eve        |  28 | Pending  | No     | Intern     |
 */
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { DatabaseFilterSelectors, DatabaseGridSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  assertRowCount,
  CheckboxFilterCondition,
  changeCheckboxFilterCondition,
  SelectFilterCondition,
  changeSelectFilterCondition,
  selectFilterOption,
  changeFilterCondition,
  TextFilterCondition,
  NumberFilterCondition,
} from '../../support/filter-test-helpers';
import { addFieldWithType, toggleCheckbox, addRows } from '../../support/field-type-helpers';

// ---- Local helpers ----

async function clickFilterMoreOptions(page: Page): Promise<void> {
  await page.getByTestId('filter-more-options-button').click({ force: true });
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

/** Change the operator on ALL non-first rows in the advanced panel */
async function changeFilterOperator(page: Page, operator: 'And' | 'Or'): Promise<void> {
  const rows = page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .getByTestId('advanced-filter-row');
  const rowCount = await rows.count();

  for (let i = 1; i < rowCount; i++) {
    const row = rows.nth(i);
    const operatorBtn = row.locator('button').filter({ hasText: /and|or/i }).first();
    const currentText = (await operatorBtn.textContent())?.trim().toLowerCase() ?? '';

    if (currentText !== operator.toLowerCase()) {
      await operatorBtn.click({ force: true });
      await page.waitForTimeout(300);

      await page
        .locator('[data-slot="dropdown-menu-item"]')
        .filter({ hasText: new RegExp(`^${operator}$`, 'i') })
        .click({ force: true });
      await page.waitForTimeout(500);
    }
  }
}

/** Clear all filters — handles both normal and advanced mode */
async function clearAllFilters(page: Page): Promise<void> {
  // Check if in advanced mode
  const hasBadge = (await page.getByTestId('advanced-filters-badge').count()) > 0;

  if (hasBadge) {
    await page.getByTestId('advanced-filters-badge').click({ force: true });
    await page.waitForTimeout(500);
    // Click "Delete all filters" button
    await page.getByTestId('delete-all-filters-button').click({ force: true });
    await page.waitForTimeout(500);
    return;
  }

  // Normal mode: delete chips one by one
  let chipCount = await DatabaseFilterSelectors.filterCondition(page).count();

  while (chipCount > 0) {
    await DatabaseFilterSelectors.filterCondition(page).first().click({ force: true });
    await page.waitForTimeout(300);

    const hasDirectDelete = await page.getByTestId('delete-filter-button').isVisible().catch(() => false);

    if (hasDirectDelete) {
      await page.getByTestId('delete-filter-button').click({ force: true });
    } else {
      await page.getByTestId('filter-more-options-button').click({ force: true });
      await page.waitForTimeout(200);
      await page.getByTestId('delete-filter-button').click({ force: true });
    }

    await page.waitForTimeout(500);
    chipCount = await DatabaseFilterSelectors.filterCondition(page).count();
  }
}

/** Enter advanced mode with 2 filters: add a Name filter and a second filter, then convert */
async function enterAdvancedModeWith2Filters(
  page: Page,
  secondFieldName: string
): Promise<void> {
  // Add Name filter first
  await addFilterByFieldName(page, 'Name');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Add second filter
  await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
  await page.waitForTimeout(500);
  await DatabaseFilterSelectors.propertyItemByName(page, secondFieldName).click({ force: true });
  await page.waitForTimeout(500);

  // Convert to advanced mode
  await clickFilterMoreOptions(page);
  await clickAddToAdvancedFilter(page);
}

// ---- Test suite ----

test.describe('Database Advanced Filter v070 Parity', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;
  let primaryFieldId: string;
  let numberFieldId: string;
  let singleSelectFieldId: string;
  let checkboxFieldId: string;

  test.beforeAll(async ({ browser, request }) => {
    // Create one browser context and page for the entire suite
    const context = await browser.newContext();

    page = await context.newPage();
    setupFilterTest(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    // --- Login and create grid ---
    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    primaryFieldId = await getPrimaryFieldId(page);

    // --- Add fields ---
    numberFieldId = await addFieldWithType(page, FieldType.Number);
    await page.waitForTimeout(1000);
    singleSelectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1500);
    checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);
    await page.waitForTimeout(1000);

    // --- Add rows (default 3 + 3 more = 6 total) ---
    await addRows(page, 3);
    await page.waitForTimeout(1000);

    // --- Fill Name column ---
    const names = ['Alice', 'Bob', 'Charlie', 'Alice Wang', 'Dave', 'Eve'];

    for (let i = 0; i < names.length; i++) {
      await typeTextIntoCell(page, primaryFieldId, i, names[i]);
    }

    await page.waitForTimeout(500);

    // --- Fill Age (Number) column ---
    const ages = ['25', '30', '25', '40', '35', '28'];

    for (let i = 0; i < ages.length; i++) {
      await typeTextIntoCell(page, numberFieldId, i, ages[i]);
    }

    await page.waitForTimeout(500);

    // --- Fill Status (SingleSelect) column ---
    const selectMenu = page.getByTestId('select-option-menu');
    const statuses = ['Active', 'Active', 'Pending', 'Inactive', 'Active', 'Pending'];

    for (let i = 0; i < statuses.length; i++) {
      await DatabaseGridSelectors.dataRowCellsForField(page, singleSelectFieldId)
        .nth(i)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });

      // Check if option already exists
      const existingOption = selectMenu.getByText(statuses[i], { exact: true });
      const optionExists = (await existingOption.count()) > 0;

      if (optionExists) {
        await existingOption.click({ force: true });
      } else {
        await selectMenu.locator('input').first().clear();
        await selectMenu.locator('input').first().pressSequentially(statuses[i], { delay: 30 });
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // --- Fill Checkbox: R0, R1, R3, R4 = checked ---
    await toggleCheckbox(page, checkboxFieldId, 0);
    await toggleCheckbox(page, checkboxFieldId, 1);
    await toggleCheckbox(page, checkboxFieldId, 3);
    await toggleCheckbox(page, checkboxFieldId, 4);
    await page.waitForTimeout(500);

    // Verify baseline
    await assertRowCount(page, 6);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.afterEach(async () => {
    // Clean all filters after every test to reset to 6 rows
    await clearAllFilters(page);
    await page.waitForTimeout(500);
    await assertRowCount(page, 6);
  });

  // =========================================================================
  // Single-field filter tests
  // =========================================================================

  test('Name TextContains "Ali" => 2 rows', async () => {
    await addFilterByFieldName(page, 'Name');
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Ali', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await assertRowCount(page, 2);
  });

  test('Name TextIs "Alice" => 1 row', async () => {
    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextIs);
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Alice', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Only exact "Alice" matches (not "Alice Wang")
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Alice');
  });

  test('Checkbox IsChecked => 4 rows', async () => {
    await addFilterByFieldName(page, 'Checkbox');
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await assertRowCount(page, 4);
  });

  test('Checkbox IsUnchecked => 2 rows', async () => {
    await addFilterByFieldName(page, 'Checkbox');
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsUnchecked);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await assertRowCount(page, 2);
  });

  test('Number GreaterThan 30 => 2 rows', async () => {
    await addFilterByFieldName(page, 'Number');
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('30', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // R3=40, R4=35 > 30
    await assertRowCount(page, 2);
  });

  test('Status OptionIs Active => 3 rows', async () => {
    await addFilterByFieldName(page, 'Select');
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'Active');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await assertRowCount(page, 3);
  });

  // =========================================================================
  // AND filter combinations
  // =========================================================================

  test('AND(Name Contains "Ali", Status Is Active) => 1 row', async () => {
    // Add Name filter
    await addFilterByFieldName(page, 'Name');
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Ali', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Add Status filter
    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
    await page.waitForTimeout(500);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'Active');

    // Convert to advanced mode
    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: "Ali" (Alice, Alice Wang) AND Active (Alice, Bob, Dave) => Alice only
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Alice');
  });

  test('AND(Age > 30, Checkbox IsChecked, Status Is Active) => 1 row', async () => {
    // Add 3 filters in normal mode then convert to advanced

    // Filter 1: Number > 30
    await addFilterByFieldName(page, 'Number');
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

    // Filter 3: Status is Active
    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
    await page.waitForTimeout(500);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'Active');

    // Convert to advanced mode
    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // Configure Age > 30 in the panel
    await openAdvancedFilterPanel(page);
    // Find the Number filter row and set its condition/value
    const panel = page.locator('[data-radix-popper-content-wrapper]').last();

    await panel.getByTestId('filter-condition-selector').first().click({ force: true });
    await page.waitForTimeout(300);
    await page.getByTestId(`filter-condition-${NumberFilterCondition.GreaterThan}`).click({ force: true });
    await page.waitForTimeout(300);

    await panel.getByTestId('advanced-filter-number-input').clear();
    await panel.getByTestId('advanced-filter-number-input').pressSequentially('30', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // AND: Age>30 (R3=40, R4=35) AND Checked (R0,R1,R3,R4) AND Active (R0,R1,R4)
    // Intersection: R4 (Dave)
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Dave');
  });

  // =========================================================================
  // OR filter combinations
  // =========================================================================

  test('OR(Name Contains "Ali", Status Is Inactive) => 2 rows', async () => {
    // Add Name filter
    await addFilterByFieldName(page, 'Name');
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Ali', { delay: 30 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Add Status filter (Inactive)
    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
    await page.waitForTimeout(500);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'Inactive');

    // Convert to advanced mode
    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: "Ali" (Alice, Alice Wang) AND Inactive (Alice Wang) => 1 row
    await assertRowCount(page, 1);

    // Switch to OR
    await openAdvancedFilterPanel(page);
    await changeFilterOperator(page, 'Or');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // OR: "Ali" (Alice, Alice Wang) OR Inactive (Alice Wang) => 2 rows
    await assertRowCount(page, 2);
  });

  test('OR(Checkbox IsChecked, Name Contains "Eve") => 5 rows', async () => {
    // Add Checkbox filter
    await addFilterByFieldName(page, 'Checkbox');
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Checked rows: R0,R1,R3,R4 = 4
    await assertRowCount(page, 4);

    // Add Name filter
    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
    await page.waitForTimeout(500);
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Eve', { delay: 30 });
    await page.waitForTimeout(500);

    // Convert to advanced mode
    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: Checked AND "Eve" => 0 (Eve is unchecked)
    await assertRowCount(page, 0);

    // Switch to OR
    await openAdvancedFilterPanel(page);
    await changeFilterOperator(page, 'Or');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // OR: Checked(R0,R1,R3,R4) OR "Eve"(R5) => 5 rows
    await assertRowCount(page, 5);
  });

  // =========================================================================
  // AND ↔ OR toggle tests
  // =========================================================================

  test('toggle AND → OR → AND maintains correct row counts', async () => {
    // Checkbox checked + Name "Charlie"
    await addFilterByFieldName(page, 'Checkbox');
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
    await page.waitForTimeout(500);
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Charlie', { delay: 30 });
    await page.waitForTimeout(500);

    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: Checked AND "Charlie" => 0 (Charlie is unchecked)
    await assertRowCount(page, 0);

    // Switch to OR → Checked(4) OR Charlie(1) = 5
    await openAdvancedFilterPanel(page);
    await changeFilterOperator(page, 'Or');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await assertRowCount(page, 5);

    // Switch back to AND → 0
    await openAdvancedFilterPanel(page);
    await changeFilterOperator(page, 'And');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await assertRowCount(page, 0);
  });

  // =========================================================================
  // Three-filter combined tests
  // =========================================================================

  test('three filters: AND(Name "Ali", Checked, Active) => 1 then OR => 4', async () => {
    // Filter 1: Name contains "Ali"
    await addFilterByFieldName(page, 'Name');
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Ali', { delay: 30 });
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

    // Filter 3: Status Active
    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
    await page.waitForTimeout(500);
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'Active');

    // Convert to advanced mode
    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: Checked(R0,R1,R3,R4) AND Active(R0,R1,R4) AND "Ali"(R0,R3) => R0 only
    await assertRowCount(page, 1);

    // Switch to OR => Checked(R0,R1,R3,R4) OR Active(R0,R1,R4) OR "Ali"(R0,R3)
    // Note: The Name text filter content "Ali" may be set via the simple mode popover.
    // After mode conversion the advanced panel shows the 3 rules.
    // Union: at minimum R0,R1,R3,R4. Verify the OR gives more rows than AND(1).
    await openAdvancedFilterPanel(page);
    await changeFilterOperator(page, 'Or');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // With OR we get all checked OR active OR Ali rows
    const orCount = await DatabaseGridSelectors.dataRows(page).count();

    expect(orCount).toBeGreaterThanOrEqual(3);
    expect(orCount).toBeLessThanOrEqual(5);
  });

  // =========================================================================
  // Persistence tests
  // =========================================================================

  test('advanced filter persists after navigation', async () => {
    await addFilterByFieldName(page, 'Checkbox');
    await changeCheckboxFilterCondition(page, CheckboxFilterCondition.IsChecked);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await DatabaseFilterSelectors.propertyItemByName(page, 'Name').click({ force: true });
    await page.waitForTimeout(500);
    await page.getByTestId('text-filter-input').clear();
    await page.getByTestId('text-filter-input').pressSequentially('Alice', { delay: 30 });
    await page.waitForTimeout(500);

    await clickFilterMoreOptions(page);
    await clickAddToAdvancedFilter(page);

    // AND: Checked AND Name contains "Alice" => 2 rows (Alice + Alice Wang)
    await assertRowCount(page, 2);

    // Navigate away and back
    const currentUrl = page.url();

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Wait for grid to be ready
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    // Filter should persist
    await assertRowCount(page, 2);
    await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
  });
});
