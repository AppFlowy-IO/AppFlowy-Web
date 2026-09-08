import { expect, test } from '@playwright/test';

import { seedFeedHundredRows } from '../../support/feed-fixture-helpers';
import {
  activeDatabaseViewId,
  addFeedView,
  addRowFromFeed,
  getActiveRowIds,
  getFeedCardRowIds,
  switchToFeedOrGridView,
} from '../../support/feed-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { DatabaseFeedSelectors, DatabaseGridSelectors } from '../../support/selectors';

test('database_feed_load_more.dart: import-equivalent 100 rows, load every card, switch views and create a row', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const gridViewId = await activeDatabaseViewId(page);
  const importedIds = await seedFeedHundredRows(page);

  await expect(DatabaseGridSelectors.dataRows(page).first()).toContainText('Feed Item 1');
  expect(importedIds).toHaveLength(100);
  const feedViewId = await addFeedView(page);

  await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(20, { timeout: 30_000 });
  await expect(DatabaseFeedSelectors.loadMoreButton(page)).toContainText('(80)');
  for (let expected = 30; expected <= 100; expected += 10) {
    await DatabaseFeedSelectors.loadMoreButton(page).scrollIntoViewIfNeeded();
    await DatabaseFeedSelectors.loadMoreButton(page).click();
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(expected, { timeout: 30_000 });
  }

  await expect(DatabaseFeedSelectors.loadMoreButton(page)).toHaveCount(0);
  expect(new Set(await getFeedCardRowIds(page))).toEqual(new Set(importedIds));
  await expect(DatabaseFeedSelectors.titles(page)).toHaveCount(100);
  await switchToFeedOrGridView(page, gridViewId, 'Grid');
  expect(await getActiveRowIds(page)).toHaveLength(100);
  await switchToFeedOrGridView(page, feedViewId, 'Feed');
  await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(20, { timeout: 30_000 });
  const newId = await addRowFromFeed(page);

  await expect.poll(() => getActiveRowIds(page)).toHaveLength(101);
  await expect.poll(async () => (await getFeedCardRowIds(page))[0]).toBe(newId);
  await switchToFeedOrGridView(page, gridViewId, 'Grid');
  expect(await getActiveRowIds(page)).toContain(newId);
});
