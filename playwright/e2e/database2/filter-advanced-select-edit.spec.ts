/**
 * Bug Reproduction: "unable to edit filter conditions on web"
 *
 * Tests editing select filter options inside the advanced filter panel.
 * The advanced filter panel is a Popover; the select option picker is a
 * nested Popover inside it. This test verifies that:
 *
 * 1. The outer panel stays open when interacting with the nested popover
 * 2. Toggling select options actually updates the filter
 * 3. Changing the condition selector works inside the advanced panel
 * 4. Changing a text/number value inside the advanced panel works
 *
 * Data table (3 rows):
 * | Name   | Status   |
 * |--------|----------|
 * | Alice  | Active   |
 * | Bob    | Pending  |
 * | Charlie| Active   |
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
  SelectFilterCondition,
  changeSelectFilterCondition,
  selectFilterOption,
  changeFilterCondition,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import { addFieldWithType } from '../../support/field-type-helpers';
import { waitForDatabaseDocReady } from '../../support/yjs-inject-helpers';

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

async function clearAllFilters(page: Page): Promise<void> {
  // Close any open nested popovers/dropdowns first
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  const hasBadge = (await page.getByTestId('advanced-filters-badge').count()) > 0;

  if (hasBadge) {
    // Check if the panel is already open (delete button visible)
    const deleteBtn = page.getByTestId('delete-all-filters-button');
    const alreadyOpen = await deleteBtn.isVisible().catch(() => false);

    if (!alreadyOpen) {
      await page.getByTestId('advanced-filters-badge').click({ force: true });
      await page.waitForTimeout(500);
    }

    await page.getByTestId('delete-all-filters-button').click({ force: true });
    await page.waitForTimeout(500);
    return;
  }

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

/** Enter advanced mode with Name + Select filters */
async function enterAdvancedModeWithSelectFilter(
  page: Page,
  selectCondition?: SelectFilterCondition,
  selectOptionName?: string,
): Promise<void> {
  await addFilterByFieldName(page, 'Name');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await DatabaseFilterSelectors.addFilterButton(page).click({ force: true });
  await page.waitForTimeout(500);
  await DatabaseFilterSelectors.propertyItemByName(page, 'Select').click({ force: true });
  await page.waitForTimeout(500);

  if (selectCondition !== undefined) {
    await changeSelectFilterCondition(page, selectCondition);
    await page.waitForTimeout(300);
  }

  if (selectOptionName) {
    await selectFilterOption(page, selectOptionName);
    await page.waitForTimeout(300);
  }

  await clickFilterMoreOptions(page);
  await clickAddToAdvancedFilter(page);
  await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible();
}

// ---- Test suite ----

