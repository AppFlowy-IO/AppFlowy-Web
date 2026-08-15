import { expect, type Page, test } from '@playwright/test';

import { FieldType } from '../../../src/application/database-yjs/database.type';
import {
  activeDatabaseViewId,
  addGalleryView,
  createFieldDirect,
  databaseViewIds,
  expectGalleryTitles,
  seedPrimaryTitlesDirect,
  setCellDirect,
  switchToDatabaseView,
} from '../../support/gallery-test-helpers';
import {
  addFilterByFieldName,
  changeCheckboxFilterCondition,
  changeFilterCondition,
  deleteFilter,
  enterFilterText,
  generateRandomEmail,
  loginAndCreateGrid,
  NumberFilterCondition,
  selectFilterOption,
  setupPageErrorHandling,
  CheckboxFilterCondition,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGallerySelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from '../../support/selectors';

const OPTION_A = { id: 'gallery_option_a', name: 'Enterprise' };
const OPTION_B = { id: 'gallery_option_b', name: 'Personal' };

async function addTextFilter(page: Page, fieldName: string, value: string) {
  await addFilterByFieldName(page, fieldName);
  await changeFilterCondition(page, TextFilterCondition.TextContains);
  await enterFilterText(page, value);
  await page.keyboard.press('Escape');
}

async function addNumberFilter(page: Page, fieldName: string, condition: NumberFilterCondition, value: string) {
  await addFilterByFieldName(page, fieldName);
  await changeFilterCondition(page, condition);
  await enterFilterText(page, value);
  await page.keyboard.press('Escape');
}

async function addSelectFilter(page: Page, fieldName: string, option: string) {
  await addFilterByFieldName(page, fieldName);
  await selectFilterOption(page, option);
  await page.keyboard.press('Escape');
}

async function addCheckboxFilter(page: Page, fieldName: string, condition: CheckboxFilterCondition) {
  await addFilterByFieldName(page, fieldName);
  await changeCheckboxFilterCondition(page, condition);
  await page.keyboard.press('Escape');
}

async function convertFiltersToAdvanced(page: Page) {
  await DatabaseFilterSelectors.filterCondition(page).last().click({ force: true });
  await page.getByTestId('filter-more-options-button').click({ force: true });
  await page
    .locator('[data-slot="dropdown-menu-item"]')
    .filter({ hasText: /add to advanced filter/i })
    .click({ force: true });
  await expect(page.getByTestId('advanced-filters-badge')).toBeVisible();
}

async function deleteAdvancedFilter(page: Page, index: number) {
  if (
    !(await page
      .getByTestId('advanced-filter-row')
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('advanced-filters-badge').click({ force: true });
  }
  await page.getByTestId('delete-advanced-filter-button').nth(index).click({ force: true });
  await page.keyboard.press('Escape');
}

async function addSort(page: Page, fieldName: string, direction: SortDirection = SortDirection.Ascending) {
  const index = await page.getByTestId('database-sort-condition').count();

  await addSortByFieldName(page, fieldName);
  await closeSortMenu(page);
  if (direction === SortDirection.Descending) {
    await openSortMenu(page);
    await changeSortDirection(page, index, direction);
    await closeSortMenu(page);
  }
}

async function duplicateActiveDatabaseView(page: Page): Promise<string> {
  const sourceViewId = await activeDatabaseViewId(page);
  const previousViewIds = new Set(await databaseViewIds(page));
  const sourceTabLabel = DatabaseViewSelectors.viewTab(page, sourceViewId)
    .locator('span')
    .filter({ hasText: 'Gallery' });

  await sourceTabLabel.click({ button: 'right', force: true });
  await expect(DatabaseViewSelectors.tabActionDuplicate(page)).toBeVisible();
  await DatabaseViewSelectors.tabActionDuplicate(page).click({ force: true });

  let duplicatedViewId = '';

  await expect
    .poll(
      async () => {
        duplicatedViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';
        return duplicatedViewId;
      },
      { timeout: 60_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${duplicatedViewId}`);

  return duplicatedViewId;
}

async function changeDatabaseLayout(page: Page, layout: 'Grid' | 'Gallery') {
  await page.getByTestId('database-actions-settings').click();
  // Desktop parity adds the current layout as trailing metadata, so the
  // accessible name is e.g. "Layout Gallery".
  const layoutTrigger = page.getByRole('menuitem', { name: /^Layout\b/i });

  await expect(layoutTrigger).toBeVisible();
  await layoutTrigger.hover();

  const layoutMenu = page.locator('[data-slot="dropdown-menu-sub-content"]').last();
  const layoutOption = layoutMenu.getByRole('menuitem', { name: new RegExp(`^${layout}$`, 'i') });

  await expect(layoutOption).toBeVisible();
  await layoutOption.click();

  if (layout === 'Grid') {
    await expect(DatabaseViewSelectors.gridView(page)).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(DatabaseViewSelectors.galleryView(page)).toBeVisible({ timeout: 20_000 });
  }
}

test.describe('Database Gallery filters and sorts (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_gallery_field_type.dart: single select filter works (Category)', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha', 'Bravo', 'Charlie']);
    const categoryId = await createFieldDirect(page, {
      fieldType: FieldType.SingleSelect,
      name: 'Category',
      selectOptions: [OPTION_A, OPTION_B],
    });

    await setCellDirect(page, rowIds[0], categoryId, FieldType.SingleSelect, OPTION_A.id);
    await setCellDirect(page, rowIds[1], categoryId, FieldType.SingleSelect, OPTION_B.id);
    await setCellDirect(page, rowIds[2], categoryId, FieldType.SingleSelect, OPTION_A.id);
    await addGalleryView(page);
    await addSelectFilter(page, 'Category', OPTION_A.name);
    await expectGalleryTitles(page, ['Alpha', 'Charlie']);
  });

  test('database_gallery_field_type.dart: number filter works (Sales >= 500)', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Low', 'Target', 'High']);
    const salesId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Sales' });

    await setCellDirect(page, rowIds[0], salesId, FieldType.Number, '100');
    await setCellDirect(page, rowIds[1], salesId, FieldType.Number, '500');
    await setCellDirect(page, rowIds[2], salesId, FieldType.Number, '900');
    await addGalleryView(page);
    await addNumberFilter(page, 'Sales', NumberFilterCondition.GreaterThanOrEqualTo, '500');
    await expectGalleryTitles(page, ['Target', 'High']);
  });

  test('database_gallery_field_type.dart: checkbox filter works (Paid = No)', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Unpaid one', 'Paid', 'Unpaid two']);
    const paidId = await createFieldDirect(page, { fieldType: FieldType.Checkbox, name: 'Paid' });

    await setCellDirect(page, rowIds[0], paidId, FieldType.Checkbox, 'false');
    await setCellDirect(page, rowIds[1], paidId, FieldType.Checkbox, 'true');
    await setCellDirect(page, rowIds[2], paidId, FieldType.Checkbox, 'false');
    await addGalleryView(page);
    await addCheckboxFilter(page, 'Paid', CheckboxFilterCondition.IsUnchecked);
    await expectGalleryTitles(page, ['Unpaid one', 'Unpaid two']);
  });

  test('database_gallery_filter.dart: gallery updates when text filter is applied', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Alpha target', 'Bravo skip', 'Charlie target']);
    await addGalleryView(page);

    await addTextFilter(page, 'Name', 'target');
    await expectGalleryTitles(page, ['Alpha target', 'Charlie target']);
  });

  test('database_gallery_filter_advanced_test.dart: multiple filters combine then delete one', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha target', 'Bravo skip', 'Charlie target']);
    const scoreId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Score' });

    await setCellDirect(page, rowIds[0], scoreId, FieldType.Number, '10');
    await setCellDirect(page, rowIds[1], scoreId, FieldType.Number, '20');
    await setCellDirect(page, rowIds[2], scoreId, FieldType.Number, '30');
    const galleryViewId = await addGalleryView(page);

    await addTextFilter(page, 'Name', 'target');
    await addNumberFilter(page, 'Score', NumberFilterCondition.GreaterThan, '15');
    await convertFiltersToAdvanced(page);
    await page.keyboard.press('Escape');
    await expectGalleryTitles(page, ['Charlie target']);

    await deleteAdvancedFilter(page, 1);
    await expectGalleryTitles(page, ['Alpha target', 'Charlie target']);

    await DatabaseGallerySelectors.cardByRowId(page, rowIds[0]).hover();
    await DatabaseGallerySelectors.moreButtonByRowId(page, rowIds[0]).click();
    await page.getByTestId('gallery-row-delete').click();
    await expect(page.getByTestId('delete-row-confirm-button')).toBeVisible();
    await page.getByTestId('delete-row-confirm-button').click();
    await expect(page.getByTestId('delete-row-confirm-button')).toHaveCount(0);
    await expectGalleryTitles(page, ['Charlie target']);

    // Flutter parity: duplicate the filtered Gallery, convert the duplicate
    // to Grid, delete through that filtered Grid, then verify that the shared
    // database update is reflected in the original Gallery.
    await duplicateActiveDatabaseView(page);
    await expectGalleryTitles(page, ['Charlie target']);

    await changeDatabaseLayout(page, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(1);

    const filteredGridRow = DatabaseGridSelectors.dataRows(page).first();

    await filteredGridRow.hover();
    await filteredGridRow.locator('..').getByTestId('row-accessory-button').click();
    await page.getByTestId('row-menu-delete').click();
    await expect(page.getByTestId('delete-row-confirm-button')).toBeVisible();
    await page.getByTestId('delete-row-confirm-button').click();
    await expect(page.getByTestId('delete-row-confirm-button')).toHaveCount(0);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(0);

    await switchToDatabaseView(page, galleryViewId, 'Gallery');
    await expectGalleryTitles(page, []);
  });

  test('database_gallery_filter_advanced_test.dart: delete filter restores full gallery', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Alpha target', 'Bravo skip', 'Charlie target']);
    await addGalleryView(page);
    await addTextFilter(page, 'Name', 'target');
    await expectGalleryTitles(page, ['Alpha target', 'Charlie target']);

    await deleteFilter(page);
    await expectGalleryTitles(page, ['Alpha target', 'Bravo skip', 'Charlie target']);
  });

  test('database_gallery_sort_filter_test.dart: checkbox + single select filters with amount + name sorts', async ({
    page,
  }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha', 'Bravo', 'Charlie']);
    const checkedId = await createFieldDirect(page, { fieldType: FieldType.Checkbox, name: 'Qualified' });
    const categoryId = await createFieldDirect(page, {
      fieldType: FieldType.SingleSelect,
      name: 'Category',
      selectOptions: [OPTION_A, OPTION_B],
    });
    const amountId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Amount' });

    for (const [index, amount] of ['20', '30', '40'].entries()) {
      await setCellDirect(page, rowIds[index], checkedId, FieldType.Checkbox, index < 2 ? 'true' : 'false');
      await setCellDirect(page, rowIds[index], categoryId, FieldType.SingleSelect, OPTION_A.id);
      await setCellDirect(page, rowIds[index], amountId, FieldType.Number, amount);
    }
    await addGalleryView(page);

    await addCheckboxFilter(page, 'Qualified', CheckboxFilterCondition.IsChecked);
    await addSelectFilter(page, 'Category', OPTION_A.name);
    await addSort(page, 'Amount', SortDirection.Descending);
    await addSort(page, 'Name');
    await expectGalleryTitles(page, ['Bravo', 'Alpha']);
  });

  test('database_gallery_sort_filter_test.dart: text + number filters with amount + name sorts', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha target', 'Bravo target', 'Charlie skip']);
    const scoreId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Score' });
    const amountId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Amount' });

    for (const [index, value] of [
      { amount: '20', score: '10' },
      { amount: '30', score: '25' },
      { amount: '40', score: '50' },
    ].entries()) {
      await setCellDirect(page, rowIds[index], scoreId, FieldType.Number, value.score);
      await setCellDirect(page, rowIds[index], amountId, FieldType.Number, value.amount);
    }
    await addGalleryView(page);

    await addTextFilter(page, 'Name', 'target');
    await addNumberFilter(page, 'Score', NumberFilterCondition.GreaterThan, '15');
    await addSort(page, 'Amount', SortDirection.Descending);
    await addSort(page, 'Name');
    await expectGalleryTitles(page, ['Bravo target']);
  });

  test('database_gallery_sort_filter_test.dart: date + URL filters with amount + name sorts', async ({ page }) => {
    const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha', 'Bravo', 'Charlie']);
    const dateId = await createFieldDirect(page, { fieldType: FieldType.DateTime, name: 'Launch date' });
    const urlId = await createFieldDirect(page, { fieldType: FieldType.URL, name: 'Website' });
    const amountId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Amount' });

    await setCellDirect(page, rowIds[0], dateId, FieldType.DateTime, '1735689600');
    await setCellDirect(page, rowIds[0], urlId, FieldType.URL, 'https://appflowy.io/alpha');
    await setCellDirect(page, rowIds[0], amountId, FieldType.Number, '20');
    await setCellDirect(page, rowIds[1], dateId, FieldType.DateTime, '1735776000');
    await setCellDirect(page, rowIds[1], urlId, FieldType.URL, 'https://appflowy.io/bravo');
    await setCellDirect(page, rowIds[1], amountId, FieldType.Number, '30');
    await setCellDirect(page, rowIds[2], urlId, FieldType.URL, 'https://example.com');
    await setCellDirect(page, rowIds[2], amountId, FieldType.Number, '40');
    await addGalleryView(page);

    await addFilterByFieldName(page, 'Launch date');
    await changeFilterCondition(page, TextFilterCondition.TextIsNotEmpty);
    await page.keyboard.press('Escape');
    await addTextFilter(page, 'Website', 'appflowy');
    await addSort(page, 'Amount', SortDirection.Descending);
    await addSort(page, 'Name');
    await expectGalleryTitles(page, ['Bravo', 'Alpha']);
  });

  test('database_gallery_sort_test.dart: text sort ascending/descending', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Charlie', 'Alpha', 'Bravo']);
    await addGalleryView(page);

    await addSort(page, 'Name');
    await expectGalleryTitles(page, ['Alpha', 'Bravo', 'Charlie']);
    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expectGalleryTitles(page, ['Charlie', 'Bravo', 'Alpha']);
    await expect(page.getByTestId('database-sort-condition')).toHaveCount(1);
  });
});
