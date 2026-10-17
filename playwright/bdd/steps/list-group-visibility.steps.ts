import { expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { addFieldWithType, getFieldIdByName, loginAndCreateGrid, toggleCheckbox } from '../../support/field-type-helpers';
import { clickSelectCell, createSelectOption, selectExistingOption } from '../../support/filter-test-helpers';
import {
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const typeFieldIds = new WeakMap<Page, string>();
const checkboxFieldIds = new WeakMap<Page, string>();
const gridViewIds = new WeakMap<Page, string>();
const listViewIds = new WeakMap<Page, string>();
const listGroupRowCounts = new WeakMap<Page, number>();

const listGroupHeaders = (page: Page) => page.locator('[data-testid^="list-group-header-"]');
const listGroupHeaderByName = (page: Page, name: string) => listGroupHeaders(page).filter({ hasText: name });
const listGroupSettingsMenu = (page: Page) => page.getByTestId('list-group-settings-menu');
const listGroupByMenu = (page: Page) => page.getByTestId('list-group-by-menu');
// Field rows only: the FieldDisplay name and the tick reuse the same test-id prefix.
const listGroupByFieldRows = (scope: Locator) =>
  scope.locator('[role="menuitem"][data-testid^="list-group-by-field-"]');
// The eye icons and option tags reuse the row prefix; only rows carry the checkbox role.
const listGroupVisibilityRows = (page: Page) =>
  listGroupSettingsMenu(page).locator('[data-testid^="list-group-visibility-"][role="menuitemcheckbox"]');
const listGroupVisibilityRowByName = (page: Page, name: string) =>
  listGroupVisibilityRows(page).filter({ has: page.getByText(name, { exact: true }) });

async function databaseViewIds(page: Page): Promise<string[]> {
  return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, ''))
      .filter((viewId): viewId is string => Boolean(viewId))
  );
}

async function openListGroupSettings(page: Page) {
  const alreadyOpen = await listGroupSettingsMenu(page)
    .isVisible()
    .catch(() => false);

  if (alreadyOpen) return;

  const groupTrigger = page.getByTestId('list-group-settings-trigger');
  const topLevelSettingsOpen = await groupTrigger.isVisible().catch(() => false);

  if (!topLevelSettingsOpen) {
    await page.getByTestId('database-actions-settings').click();
    await expect(groupTrigger).toBeVisible();
  }

  await groupTrigger.click();
  await expect(listGroupSettingsMenu(page)).toBeVisible();
}

/** Desktop's grouped menu keeps the field list in a nested "Group by ▸ <field>" submenu. */
async function openListGroupByMenu(page: Page) {
  await openListGroupSettings(page);
  if (!(await listGroupByMenu(page).isVisible())) {
    await page.getByTestId('list-group-by-trigger').click();
  }

  await expect(listGroupByMenu(page)).toBeVisible();

  return listGroupByMenu(page);
}

async function closeListGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(listGroupSettingsMenu(page)).toBeHidden();
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
}

/** Desktop _GroupVisibilityRow: one eye icon per row mirrored by aria-checked, no switch. */
async function expectListGroupEye(row: Locator, shown: boolean) {
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('aria-checked', String(shown));
  await expect(row.locator('[data-testid^="list-group-visibility-shown-"]')).toHaveCount(shown ? 1 : 0);
  await expect(row.locator('[data-testid^="list-group-visibility-hidden-"]')).toHaveCount(shown ? 0 : 1);
  await expect(row.locator('[role="switch"]')).toHaveCount(0);
}

async function changeActiveDatabaseLayout(page: Page, layout: 'Board' | 'List') {
  await page.getByTestId('database-actions-settings').click();
  const layoutTrigger = page.getByRole('menuitem', { name: /^Layout$/i });

  await expect(layoutTrigger).toBeVisible();
  await layoutTrigger.hover();

  const layoutMenu = page.locator('[data-slot="dropdown-menu-sub-content"]:visible').last();
  const layoutOption = layoutMenu.getByRole('menuitem', { name: new RegExp(`^${layout}$`, 'i') });

  await expect(layoutOption).toBeVisible();
  await layoutOption.click();

  if (layout === 'Board') {
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  }
}

Given('a grid database is open for List group visibility testing', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const typeFieldId = await getFieldIdByName(page, 'Type');

  expect(typeFieldId).not.toBe('');
  typeFieldIds.set(page, typeFieldId);

  const activeGridTab = DatabaseViewSelectors.activeViewTab(page);

  await expect(activeGridTab).toContainText('Grid');
  const activeGridTabTestId = await activeGridTab.getAttribute('data-testid');
  const gridViewId = activeGridTabTestId?.replace(/^view-tab-/, '');

  if (!gridViewId) throw new Error('The active Grid view ID was not resolved');
  gridViewIds.set(page, gridViewId);
});

