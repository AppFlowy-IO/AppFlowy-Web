import { expect, Page, test } from '@playwright/test';

import {
  addFilterByFieldName,
  changeFilterCondition,
  enterFilterText,
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupPageErrorHandling,
  TextFilterCondition,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { closeSortMenu } from '../../support/sort-test-helpers';

async function databaseViewIds(page: Page): Promise<string[]> {
  return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, ''))
      .filter((viewId): viewId is string => Boolean(viewId))
  );
}

async function addListView(page: Page): Promise<string> {
  const previousViewIds = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  await DatabaseViewSelectors.viewTypeOption(page, 'List').click();

  let listViewId = '';

  await expect
    .poll(
      async () => {
        listViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';
        return listViewId;
      },
      { timeout: 15_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${listViewId}`);
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  return listViewId;
}

async function switchToView(page: Page, viewId: string, layout: 'Grid' | 'List') {
  await DatabaseViewSelectors.viewTab(page, viewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);

  if (layout === 'Grid') {
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  }
}

async function seedNamedRows(page: Page): Promise<string> {
  const primaryFieldId = await getPrimaryFieldId(page);

  await typeTextIntoCell(page, primaryFieldId, 0, 'Charlie skip');
  await typeTextIntoCell(page, primaryFieldId, 1, 'Alpha target');
  await typeTextIntoCell(page, primaryFieldId, 2, 'Bravo target');
  return primaryFieldId;
}

async function expectListTitles(page: Page, expected: string[]) {
  await expect(DatabaseListSelectors.primaryCells(page)).toHaveText(expected, { timeout: 15_000 });
}

async function addTargetFilter(page: Page) {
  await addFilterByFieldName(page, 'Name');
  await changeFilterCondition(page, TextFilterCondition.TextContains);
  await enterFilterText(page, 'target');
  await page.keyboard.press('Escape');
}

async function addNonEmptyNameFilter(page: Page) {
  await addFilterByFieldName(page, 'Name');
  await changeFilterCondition(page, TextFilterCondition.TextIsNotEmpty);
  await page.keyboard.press('Escape');
}

async function addNameSort(page: Page) {
  await page.keyboard.press('Escape');
  // Use a DOM click here for the same reason as addFilterByFieldName: the
  // toolbar button can be partially covered while a newly added List mounts.
  await DatabaseFilterSelectors.sortButton(page).evaluate((element) => (element as HTMLButtonElement).click());
  const nameProperty = DatabaseFilterSelectors.propertyItemByName(page, 'Name');

  await expect(nameProperty).toBeVisible({ timeout: 10_000 });
  await nameProperty.evaluate((element) => (element as HTMLElement).click());
  await expect(page.getByTestId('database-sort-condition')).toHaveCount(1);
}

test.describe('List view-scoped filter and sort state (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('filter persists when switching to grid and back', async ({ page }) => {
    await seedNamedRows(page);
    const gridViewId = (await databaseViewIds(page))[0];
    const listViewId = await addListView(page);

    await addTargetFilter(page);
    await expectListTitles(page, ['Alpha target', 'Bravo target']);

    await switchToView(page, gridViewId, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    await switchToView(page, listViewId, 'List');
    await expectListTitles(page, ['Alpha target', 'Bravo target']);
    await expect(page.getByTestId('database-filter-condition')).toHaveCount(1);
  });

  test('filter is isolated per view', async ({ page }) => {
    await seedNamedRows(page);
    const firstListViewId = await addListView(page);

    await addTargetFilter(page);
    await expectListTitles(page, ['Alpha target', 'Bravo target']);

    const secondListViewId = await addListView(page);

    expect(secondListViewId).not.toBe(firstListViewId);
    await expectListTitles(page, ['Charlie skip', 'Alpha target', 'Bravo target']);
    await expect(page.getByTestId('database-filter-condition')).toHaveCount(0);

    await switchToView(page, firstListViewId, 'List');
    await expectListTitles(page, ['Alpha target', 'Bravo target']);
    await expect(page.getByTestId('database-filter-condition')).toHaveCount(1);
  });

  test('sort persists when switching views', async ({ page }) => {
    await seedNamedRows(page);
    const gridViewId = (await databaseViewIds(page))[0];
    const listViewId = await addListView(page);

    await addNameSort(page);
    await closeSortMenu(page);
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);

    await switchToView(page, gridViewId, 'Grid');
    await switchToView(page, listViewId, 'List');
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);
    await expect(page.getByTestId('database-sort-condition')).toHaveCount(1);
  });

  test('sort is isolated per view', async ({ page }) => {
    await seedNamedRows(page);
    const firstListViewId = await addListView(page);

    await addNameSort(page);
    await closeSortMenu(page);
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);

    const secondListViewId = await addListView(page);

    expect(secondListViewId).not.toBe(firstListViewId);
    await expectListTitles(page, ['Charlie skip', 'Alpha target', 'Bravo target']);
    await expect(page.getByTestId('database-sort-condition')).toHaveCount(0);

    await switchToView(page, firstListViewId, 'List');
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);
    await expect(page.getByTestId('database-sort-condition')).toHaveCount(1);
  });

  test('database_list_filter_and_sort_test.dart: a new filtered row reactively enters List in sorted order', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const primaryFieldId = await seedNamedRows(page);
    const gridViewId = (await databaseViewIds(page))[0];
    const listViewId = await addListView(page);

    await addNonEmptyNameFilter(page);
    await addNameSort(page);
    await closeSortMenu(page);
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);

    await DatabaseListSelectors.newRowButton(page).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await expect(RowDetailSelectors.titleInput(page)).toHaveValue('');

    // The new row starts outside the active text filter. Updating it through
    // row detail must notify the mounted List immediately and sort it between
    // the existing matching rows, without switching or remounting the view.
    await expectListTitles(page, ['Alpha target', 'Bravo target', 'Charlie skip']);
    await RowDetailSelectors.titleInput(page).fill('Beta target');
    await expectListTitles(page, ['Alpha target', 'Beta target', 'Bravo target', 'Charlie skip']);

    await closeRowDetailWithEscape(page);
    await switchToView(page, gridViewId, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).filter({ hasText: 'Beta target' })
    ).toHaveCount(1);

    // A reload rehydrates the database and view configuration from persisted
    // collaborative state, rather than retaining the result in component state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await switchToView(page, listViewId, 'List');
    await expectListTitles(page, ['Alpha target', 'Beta target', 'Bravo target', 'Charlie skip']);
    await expect(page.getByTestId('database-filter-condition')).toHaveCount(1);
    await expect(page.getByTestId('database-sort-condition')).toHaveCount(1);
  });
});
