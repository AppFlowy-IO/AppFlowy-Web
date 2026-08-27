/**
 * Grid grouping desktop-parity integration coverage.
 *
 * Migrated from the Desktop Grid grouping, grouping/filter/sort, all-field,
 * visibility, number, text, hide-empty, and sort-with-group suites. Exact
 * date/number boundaries and high-volume derivation stay in the colocated Jest
 * suites; this file exercises every Web-supported grouping field through UI.
 *
 * Desktop sources audited:
 * - database_grid_group_test.dart
 * - database_grid_group_filter_sort_test.dart
 * - database_all_group_fields_test.dart
 * - database_group_visibility_test.dart
 * - database_number_group_test.dart
 * - database_text_group_test.dart
 * - grid_hide_empty_groups.feature
 * - layout_and_group.feature
 * - sort_with_group.feature
 * - grouped_visualization.feature
 * - cloud_grouped_status_row_move.feature
 * - group_setting_sync_test.dart
 * - grouped_search_test.dart
 *
 * The Flutter controller-sync cases map to the colocated Yjs selector/hook
 * suites. Runnable Web exclusions are grouped search (Web has no database
 * search control) and list_group_visibility.feature (Web currently renders
 * List as unsupported). Board-only and native-mobile interaction suites are
 * outside this Grid migration.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  addFieldWithType,
  clickFieldHeaderById,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupFieldTypeTest,
  toggleCheckbox,
  typeTextIntoCell,
} from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  changeSelectFilterCondition,
  clickSelectCell,
  createSelectOption,
  SelectFilterCondition,
  selectExistingOption,
  selectFilterOption,
} from '../../support/filter-test-helpers';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import {
  BoardSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  FieldType,
  GridFieldSelectors,
  PropertyMenuSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const gridGroupHeaders = (page: Page) => page.locator('[data-testid^="grid-group-header-"]');
const gridGroupOptionTags = (page: Page) => page.getByTestId('grid-group-option-tag');
const gridGroupHeaderByOptionName = (page: Page, optionName: string) =>
  gridGroupHeaders(page).filter({
    has: gridGroupOptionTags(page).filter({ hasText: optionName }),
  });
const gridGroupCellsForField = (page: Page, groupId: string, fieldId: string) =>
  page.locator(`[data-index][data-row-key^="group:${groupId}:row:"] .grid-row-cell[data-column-id="${fieldId}"]`);

async function loginAndCreateGroupingGrid(page: Page, request: Parameters<typeof loginAndCreateGrid>[1]) {
  setupFieldTypeTest(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());
}

async function openGridGroupSettings(page: Page) {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('grid-group-settings-trigger').click();
  await expect(page.getByTestId('grid-group-settings-menu')).toBeVisible();
}

async function closeGridGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function groupGridByField(page: Page, fieldId: string) {
  await openGridGroupSettings(page);
  await page.getByTestId(`grid-group-by-field-${fieldId}`).click();
  await closeGridGroupSettings(page);
  await expect(gridGroupHeaders(page).first()).toBeVisible({ timeout: 15000 });
}

async function assignNewSelectOption(page: Page, fieldId: string, rowIndex: number, optionName: string) {
  await clickSelectCell(page, fieldId, rowIndex);
  await createSelectOption(page, optionName);
  await page.keyboard.press('Escape');
}

async function assignExistingSelectOptions(page: Page, fieldId: string, rowIndex: number, optionNames: string[]) {
  await clickSelectCell(page, fieldId, rowIndex);
  for (const optionName of optionNames) {
    await selectExistingOption(page, optionName);
  }
  await page.keyboard.press('Escape');
}

async function assignExistingSelectOptionToRow(page: Page, rowTestId: string, fieldId: string, optionName: string) {
  const cell = page.getByTestId(rowTestId).locator(`.grid-row-cell[data-column-id="${fieldId}"]`);

  await cell.scrollIntoViewIfNeeded();
  await cell.dispatchEvent('click', { bubbles: true });
  await expect(page.getByTestId('select-option-menu')).toBeVisible({ timeout: 8000 });
  await selectExistingOption(page, optionName);
  await page.keyboard.press('Escape');
}

async function addGridView(page: Page) {
  const existingViewIds = new Set(
    (await DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, '')).filter(Boolean)
    )) as string[]
  );

  await DatabaseViewSelectors.addViewButton(page).click();
  const menu = page.locator('[data-slot="dropdown-menu-content"]').last();

  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Grid$/i }).click();
  let addedViewId = '';

  await expect
    .poll(async () => {
      const viewIds = (await DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
        tabs.map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, '')).filter(Boolean)
      )) as string[];

      addedViewId = viewIds.find((viewId) => !existingViewIds.has(viewId)) ?? '';
      return addedViewId;
    })
    .not.toBe('');

  await switchToGridView(page, addedViewId);

  return addedViewId;
}

async function switchToGridView(page: Page, viewId: string) {
  await DatabaseViewSelectors.viewTab(page, viewId).click();
  await waitForGridReady(page);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);
}

async function changeDatabaseLayout(page: Page, layout: 'Grid' | 'Board') {
  await page.getByTestId('database-actions-settings').click();
  const layoutTrigger = page.getByRole('menuitem', { name: /^Layout$/i });

  await expect(layoutTrigger).toBeVisible();
  await layoutTrigger.hover();

  const layoutMenu = page.locator('[data-slot="dropdown-menu-sub-content"]').last();
  const layoutOption = layoutMenu.getByRole('menuitem', { name: new RegExp(`^${layout}$`, 'i') });

  await expect(layoutOption).toBeVisible();
  await layoutOption.click();

  if (layout === 'Grid') {
    await waitForGridReady(page);
  } else {
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
  }
}

async function groupBoardByFieldName(page: Page, fieldName: string) {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('board-group-settings-trigger').click();

  const field = page.getByTestId('board-group-by-field').filter({
    has: page.getByTestId('board-group-by-field-name').filter({ hasText: fieldName }),
  });

  await expect(field).toBeVisible();
  await field.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function clickDateCell(page: Page, fieldId: string, rowIndex: number) {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  await cell.scrollIntoViewIfNeeded();
  await cell.dispatchEvent('click', { bubbles: true });
  await expect(page.getByTestId('datetime-picker-popover')).toBeVisible({ timeout: 8000 });
}

async function selectDateByDay(page: Page, day: number) {
  const popover = page.getByTestId('datetime-picker-popover');
  const dayButtons = popover.locator('button');
  const count = await dayButtons.count();

  for (let index = 0; index < count; index += 1) {
    const button = dayButtons.nth(index);
    const text = (await button.textContent())?.trim();
    const className = (await button.getAttribute('class')) ?? '';

    if (text === String(day) && !className.includes('day-outside')) {
      await button.click();
      await page.keyboard.press('Escape');
      return;
    }
  }

  throw new Error(`Could not find day ${day} in the current date picker month`);
}

test.describe('Database Grid grouping', () => {
  test('group membership, unrelated edits, grouped row creation, collapse, visibility, and removal refresh live', async ({
    page,
    request,
  }) => {
    await loginAndCreateGroupingGrid(page, request);

    const primaryFieldId = await getPrimaryFieldId(page);
    const notesFieldId = await addFieldWithType(page, FieldType.RichText);

    await typeTextIntoCell(page, primaryFieldId, 0, 'A');
    await typeTextIntoCell(page, primaryFieldId, 1, 'B');
    await typeTextIntoCell(page, primaryFieldId, 2, 'C');
    await typeTextIntoCell(page, notesFieldId, 0, 'before grouping');

    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-hide-all-groups')).toHaveCount(0);
    await expect(page.locator('[data-testid^="grid-group-visibility-"]')).toHaveCount(0);
    await page.getByTestId(`grid-group-by-field-${primaryFieldId}`).click();
    await closeGridGroupSettings(page);

    await expect(page.locator('[data-testid^="grid-group-header-"]')).toHaveCount(3);
    await expect(page.getByTestId('grid-group-header-A')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-B')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-C')).toBeVisible();

    // Editing a non-grouping cell must not delete the singleton A group.
    await typeTextIntoCell(page, notesFieldId, 0, 'after grouping');
    await expect(page.getByTestId('grid-group-header-A')).toBeVisible();

    // Editing the grouping cell moves the row and removes the now-empty group.
    await typeTextIntoCell(page, primaryFieldId, 0, 'B');
    await expect(page.getByTestId('grid-group-header-A')).toHaveCount(0);
    await expect(page.getByTestId('grid-group-header-B').getByTestId('grid-group-row-count')).toHaveText('2');

    // Creating from a group header pre-fills the grouping field.
    await page.getByTestId('grid-group-header-B').hover();
    await page.getByTestId('grid-group-header-B').getByTestId('grid-group-new-row').click();
    await expect(page.getByTestId('grid-group-header-B').getByTestId('grid-group-row-count')).toHaveText('3');

    // Collapse changes presentation without changing membership.
    await page.getByTestId('grid-group-header-B').getByTestId('grid-group-collapse-toggle').click();
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(1);
    await expect(page.getByTestId('grid-group-header-B').getByTestId('grid-group-collapse-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    // Desktop persists collapsed_group_ids. Verify a full reload restores it.
    await page.reload();
    await waitForGridReady(page);
    await expect(page.getByTestId('grid-group-header-B').getByTestId('grid-group-collapse-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(1);

    await page.getByTestId('grid-group-header-B').getByTestId('grid-group-collapse-toggle').click();
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);

    // Header actions and settings share the same persisted visibility state.
    await page.getByTestId('grid-group-header-C').hover();
    await page.getByTestId('grid-group-header-C').getByTestId('grid-group-actions').click();
    await page.getByTestId('grid-hide-group').click();
    await expect(page.getByTestId('grid-group-header-C')).toHaveCount(0);

    await openGridGroupSettings(page);
    await page.getByTestId('grid-group-visibility-C').click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-header-C')).toBeVisible();

    // Grid hide-empty defaults ON independently from Board. Verify the
    // rendered default group, not only the switch state, in both directions.
    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-hide-empty-groups-switch')).toHaveAttribute('data-state', 'checked');
    await closeGridGroupSettings(page);
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`)).toHaveCount(0);

    await page.reload();
    await waitForGridReady(page);
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`)).toHaveCount(0);
    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-hide-empty-groups-switch')).toHaveAttribute('data-state', 'checked');
    await page.getByTestId('grid-hide-empty-groups-toggle').click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`)).toBeVisible();
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`).getByTestId('grid-group-row-count')).toHaveText(
      '0'
    );

    await page.reload();
    await waitForGridReady(page);
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`)).toBeVisible();
    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-hide-empty-groups-switch')).toHaveAttribute('data-state', 'unchecked');
    await closeGridGroupSettings(page);

    // Desktop persists per-group visibility in GroupSetting.groups. Verify the
    // same metadata survives a full web view reload.
    await page.getByTestId('grid-group-header-C').hover();
    await page.getByTestId('grid-group-header-C').getByTestId('grid-group-actions').click();
    await page.getByTestId('grid-hide-group').click();
    await page.reload();
    await waitForGridReady(page);
    await expect(page.getByTestId('grid-group-header-C')).toHaveCount(0);

    await openGridGroupSettings(page);
    await page.getByTestId('grid-group-visibility-C').click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-header-C')).toBeVisible();

    // Desktop exposes bulk visibility actions in the same settings section.
    await openGridGroupSettings(page);
    await page.getByTestId('grid-hide-all-groups').click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-header-B')).toHaveCount(0);
    await expect(page.getByTestId('grid-group-header-C')).toHaveCount(0);
    await expect(page.getByTestId(`grid-group-header-${primaryFieldId}`)).toBeVisible();

    await openGridGroupSettings(page);
    await page.getByTestId('grid-show-all-groups').click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-header-B')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-C')).toBeVisible();

    await openGridGroupSettings(page);
    await page.getByTestId('grid-remove-grouping').click();
    await closeGridGroupSettings(page);
    await expect(page.locator('[data-testid^="grid-group-header-"]')).toHaveCount(0);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);

    // Removing and immediately selecting the same field must create a fresh
    // setting instead of being blocked by stale React selector state.
    await openGridGroupSettings(page);
    await page.getByTestId(`grid-group-by-field-${primaryFieldId}`).click();
    await closeGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-header-B')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-C')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-B').getByTestId('grid-group-row-count')).toHaveText('3');
  });

  test('preserves a same-field filter and applies sorting within the remaining group', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Zulu VIP');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Standard');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Alpha VIP');
    await assignNewSelectOption(page, selectFieldId, 0, 'VIP');
    await assignNewSelectOption(page, selectFieldId, 1, 'Standard');
    await assignExistingSelectOptions(page, selectFieldId, 2, ['VIP']);

    await addFilterByFieldName(page, 'Select');
    await changeSelectFilterCondition(page, SelectFilterCondition.OptionIs);
    await selectFilterOption(page, 'VIP');
    await page.keyboard.press('Escape');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(2);

    await groupGridByField(page, selectFieldId);

    await expect(DatabaseFilterSelectors.filterCondition(page)).toHaveCount(1);
    await expect(gridGroupOptionTags(page).filter({ hasText: 'VIP' })).toBeVisible();
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(2);
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)).toHaveText(['Zulu VIP', 'Alpha VIP']);

    await addSortByFieldName(page, 'Name');
    await expect(DatabaseFilterSelectors.filterCondition(page)).toHaveCount(1);
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)).toHaveText(['Alpha VIP', 'Zulu VIP']);

    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)).toHaveText(['Zulu VIP', 'Alpha VIP']);
  });

  test('sorts rows inside every group and reorders after a sort-key edit', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    await typeTextIntoCell(page, numberFieldId, 0, '30');
    await typeTextIntoCell(page, numberFieldId, 1, '10');
    await typeTextIntoCell(page, numberFieldId, 2, '20');
    await addSortByFieldName(page, 'Numbers');
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, numberFieldId)).toHaveText(['10', '20', '30']);

    // Match Desktop's scenario: assign groups using the already-sorted row
    // order, then prove the sort remains active within each rendered group.
    await assignNewSelectOption(page, selectFieldId, 0, 'A');
    await assignNewSelectOption(page, selectFieldId, 1, 'B');
    await assignExistingSelectOptions(page, selectFieldId, 2, ['A']);
    await groupGridByField(page, selectFieldId);

    const groupA = gridGroupHeaderByOptionName(page, 'A');
    const groupB = gridGroupHeaderByOptionName(page, 'B');
    const groupAId = await groupA.getAttribute('data-group-id');
    const groupBId = await groupB.getAttribute('data-group-id');

    expect(groupAId).toBeTruthy();
    expect(groupBId).toBeTruthy();
    await expect(gridGroupCellsForField(page, groupAId!, numberFieldId)).toHaveText(['10', '30']);
    await expect(gridGroupCellsForField(page, groupBId!, numberFieldId)).toHaveText(['20']);

    await typeTextIntoCell(page, numberFieldId, 0, '50');

    await expect(gridGroupCellsForField(page, groupAId!, numberFieldId)).toHaveText(['30', '50']);
    await expect(gridGroupCellsForField(page, groupBId!, numberFieldId)).toHaveText(['20']);
  });

  test('groups Number ranges and exact URL values through the Grid UI', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    const urlFieldId = await addFieldWithType(page, FieldType.URL);

    await typeTextIntoCell(page, numberFieldId, 0, '50');
    await typeTextIntoCell(page, numberFieldId, 1, '150');
    await typeTextIntoCell(page, numberFieldId, 2, '75');
    await typeTextIntoCell(page, urlFieldId, 0, 'https://appflowy.io');
    await typeTextIntoCell(page, urlFieldId, 1, 'https://github.com/AppFlowy-IO/AppFlowy');
    await typeTextIntoCell(page, urlFieldId, 2, 'https://appflowy.io');

    await groupGridByField(page, numberFieldId);
    await expect(page.getByTestId('grid-group-header-number_range_0_100')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-number_range_0_100')).toContainText('0 to 100');
    await expect(
      page.getByTestId('grid-group-header-number_range_0_100').getByTestId('grid-group-row-count')
    ).toHaveText('2');
    await expect(
      page.getByTestId('grid-group-header-number_range_100_200').getByTestId('grid-group-row-count')
    ).toHaveText('1');

    await typeTextIntoCell(page, numberFieldId, 0, '250');
    await expect(
      page.getByTestId('grid-group-header-number_range_0_100').getByTestId('grid-group-row-count')
    ).toHaveText('1');
    await expect(
      page.getByTestId('grid-group-header-number_range_200_300').getByTestId('grid-group-row-count')
    ).toHaveText('1');
    await expect
      .poll(() => gridGroupHeaders(page).evaluateAll((headers) => headers.map((header) => header.dataset.groupId)))
      .toEqual(['number_range_0_100', 'number_range_100_200', 'number_range_200_300']);

    await openGridGroupSettings(page);
    await page.getByTestId(`grid-group-by-field-${urlFieldId}`).click();
    await closeGridGroupSettings(page);
    await expect(
      page.getByTestId('grid-group-header-https://appflowy.io').getByTestId('grid-group-row-count')
    ).toHaveText('2');
    await expect(
      page.getByTestId('grid-group-header-https://github.com/AppFlowy-IO/AppFlowy').getByTestId('grid-group-row-count')
    ).toHaveText('1');
  });

  test('moves an edited SingleSelect row between populated groups exactly once', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    const rowToMoveTestId = await DatabaseGridSelectors.dataRows(page).nth(2).getAttribute('data-testid');

    expect(rowToMoveTestId).toBeTruthy();
    await assignNewSelectOption(page, selectFieldId, 0, 'Ready');
    await assignNewSelectOption(page, selectFieldId, 1, 'Blocked');
    await groupGridByField(page, selectFieldId);

    const readyGroup = gridGroupHeaderByOptionName(page, 'Ready');
    const blockedGroup = gridGroupHeaderByOptionName(page, 'Blocked');
    const defaultGroup = page.getByTestId(`grid-group-header-${selectFieldId}`);

    await expect(readyGroup).toHaveCount(1);
    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(blockedGroup).toHaveCount(1);
    await expect(blockedGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(defaultGroup.getByTestId('grid-group-row-count')).toHaveText('1');

    await assignExistingSelectOptionToRow(page, rowToMoveTestId!, selectFieldId, 'Ready');

    await expect(readyGroup).toHaveCount(1);
    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await expect(blockedGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(defaultGroup).toHaveCount(0);
    await expect(page.getByTestId(rowToMoveTestId!)).toHaveCount(1);

    await assignExistingSelectOptionToRow(page, rowToMoveTestId!, selectFieldId, 'Blocked');

    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(blockedGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await expect(page.getByTestId(rowToMoveTestId!)).toHaveCount(1);

    await assignExistingSelectOptionToRow(page, rowToMoveTestId!, selectFieldId, 'Ready');

    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await expect(blockedGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(page.getByTestId(rowToMoveTestId!)).toHaveCount(1);
  });

  test('keeps a row inserted from grouped row actions in the source group', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);
    const sourceRowTestId = await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid');

    expect(sourceRowTestId).toBeTruthy();
    await assignNewSelectOption(page, selectFieldId, 0, 'Ready');
    await groupGridByField(page, selectFieldId);

    const readyGroup = gridGroupHeaderByOptionName(page, 'Ready');
    const defaultGroup = page.getByTestId(`grid-group-header-${selectFieldId}`);
    const sourceRow = page.getByTestId(sourceRowTestId!);
    const sourceRowContainer = sourceRow.locator('..');

    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('1');
    await expect(defaultGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await sourceRow.hover();
    await sourceRowContainer.getByTestId('row-accessory-button').click();
    await page.getByTestId('row-menu-insert-below').click();

    await expect(readyGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await expect(defaultGroup.getByTestId('grid-group-row-count')).toHaveText('2');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
  });

  test('orders group headers by the primary grouped-field sort', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    // Deliberately create the option metadata in a non-alphabetical order.
    await assignNewSelectOption(page, selectFieldId, 0, 'Zulu');
    await assignNewSelectOption(page, selectFieldId, 1, 'Alpha');
    await assignNewSelectOption(page, selectFieldId, 2, 'Mike');
    await groupGridByField(page, selectFieldId);

    await addSortByFieldName(page, 'Select');
    await expect(gridGroupOptionTags(page)).toHaveText(['Alpha', 'Mike', 'Zulu']);

    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expect(gridGroupOptionTags(page)).toHaveText(['Zulu', 'Mike', 'Alpha']);
  });

  test('switches grouping fields without losing rows', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const primaryFieldId = await getPrimaryFieldId(page);
    const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Alpha');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Beta');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Gamma');
    await toggleCheckbox(page, checkboxFieldId, 0);
    await toggleCheckbox(page, checkboxFieldId, 2);

    await groupGridByField(page, primaryFieldId);
    await expect(gridGroupHeaders(page)).toHaveCount(3);

    await openGridGroupSettings(page);
    await page.getByTestId(`grid-group-by-field-${checkboxFieldId}`).click();
    await closeGridGroupSettings(page);

    await expect(gridGroupHeaders(page)).toHaveCount(2);
    await expect(gridGroupHeaders(page).getByRole('checkbox')).toHaveCount(2);
    await expect(gridGroupHeaders(page).getByText('Checkbox', { exact: true })).toHaveCount(2);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  });

  test('isolates grouping per Grid view and restores it after switching tabs', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const firstViewTestId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');
    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    expect(firstViewTestId).toBeTruthy();
    const firstViewId = firstViewTestId!.replace(/^view-tab-/, '');

    await typeTextIntoCell(page, primaryFieldId, 0, 'Alpha');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Beta');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Gamma');
    await assignNewSelectOption(page, selectFieldId, 0, 'Ready');
    await assignNewSelectOption(page, selectFieldId, 1, 'Blocked');
    await assignExistingSelectOptions(page, selectFieldId, 2, ['Ready']);
    await groupGridByField(page, primaryFieldId);

    await expect(page.getByTestId('grid-group-header-Alpha')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-Beta')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-Gamma')).toBeVisible();

    const secondViewId = await addGridView(page);

    expect(secondViewId).not.toBe(firstViewId);
    await expect(gridGroupHeaders(page)).toHaveCount(0);
    await groupGridByField(page, selectFieldId);
    await expect(gridGroupOptionTags(page)).toHaveCount(2);
    await expect(gridGroupHeaderByOptionName(page, 'Ready')).toBeVisible();
    await expect(gridGroupHeaderByOptionName(page, 'Blocked')).toBeVisible();

    await switchToGridView(page, firstViewId);
    await expect(page.getByTestId('grid-group-header-Alpha')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-Beta')).toBeVisible();
    await expect(page.getByTestId('grid-group-header-Gamma')).toBeVisible();
    await expect(gridGroupOptionTags(page)).toHaveCount(0);

    await switchToGridView(page, secondViewId);
    await expect(gridGroupHeaderByOptionName(page, 'Ready')).toBeVisible();
    await expect(gridGroupHeaderByOptionName(page, 'Blocked')).toBeVisible();
    await expect(gridGroupHeaders(page)).toHaveCount(2);
  });

  test('clears Board grouping when the same view switches back to Grid', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    await assignNewSelectOption(page, selectFieldId, 0, 'Ready');
    await assignNewSelectOption(page, selectFieldId, 1, 'Blocked');
    await assignExistingSelectOptions(page, selectFieldId, 2, ['Ready']);

    await changeDatabaseLayout(page, 'Board');
    await groupBoardByFieldName(page, 'Select');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible();

    await changeDatabaseLayout(page, 'Grid');

    await expect(gridGroupHeaders(page)).toHaveCount(0);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-group-by-none')).toContainText('None');
    await expect(page.getByTestId('grid-remove-grouping')).toHaveCount(0);
    await closeGridGroupSettings(page);
  });

  test('keeps duplicated MultiSelect row instances independently active and hovered', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const primaryFieldId = await getPrimaryFieldId(page);
    const multiSelectFieldId = await addFieldWithType(page, FieldType.MultiSelect);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Red only');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Blue only');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Both');
    const duplicatedRowTestId = await DatabaseGridSelectors.dataRows(page).nth(2).getAttribute('data-testid');

    expect(duplicatedRowTestId).toBeTruthy();

    await assignNewSelectOption(page, multiSelectFieldId, 0, 'Red');
    await assignNewSelectOption(page, multiSelectFieldId, 1, 'Blue');
    await assignExistingSelectOptions(page, multiSelectFieldId, 2, ['Red', 'Blue']);
    await groupGridByField(page, multiSelectFieldId);

    await expect(gridGroupOptionTags(page)).toHaveCount(2);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);

    const duplicatedRows = page.getByTestId(duplicatedRowTestId!);

    await expect(duplicatedRows).toHaveCount(2);
    const rowKeys = await duplicatedRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-key')));

    expect(new Set(rowKeys).size).toBe(2);

    const firstPrimaryCell = duplicatedRows.nth(0).locator(`.grid-row-cell[data-column-id="${primaryFieldId}"]`);
    const secondPrimaryCell = duplicatedRows.nth(1).locator(`.grid-row-cell[data-column-id="${primaryFieldId}"]`);

    await firstPrimaryCell.click();
    await expect(firstPrimaryCell).toHaveAttribute('data-active-cell', 'true');
    await expect(secondPrimaryCell).not.toHaveAttribute('data-active-cell', 'true');

    await duplicatedRows.nth(1).hover();
    await expect(secondPrimaryCell).toHaveAttribute('data-hover-row', 'true');
    await expect(firstPrimaryCell).not.toHaveAttribute('data-hover-row', 'true');
  });

  test('refreshes Date groups when the grouping condition changes', async ({ page, request }) => {
    await loginAndCreateGroupingGrid(page, request);

    const dateFieldId = await addFieldWithType(page, FieldType.DateTime);

    await clickDateCell(page, dateFieldId, 0);
    await selectDateByDay(page, 6);
    await clickDateCell(page, dateFieldId, 1);
    await selectDateByDay(page, 21);
    await groupGridByField(page, dateFieldId);

    // Day grouping yields two dated groups plus the non-empty default group.
    await openGridGroupSettings(page);
    await page.getByTestId('grid-date-group-condition-1').click();
    await closeGridGroupSettings(page);
    await expect(gridGroupHeaders(page)).toHaveCount(3);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);

    // Both dates are in the same calendar month, so Month coalesces them.
    // Keep empty groups visible to prove the obsolete Day IDs were rebuilt,
    // rather than merely masked by the layout's hide-empty setting.
    await openGridGroupSettings(page);
    if ((await page.getByTestId('grid-hide-empty-groups-switch').getAttribute('data-state')) === 'checked') {
      await page.getByTestId('grid-hide-empty-groups-toggle').click();
    }
    await closeGridGroupSettings(page);
    await openGridGroupSettings(page);
    await expect(page.getByTestId('grid-hide-empty-groups-switch')).toHaveAttribute('data-state', 'unchecked');
    await page.getByTestId('grid-date-group-condition-3').click();
    await closeGridGroupSettings(page);
    await expect(gridGroupHeaders(page)).toHaveCount(2);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  });

  test('refreshes every repeated field header after a grouped property rename or insertion', async ({
    page,
    request,
  }) => {
    await loginAndCreateGroupingGrid(page, request);

    const primaryFieldId = await getPrimaryFieldId(page);
    const selectFieldId = await addFieldWithType(page, FieldType.SingleSelect);

    await assignNewSelectOption(page, selectFieldId, 0, 'Option A');
    await assignNewSelectOption(page, selectFieldId, 1, 'Option B');
    await groupGridByField(page, selectFieldId);

    const repeatedHeaders = GridFieldSelectors.fieldHeader(page, primaryFieldId);

    await expect.poll(() => repeatedHeaders.count()).toBeGreaterThanOrEqual(3);
    const repeatedHeaderCount = await repeatedHeaders.count();

    await clickFieldHeaderById(page, primaryFieldId);
    await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });

    const nameInput = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();

    await expect(nameInput).toBeVisible();
    await nameInput.clear();
    await nameInput.fill('Title');
    await page.keyboard.press('Escape');

    await expect(repeatedHeaders).toHaveCount(repeatedHeaderCount);
    await expect
      .poll(async () => (await repeatedHeaders.allTextContents()).map((text) => text.trim()))
      .toEqual(Array(repeatedHeaderCount).fill('Title'));

    // Desktop repeats a newly inserted property in every grouped table. This
    // exercises the field-order insertion path separately from rename updates.
    const addedFieldId = await addFieldWithType(page, FieldType.URL);
    const addedHeaders = GridFieldSelectors.fieldHeader(page, addedFieldId);

    await expect(addedHeaders).toHaveCount(repeatedHeaderCount);
    const addedHeaderNames = (await addedHeaders.allTextContents()).map((text) => text.trim());

    expect(new Set(addedHeaderNames).size).toBe(1);
    expect(addedHeaderNames[0]).toBeTruthy();
  });
});