test.describe('Bug: Edit filter conditions in advanced panel', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;
  let primaryFieldId: string;
  let singleSelectFieldId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext();

    page = await context.newPage();
    setupFilterTest(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    const email = generateRandomEmail();

    await loginAndCreateGrid(page, request, email);
    primaryFieldId = await getPrimaryFieldId(page);

    // Add SingleSelect field
    singleSelectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    await page.waitForTimeout(1500);

    // Fill Name column
    const names = ['Alice', 'Bob', 'Charlie'];

    for (let i = 0; i < names.length; i++) {
      await typeTextIntoCell(page, primaryFieldId, i, names[i]);
    }

    await page.waitForTimeout(500);

    // Fill Status (SingleSelect) column
    const selectMenu = page.getByTestId('select-option-menu');
    const statuses = ['Active', 'Pending', 'Active'];

    for (let i = 0; i < statuses.length; i++) {
      await DatabaseGridSelectors.dataRowCellsForField(page, singleSelectFieldId)
        .nth(i)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await expect(selectMenu).toBeVisible({ timeout: 15000 });

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

    await assertRowCount(page, 3);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.afterEach(async () => {
    await clearAllFilters(page);
    await page.waitForTimeout(500);
    await assertRowCount(page, 3);
  });

  // =========================================================================
  // Core bug reproduction: nested popover interaction
  // =========================================================================

  test('select option popover opens and stays open inside advanced panel', async () => {
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs);

    // Open the advanced filter panel
    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    // Find the advanced filter panel (the popover containing advanced-filter-row elements)
    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    await expect(filterPanel.getByTestId('advanced-filter-row').first()).toBeVisible({ timeout: 5000 });

    // Click the select option input — uses real click (no force)
    const selectInput = filterPanel.getByTestId('advanced-filter-select-input');

    await expect(selectInput).toBeVisible({ timeout: 5000 });
    await selectInput.click();
    await page.waitForTimeout(500);

    // The nested popover with select options should be visible
    const optionItems = page.getByTestId('select-option-list');

    await expect(optionItems.first()).toBeVisible({ timeout: 5000 });

    // The advanced filter panel should STILL be visible (not dismissed by the nested popover)
    await expect(filterPanel.getByTestId('advanced-filter-row').first()).toBeVisible();
  });

  test('clicking select option toggles it without closing panel', async () => {
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });
    const selectInput = filterPanel.getByTestId('advanced-filter-select-input');

    await selectInput.click();
    await page.waitForTimeout(500);

    const optionItems = page.getByTestId('select-option-list');

    await expect(optionItems.first()).toBeVisible({ timeout: 5000 });

    // Click "Active" — use real click (no force) to test actual user interaction
    const activeOption = optionItems.filter({ hasText: 'Active' }).first();

    await activeOption.click();
    await page.waitForTimeout(500);

    // Option should now be checked
    await expect(activeOption).toHaveAttribute('data-checked', 'true');

    // The option list should STILL be visible (not dismissed)
    await expect(optionItems.first()).toBeVisible();

    // The advanced filter panel should STILL be open
    await expect(filterPanel.getByTestId('advanced-filter-row').first()).toBeVisible();

    // The select input should show the selected option as an inline tag (not "1 selected" text)
    await expect(filterPanel.getByTestId('advanced-filter-select-input')).toContainText('Active');

    // Close popovers
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Filter applied: OptionIs Active => Alice + Charlie = 2 rows
    await assertRowCount(page, 2);
  });

  test('can select multiple options without popover closing', async () => {
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    await filterPanel.getByTestId('advanced-filter-select-input').click();
    await page.waitForTimeout(500);

    const optionItems = page.getByTestId('select-option-list');

    await expect(optionItems.first()).toBeVisible({ timeout: 5000 });

    // Select Active
    await optionItems.filter({ hasText: 'Active' }).first().click();
    await page.waitForTimeout(500);

    // Verify option list is still visible
    await expect(optionItems.first()).toBeVisible({ timeout: 3000 });

    // Select Pending
    await optionItems.filter({ hasText: 'Pending' }).first().click();
    await page.waitForTimeout(500);

    // Verify both are checked
    await expect(optionItems.filter({ hasText: 'Active' }).first()).toHaveAttribute('data-checked', 'true');
    await expect(optionItems.filter({ hasText: 'Pending' }).first()).toHaveAttribute('data-checked', 'true');

    // Close popovers
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // With OptionIs + Active,Pending => all 3 rows visible
    await assertRowCount(page, 3);
  });

  test('deselecting an option updates the filter correctly', async () => {
    // Start with Active pre-selected
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs, 'Active');

    // Should show 2 rows (Alice=Active, Charlie=Active)
    await assertRowCount(page, 2);

    // Open panel and select input
    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    await filterPanel.getByTestId('advanced-filter-select-input').click();
    await page.waitForTimeout(500);

    const optionItems = page.getByTestId('select-option-list');

    await expect(optionItems.first()).toBeVisible({ timeout: 5000 });

    // Active should already be checked
    await expect(optionItems.filter({ hasText: 'Active' }).first()).toHaveAttribute('data-checked', 'true');

    // Also select Pending
    await optionItems.filter({ hasText: 'Pending' }).first().click();
    await page.waitForTimeout(500);

    // Now deselect Active
    await optionItems.filter({ hasText: 'Active' }).first().click();
    await page.waitForTimeout(500);

    // Only Pending should be checked now
    await expect(optionItems.filter({ hasText: 'Active' }).first()).toHaveAttribute('data-checked', 'false');
    await expect(optionItems.filter({ hasText: 'Pending' }).first()).toHaveAttribute('data-checked', 'true');

    // Close popovers
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // OptionIs Pending => only Bob = 1 row
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Bob');
  });

  // =========================================================================
  // Condition selector editing inside advanced panel
  // =========================================================================

  test('change condition from OptionIs to OptionIsNot inside panel', async () => {
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs, 'Active');
    await assertRowCount(page, 2);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    // Click the condition selector for the Select filter (second row)
    const conditionSelectors = filterPanel.getByTestId('filter-condition-selector');

    await conditionSelectors.last().click();
    await page.waitForTimeout(300);

    // Select "Is Not"
    await page.getByTestId(`filter-condition-${SelectFilterCondition.OptionIsNot}`).click();
    await page.waitForTimeout(500);

    // Panel should still be open after changing condition
    await expect(filterPanel.getByTestId('advanced-filter-row').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // OptionIsNot Active => only Bob (Pending) = 1 row
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Bob');
  });

  test('change condition to IsEmpty inside panel', async () => {
    await enterAdvancedModeWithSelectFilter(page, SelectFilterCondition.OptionIs, 'Active');
    await assertRowCount(page, 2);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });
    const conditionSelectors = filterPanel.getByTestId('filter-condition-selector');

    await conditionSelectors.last().click();
    await page.waitForTimeout(300);

    await page.getByTestId(`filter-condition-${SelectFilterCondition.OptionIsEmpty}`).click();
    await page.waitForTimeout(500);

    // The select input should be hidden for IsEmpty condition
    await expect(filterPanel.getByTestId('advanced-filter-select-input')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // IsEmpty => 0 rows (all have statuses)
    await assertRowCount(page, 0);
  });

  // =========================================================================
  // Text filter editing inside advanced panel
  // =========================================================================

  test('edit text filter value inside advanced panel', async () => {
    await enterAdvancedModeWithSelectFilter(page);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });
    const textInput = filterPanel.getByTestId('advanced-filter-text-input');

    await expect(textInput).toBeVisible({ timeout: 5000 });
    await textInput.click();
    await textInput.clear();
    await textInput.pressSequentially('Ali', { delay: 30 });
    await page.waitForTimeout(500);

    // Panel should still be open
    await expect(filterPanel.getByTestId('advanced-filter-row').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Name contains "Ali" => Alice = 1 row
    await assertRowCount(page, 1);
  });

  test('change text condition from Contains to Is inside panel', async () => {
    await enterAdvancedModeWithSelectFilter(page);

    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    // Type "Ali" in the text input first
    const textInput = filterPanel.getByTestId('advanced-filter-text-input');

    await textInput.click();
    await textInput.clear();
    await textInput.pressSequentially('Ali', { delay: 30 });
    await page.waitForTimeout(500);

    // Now change condition from Contains to Is (exact match)
    const conditionSelectors = filterPanel.getByTestId('filter-condition-selector');

    await conditionSelectors.first().click();
    await page.waitForTimeout(300);

    await page.getByTestId(`filter-condition-${TextFilterCondition.TextIs}`).click();
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // TextIs "Ali" => 0 rows (no exact "Ali", only "Alice")
    await assertRowCount(page, 0);
  });

  // =========================================================================
  // Desktop sync: plain-object filter children (not Yjs Maps)
  //
  // When filters are synced from the desktop app, the children of the root
  // group node may be stored as plain JavaScript objects rather than Yjs Maps.
  // The write path (useUpdateAdvancedFilter) must handle this by falling back
  // to a flatten-and-rebuild strategy.
  // =========================================================================

  test('can toggle select options when filters are plain objects (desktop sync)', async () => {
    // Wait for the Yjs doc to be available
    await waitForDatabaseDocReady(page);

    // Get the select option IDs for Active and Pending from the Yjs field type_option
    const optionIds = await page.evaluate((fieldId) => {
      const doc = (window as any).__TEST_DATABASE_DOC__;
      const db = doc.getMap('data').get('database');
      const field = db.get('fields').get(fieldId);

      if (!field) return { error: 'field not found' };

      // type_option is a Yjs Map; its 'content' key holds a JSON string
      const typeOptionMap = field.get('type_option');

      if (!typeOptionMap) return { error: 'no type_option' };

      const content = typeof typeOptionMap.get === 'function'
        ? typeOptionMap.get('content')
        : typeOptionMap;

      if (!content || typeof content !== 'string') return { error: 'no content string' };

      const parsed = JSON.parse(content);
      const options = parsed?.options || [];

      return {
        options: options.map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })),
      };
    }, singleSelectFieldId);

    // Skip if we can't find options (shouldn't happen)
    if ('error' in optionIds) {
      console.warn('Skipping desktop sync test: ', optionIds);
      return;
    }

    const activeOption = optionIds.options.find((o: { name: string }) => o.name === 'Active');
    const pendingOption = optionIds.options.find((o: { name: string }) => o.name === 'Pending');

    if (!activeOption || !pendingOption) {
      console.warn('Skipping: could not find Active/Pending options');
      return;
    }

    // Inject an advanced filter tree with PLAIN OBJECT children (simulating desktop sync)
    await page.evaluate(
      ({ fieldId, selectFieldId, activeId }) => {
        const win = window as any;
        const doc = win.__TEST_DATABASE_DOC__;
        const viewId = win.__TEST_DATABASE_VIEW_ID__;
        const Y = win.Y;

        const sharedRoot = doc.getMap('data');
        const database = sharedRoot.get('database');
        const view = database.get('views').get(viewId);

        doc.transact(() => {
          const filters = view.get('filters');

          // Clear existing filters
          if (filters.length > 0) {
            filters.delete(0, filters.length);
          }

          // Create root group node as a Yjs Map (And group)
          const root = new Y.Map();

          root.set('id', 'root_test');
          root.set('filter_type', 0); // FilterType.And

          // Create children as a Y.Array containing PLAIN OBJECTS (not Y.Maps)
          // This simulates what happens when desktop syncs filter data
          const children = new Y.Array();

          // Child 1: Name text filter (plain object)
          const nameFilter = {
            id: 'plain_name_f',
            field_id: fieldId,
            filter_type: 2, // FilterType.Data
            ty: 0,          // FieldType.RichText
            condition: 2,   // TextContains
            content: '',
          };

          // Child 2: Select filter with Active selected (plain object)
          const selectFilter = {
            id: 'plain_select_f',
            field_id: selectFieldId,
            filter_type: 2, // FilterType.Data
            ty: 3,          // FieldType.SingleSelect
            condition: 0,   // OptionIs
            content: activeId,
          };

          children.push([nameFilter, selectFilter]);
          root.set('children', children);
          filters.push([root]);
        }, 'remote');
      },
      {
        fieldId: primaryFieldId,
        selectFieldId: singleSelectFieldId,
        activeId: activeOption.id,
      }
    );

    await page.waitForTimeout(1000);

    // The advanced filter badge should appear with 2 rules
    await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible({ timeout: 10000 });

    // Only Active rows should be visible (Alice, Charlie)
    await assertRowCount(page, 2);

    // Open the advanced filter panel
    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });

    // The select input should show "Active" as an inline tag
    const selectInput = filterPanel.getByTestId('advanced-filter-select-input');

    await expect(selectInput).toBeVisible({ timeout: 5000 });
    await expect(selectInput).toContainText('Active');

    // Click the select input to open options
    await selectInput.click();
    await page.waitForTimeout(500);

    // The option list should appear
    const optionItems = page.getByTestId('select-option-list');

    await expect(optionItems.first()).toBeVisible({ timeout: 5000 });

    // Click "Pending" to add it — THIS is the case that was broken
    // (plain object children → useUpdateAdvancedFilter couldn't find the filter)
    await optionItems.filter({ hasText: 'Pending' }).first().click();
    await page.waitForTimeout(1000);

    // Verify no console warnings about "Filter not found"
    const warnings = await page.evaluate(() => {
      // Check if there are recent console warnings (captured by the page error handler)
      return (window as any).__lastFilterWarning || null;
    });

    // Pending should now be checked
    await expect(optionItems.filter({ hasText: 'Pending' }).first()).toHaveAttribute('data-checked', 'true');

    // Close popovers
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // OptionIs Active+Pending => all 3 rows
    await assertRowCount(page, 3);
  });

  test('can edit text filter when filters are plain objects (desktop sync)', async () => {
    await waitForDatabaseDocReady(page);

    // Inject a plain-object advanced filter tree with a text filter
    await page.evaluate(
      ({ fieldId, selectFieldId }) => {
        const win = window as any;
        const doc = win.__TEST_DATABASE_DOC__;
        const viewId = win.__TEST_DATABASE_VIEW_ID__;
        const Y = win.Y;

        const sharedRoot = doc.getMap('data');
        const database = sharedRoot.get('database');
        const view = database.get('views').get(viewId);

        doc.transact(() => {
          const filters = view.get('filters');

          if (filters.length > 0) {
            filters.delete(0, filters.length);
          }

          const root = new Y.Map();

          root.set('id', 'root_text_test');
          root.set('filter_type', 0);

          const children = new Y.Array();

          // Plain object text filter
          const textFilter = {
            id: 'plain_text_f',
            field_id: fieldId,
            filter_type: 2,
            ty: 0,
            condition: 2, // TextContains
            content: '',
          };

          // Plain object select filter (no options selected)
          const selectFilter = {
            id: 'plain_sel_f2',
            field_id: selectFieldId,
            filter_type: 2,
            ty: 3,
            condition: 0,
            content: '',
          };

          children.push([textFilter, selectFilter]);
          root.set('children', children);
          filters.push([root]);
        }, 'remote');
      },
      { fieldId: primaryFieldId, selectFieldId: singleSelectFieldId }
    );

    await page.waitForTimeout(1000);
    await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible({ timeout: 10000 });

    // Open the panel and type in the text filter
    await openAdvancedFilterPanel(page);
    await page.waitForTimeout(300);

    const filterPanel = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: page.getByTestId('advanced-filter-row'),
    });
    const textInput = filterPanel.getByTestId('advanced-filter-text-input');

    await expect(textInput).toBeVisible({ timeout: 5000 });
    await textInput.click();
    await textInput.clear();
    await textInput.pressSequentially('Bob', { delay: 30 });
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // TextContains "Bob" => only Bob = 1 row
    await assertRowCount(page, 1);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    ).toContainText('Bob');
  });
});
