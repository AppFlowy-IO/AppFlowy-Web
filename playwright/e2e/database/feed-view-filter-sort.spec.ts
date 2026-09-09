import { expect, type Page, test } from '@playwright/test';

import { FieldType, SortCondition } from '../../../src/application/database-yjs/database.type';
import { setFiltersDirect, setSortsDirect } from '../../support/gallery-test-helpers';
import {
  addFeedView,
  expectFeedTitles,
  getActiveRowIds,
  seedPrimaryTitlesDirect,
  setRowCreatedAtDirect,
  waitForFeedCards,
} from '../../support/feed-test-helpers';
import {
  addFilterByFieldName,
  changeFilterCondition,
  deleteFilter,
  enterFilterText,
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupPageErrorHandling,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import { DatabaseFeedSelectors } from '../../support/selectors';

async function seedOrderedRows(page: Page): Promise<string[]> {
  const rowIds = await getActiveRowIds(page);
  const base = Math.floor(Date.now() / 1000) - 3_600;

  // Oldest row first in view order; the feed must show Cherry, Apple, Banana.
  await setRowCreatedAtDirect(page, rowIds[0], base);
  await setRowCreatedAtDirect(page, rowIds[1], base + 60);
  await setRowCreatedAtDirect(page, rowIds[2], base + 120);
  await seedPrimaryTitlesDirect(page, ['Banana', 'Apple', 'Cherry']);
  return rowIds;
}

test.describe('Feed filters and sorts (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_feed_filter_test.dart: a text filter narrows the cards and deleting it restores them', async ({
    page,
  }) => {
    await seedOrderedRows(page);
    await addFeedView(page);
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextContains);
    await enterFilterText(page, 'an');
    await page.keyboard.press('Escape');

    await expectFeedTitles(page, ['Banana']);

    await deleteFilter(page);
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);
  });

  test('database_feed_sort_test.dart: a persisted sort replaces the newest-first order and can flip direction', async ({
    page,
  }) => {
    await seedOrderedRows(page);
    await addFeedView(page);
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);

    await addSortByFieldName(page, 'Name');
    await closeSortMenu(page);
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);

    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expectFeedTitles(page, ['Cherry', 'Banana', 'Apple']);
  });

  test('database_feed_filter_and_sort_test.dart: filter and sort compose from the view conditions', async ({ page }) => {
    await seedOrderedRows(page);
    const primaryFieldId = await getPrimaryFieldId(page);

    await addFeedView(page);
    await waitForFeedCards(page, 3);

    await setSortsDirect(page, [{ fieldId: primaryFieldId, condition: SortCondition.Ascending }]);
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);

    await setFiltersDirect(page, [
      { fieldId: primaryFieldId, fieldType: FieldType.RichText, condition: TextFilterCondition.TextContains, content: 'a' },
    ]);
    await expectFeedTitles(page, ['Apple', 'Banana']);

    await setSortsDirect(page, []);
    await expect(DatabaseFeedSelectors.titles(page)).toHaveText(['Apple', 'Banana'], { timeout: 20_000 });

    await setFiltersDirect(page, []);
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);
  });

  test('toolbar search hides cards whose title does not match', async ({ page }) => {
    await seedOrderedRows(page);
    await addFeedView(page);
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);

    await page.getByTestId('database-actions-search').click();
    await page.getByTestId('database-actions-search-input').fill('app');

    await expect(DatabaseFeedSelectors.cards(page).locator('visible=true')).toHaveCount(1, { timeout: 10_000 });
    await expect(DatabaseFeedSelectors.titles(page).locator('visible=true')).toHaveText(['Apple']);

    await page.getByTestId('database-actions-search-clear').click();
    await expect(DatabaseFeedSelectors.cards(page).locator('visible=true')).toHaveCount(3, { timeout: 10_000 });
  });
});