Given('the grid has List group options {string}', async ({ page }, optionList: string) => {
  const typeFieldId = typeFieldIds.get(page);

  if (!typeFieldId) throw new Error('The Type field was not resolved');

  const options = optionList.split(',').map((option) => option.trim());

  for (const [rowIndex, option] of options.entries()) {
    await clickSelectCell(page, typeFieldId, rowIndex);
    await createSelectOption(page, option);
    await page.keyboard.press('Escape');
  }
});

Given('the grid has an empty List group option {string}', async ({ page }, optionName: string) => {
  const typeFieldId = typeFieldIds.get(page);

  if (!typeFieldId) throw new Error('The Type field was not resolved');

  const existingRowCount = await DatabaseGridSelectors.dataRows(page).count();

  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(existingRowCount + 1, { timeout: 10_000 });

  const newRowIndex = existingRowCount;

  await clickSelectCell(page, typeFieldId, newRowIndex);
  await createSelectOption(page, optionName);
  // Creating an option also assigns it to the edited row. Toggle it off again
  // so the field keeps the option while no row belongs to its group.
  await selectExistingOption(page, optionName);
  await page.keyboard.press('Escape');
  await expect(DatabaseGridSelectors.dataRowCellsForField(page, typeFieldId).nth(newRowIndex)).not.toContainText(
    optionName
  );
});

Given('the grid has a Checkbox field checked on the first row', async ({ page }) => {
  // The property keeps its default name, "Checkbox", which the group headers repeat.
  const checkboxFieldId = await addFieldWithType(page, FieldType.Checkbox);

  expect(checkboxFieldId).not.toBe('');
  checkboxFieldIds.set(page, checkboxFieldId);
  await toggleCheckbox(page, checkboxFieldId, 0);
  await expect(
    DatabaseGridSelectors.dataRowCellsForField(page, checkboxFieldId).nth(0).getByTestId('checkbox-checked-icon')
  ).toBeVisible();
});

