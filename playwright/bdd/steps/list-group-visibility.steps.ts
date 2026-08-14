import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { getFieldIdByName, loginAndCreateGrid } from '../../support/field-type-helpers';
import { clickSelectCell, createSelectOption, selectExistingOption } from '../../support/filter-test-helpers';
import {
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const typeFieldIds = new WeakMap<Page, string>();
const gridViewIds = new WeakMap<Page, string>();
const listViewIds = new WeakMap<Page, string>();
const listGroupRowCounts = new WeakMap<Page, number>();

const listGroupHeaders = (page: Page) => page.locator('[data-testid^="list-group-header-"]');
const listGroupHeaderByName = (page: Page, name: string) => listGroupHeaders(page).filter({ hasText: name });

async function databaseViewIds(page: Page): Promise<string[]> {
  return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, ''))
      .filter((viewId): viewId is string => Boolean(viewId))
  );
}

async function openListGroupSettings(page: Page) {
  const alreadyOpen = await page
    .getByTestId('list-group-settings-menu')
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
  await expect(page.getByTestId('list-group-settings-menu')).toBeVisible();
}

async function closeListGroupSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('list-group-settings-menu')).toBeHidden();
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
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
  await page.locator('[data-testid^="list-group-by-field-"]').filter({ hasText: 'Type' }).click();
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

Then('the List Remove grouping action is available', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-remove-grouping')).toHaveCount(1);
  await expect(page.getByTestId('list-remove-grouping')).toBeVisible();
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

When('I remove List grouping', async ({ page }) => {
  await openListGroupSettings(page);
  await page.getByTestId('list-remove-grouping').click();
});

Then('the List has no group headers', async ({ page }) => {
  await expect(listGroupHeaders(page)).toHaveCount(0, { timeout: 15_000 });
});

Then('the List Remove grouping action is not available', async ({ page }) => {
  await openListGroupSettings(page);
  await expect(page.getByTestId('list-remove-grouping')).toHaveCount(0);
});

When('I change the active database layout to Board', async ({ page }) => {
  await changeActiveDatabaseLayout(page, 'Board');
});

When('I group the Board by the Type field', async ({ page }) => {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('board-group-settings-trigger').click();
  const typeField = page.getByTestId('board-group-by-field').filter({
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
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I change the active database layout to List', async ({ page }) => {
  await changeActiveDatabaseLayout(page, 'List');
});

When('I hide List group {string} from group settings', async ({ page }, groupName: string) => {
  await openListGroupSettings(page);
  const groupRow = page
    .locator('[data-testid^="list-group-visibility-"][role="menuitemcheckbox"]')
    .filter({ hasText: groupName });

  await expect(groupRow).toHaveCount(1);
  await groupRow.click();
  await closeListGroupSettings(page);
});

When('I show List group {string} from group settings', async ({ page }, groupName: string) => {
  await openListGroupSettings(page);
  const groupRow = page
    .locator('[data-testid^="list-group-visibility-"][role="menuitemcheckbox"]')
    .filter({ hasText: groupName });

  await expect(groupRow).toHaveCount(1);
  await groupRow.click();
  await closeListGroupSettings(page);
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