When('I add a List view for group visibility testing', async ({ page }) => {
  const previousViewIds = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible');

  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'List', exact: true }).click();
  await expect
    .poll(
      async () => {
        const addedViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';

        if (addedViewId) listViewIds.set(page, addedViewId);
        return addedViewId;
      },
      { timeout: 15_000 }
    )
    .not.toBe('');

  const listViewId = listViewIds.get(page);

  if (!listViewId) throw new Error('The newly added List view ID was not resolved');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${listViewId}`);
  await expect(page.getByTestId('database-list')).toBeVisible({ timeout: 30_000 });
});

Then('the List database is visible', async ({ page }) => {
  await expect(page.getByTestId('database-list')).toBeVisible();
  await expect(DatabaseListSelectors.rows(page).first()).toBeVisible();
});

When('I group the List by the Type field', async ({ page }) => {
  await openListGroupSettings(page);
  // An ungrouped List lists its fields inline (desktop _EmptyGroupByList).
  await expect(page.getByTestId('list-group-by-trigger')).toHaveCount(0);
  const typeRow = listGroupByFieldRows(listGroupSettingsMenu(page)).filter({ hasText: 'Type' });

  await expect(typeRow).toHaveCount(1);
  await typeRow.click();
  await closeListGroupSettings(page);
  await expect(listGroupHeaders(page).first()).toBeVisible({ timeout: 15_000 });
});

When('I group the List by the Checkbox field through the Group by submenu', async ({ page }) => {
  const checkboxFieldId = checkboxFieldIds.get(page);

  if (!checkboxFieldId) throw new Error('The Checkbox field was not created');

  const groupByMenu = await openListGroupByMenu(page);

  await groupByMenu.getByTestId(`list-group-by-field-${checkboxFieldId}`).click();
  await closeListGroupSettings(page);
  await expect(listGroupHeaders(page).first()).toBeVisible({ timeout: 15_000 });
});

Then('List group {string} is visible', async ({ page }, groupName: string) => {
  await expect(listGroupHeaderByName(page, groupName)).toHaveCount(1);
  await expect(listGroupHeaderByName(page, groupName)).toBeVisible();
});

Then('List group {string} is not visible', async ({ page }, groupName: string) => {
  await expect(listGroupHeaderByName(page, groupName)).toHaveCount(0);
});

Then(
  'the List shows Checkbox group headers for {string} reading {string}',
  async ({ page }, fieldName: string, valueList: string) => {
    const values = valueList.split(',').map((value) => value.trim());

    await expect(listGroupHeaders(page)).toHaveCount(values.length);
    for (const value of values) {
      await expect(
        listGroupHeaders(page).getByRole('checkbox', { name: `${fieldName}: ${value}`, exact: true })
      ).toHaveCount(1);
    }
  }
);

Then('the List Group entry shows {string} as the current field', async ({ page }, fieldName: string) => {
  const groupTrigger = page.getByTestId('list-group-settings-trigger');

  if (!(await groupTrigger.isVisible())) {
    await page.getByTestId('database-actions-settings').click();
  }

  await expect(groupTrigger).toBeVisible();
  await expect(groupTrigger.getByTestId('list-group-settings-field')).toHaveText(fieldName);
});

Then('the List Group by submenu ticks {string}', async ({ page }, fieldName: string) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-group-by-current-field')).toHaveText(fieldName);
  // Grouped menus no longer list fields inline.
  await expect(listGroupByFieldRows(listGroupSettingsMenu(page))).toHaveCount(0);

  const groupByMenu = await openListGroupByMenu(page);
  const selectedRow = listGroupByFieldRows(groupByMenu).filter({
    has: page.getByTestId('list-group-by-field-selected'),
  });

  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow).toContainText(fieldName);
  await expect(groupByMenu.getByTestId('list-group-by-none')).toHaveCount(1);
  await expect(groupByMenu.getByTestId('list-group-by-none').locator('[data-slot="dropdown-menu-tick"]')).toHaveCount(
    0
  );
  await closeListGroupSettings(page);
});

Then('the List Delete grouping action is available', async ({ page }) => {
  await openListGroupSettings(page);
  const action = page.getByTestId('list-remove-grouping');

  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(action).toHaveText('Delete grouping');
  await expect(action.locator('svg')).toHaveCount(1);
});

When('I add a row from List group {string} footer', async ({ page }, groupName: string) => {
  await closeListGroupSettings(page);
  const groupHeader = listGroupHeaderByName(page, groupName);

  await expect(groupHeader).toHaveCount(1);
  const groupId = await groupHeader.getAttribute('data-group-id');
  const previousCount = Number(await groupHeader.getByTestId('list-group-row-count').textContent());

  if (!groupId || !Number.isFinite(previousCount)) {
    throw new Error(`Could not resolve List group ${groupName} before adding its row`);
  }

  listGroupRowCounts.set(page, previousCount);
  await DatabaseListSelectors.groupFooterById(page, groupId).getByRole('button').click();
});

Then('List group {string} has one more row', async ({ page }, groupName: string) => {
  const previousCount = listGroupRowCounts.get(page);

  if (previousCount === undefined) throw new Error('The previous List group row count was not captured');
  await expect(listGroupHeaderByName(page, groupName).getByTestId('list-group-row-count')).toHaveText(
    String(previousCount + 1),
    { timeout: 15_000 }
  );
});

When('I delete List grouping', async ({ page }) => {
  await openListGroupSettings(page);
  await page.getByTestId('list-remove-grouping').click();
  // Desktop dismisses the menu once the grouping is deleted.
  await expect(listGroupSettingsMenu(page)).toBeHidden();
});

Then('the List has no group headers', async ({ page }) => {
  await expect(listGroupHeaders(page)).toHaveCount(0, { timeout: 15_000 });
});

Then('the List Delete grouping action is not available', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-remove-grouping')).toHaveCount(0);
  // Ungrouped menus offer a ticked None instead.
  await expect(page.getByTestId('list-group-by-none').locator('[data-slot="dropdown-menu-tick"]')).toHaveCount(1);
});

When('I change the active database layout to Board', async ({ page }) => {
  await changeActiveDatabaseLayout(page, 'Board');
});

When('I group the Board by the Type field', async ({ page }) => {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('board-group-settings-trigger').click();
  await expect(page.getByTestId('board-group-settings-menu')).toBeVisible();
  // Board views always stay grouped, so the field list lives in the nested
  // "Group by ▸" submenu like desktop's _GroupByList.
  await page.getByTestId('board-group-by-trigger').click();
  const groupByMenu = page.getByTestId('board-group-by-menu');

  await expect(groupByMenu).toBeVisible();
  const typeField = groupByMenu.getByTestId('board-group-by-field').filter({
    has: page.getByTestId('board-group-by-field-name').filter({ hasText: 'Type' }),
  });

  await expect(typeField).toHaveCount(1);
  await typeField.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(BoardSelectors.boardContainer(page)).toBeVisible();
  await expect(BoardSelectors.columnByName(page, 'A')).toHaveCount(1, { timeout: 15_000 });
  await expect(BoardSelectors.columnByName(page, 'B')).toHaveCount(1);
  await expect(BoardSelectors.columnByName(page, 'C')).toHaveCount(1);
});

Then('Board grouping cannot be removed', async ({ page }) => {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('board-group-settings-trigger').click();
  const menu = page.getByTestId('board-group-settings-menu');

  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'None', exact: true })).toHaveCount(0);
  await expect(menu.getByTestId('board-remove-grouping')).toHaveCount(0);
  await expect(menu.getByText('Delete grouping')).toHaveCount(0);

  // None is not offered in the nested field picker either (#970).
  await page.getByTestId('board-group-by-trigger').click();
  const groupByMenu = page.getByTestId('board-group-by-menu');

  await expect(groupByMenu).toBeVisible();
  await expect(groupByMenu.getByTestId('board-group-by-none')).toHaveCount(0);
  await expect(groupByMenu.getByRole('menuitem', { name: 'None', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I change the active database layout to List', async ({ page }) => {
  await changeActiveDatabaseLayout(page, 'List');
});

When('I hide List group {string} from group settings', async ({ page }, groupName: string) => {
  await openListGroupSettings(page);
  const groupRow = listGroupVisibilityRowByName(page, groupName);

  await expectListGroupEye(groupRow, true);
  await groupRow.click();
  await expectListGroupEye(groupRow, false);
  await closeListGroupSettings(page);
});

When('I show List group {string} from group settings', async ({ page }, groupName: string) => {
  await openListGroupSettings(page);
  const groupRow = listGroupVisibilityRowByName(page, groupName);

  await expectListGroupEye(groupRow, false);
  await groupRow.click();
  await expectListGroupEye(groupRow, true);
  await closeListGroupSettings(page);
});

Then('the List Groups list shows {string} as {word}', async ({ page }, groupName: string, state: string) => {
  expect(['shown', 'hidden']).toContain(state);
  await openListGroupSettings(page);
  await expectListGroupEye(listGroupVisibilityRowByName(page, groupName), state === 'shown');
});

Then('the List Groups list offers the groups {string} as shown', async ({ page }, groupIdList: string) => {
  await openListGroupSettings(page);
  for (const groupId of groupIdList.split(',').map((id) => id.trim())) {
    await expectListGroupEye(page.getByTestId(`list-group-visibility-${groupId}`), true);
  }
});

Then('the List Groups list does not offer {string}', async ({ page }, groupName: string) => {
  await openListGroupSettings(page);
  await expect(listGroupSettingsMenu(page).getByText('Groups', { exact: true })).toBeVisible();
  await expect(listGroupVisibilityRowByName(page, groupName)).toHaveCount(0);
});

Then('the List Groups list has no bulk visibility actions', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(listGroupVisibilityRows(page).first()).toBeVisible();
  await expect(page.getByTestId('list-show-all-groups')).toHaveCount(0);
  await expect(page.getByTestId('list-hide-all-groups')).toHaveCount(0);
  await expect(page.locator('[data-testid^="list-group-visibility-switch-"]')).toHaveCount(0);
  await expect(listGroupVisibilityRows(page).locator('[role="switch"]')).toHaveCount(0);
});

Then('the List has no Hide empty groups toggle', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-hide-empty-groups-toggle')).toHaveCount(0);
  await expect(page.getByTestId('list-hide-empty-groups-switch')).toHaveCount(0);
});

Then('List Hide empty groups is on', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-hide-empty-groups-switch')).toHaveAttribute('data-state', 'checked');
});

Then('List Hide empty groups is off', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-hide-empty-groups-switch')).toHaveAttribute('data-state', 'unchecked');
});

When('I toggle List Hide empty groups', async ({ page }) => {
  await openListGroupSettings(page);
  await page.getByTestId('list-hide-empty-groups-toggle').click();
});

When('I switch away from and back to the List view', async ({ page }) => {
  const gridViewId = gridViewIds.get(page);
  const listViewId = listViewIds.get(page);

  if (!gridViewId || !listViewId) throw new Error('The Grid and List view IDs must be resolved before switching views');

  await closeListGroupSettings(page);
  await DatabaseViewSelectors.viewTab(page, gridViewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${gridViewId}`);
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30_000 });

  await DatabaseViewSelectors.viewTab(page, listViewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${listViewId}`);
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  await openListGroupSettings(page);
});
