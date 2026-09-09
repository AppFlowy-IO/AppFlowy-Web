import { expect, type ElementHandle, type Page, test } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addFeedView,
  activeDatabaseViewId,
  getActiveRowIds,
  getFeedCardRowIds,
  seedPrimaryTitlesDirect,
} from '../../support/feed-test-helpers';
import { appendRowToCurrentDatabaseDirect, setPrimaryCellTextDirect } from '../../support/relation-test-helpers';
import { setupPageErrorHandling } from '../../support/filter-test-helpers';
import { DatabaseFeedSelectors, RowDetailSelectors } from '../../support/selectors';

const { Given, When, Then } = createBdd();
const MATCH_TITLE = 'Unique result beyond the initial Feed page';
const LIVE_MATCH_TITLE = 'This remote rename now matches the Feed search';
const DRAFT = 'Keep this unsent comment while I search';
const scenarios = new WeakMap<Page, {
  draftRowId: string;
  matchRowId: string;
  rowIds: string[];
  feedId: string;
  remotePage?: Page;
  remoteFeedRoot?: ElementHandle<HTMLElement | SVGElement>;
}>();

function scenario(page: Page) {
  const state = scenarios.get(page);

  if (!state) throw new Error('Feed search fixture was not initialized');
  return state;
}

Given('a Feed with thirty-five rows and a match outside the first page', async ({ page }) => {
  test.setTimeout(180_000);
  const initialRows = await getActiveRowIds(page);

  for (let index = initialRows.length; index < 35; index++) {
    await appendRowToCurrentDatabaseDirect(page, `Search fixture ${index + 1}`);
  }

  const rowIds = await seedPrimaryTitlesDirect(page, Array.from({ length: 35 }, (_, index) => `Search fixture ${index + 1}`));

  const feedId = await addFeedView(page);
  await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(20);
  const mountedIds = await getFeedCardRowIds(page);
  const matchRowId = rowIds.find((rowId) => !mountedIds.includes(rowId));

  if (!matchRowId) throw new Error('Expected a row outside the initial Feed page');
  await setPrimaryCellTextDirect(page, matchRowId, MATCH_TITLE);
  scenarios.set(page, { draftRowId: mountedIds[0], matchRowId, rowIds, feedId });
});

When('the user drafts a comment and searches for a missing value', async ({ page }) => {
  const { draftRowId } = scenario(page);

  await page.getByTestId(`feed-add-comment-collapsed-${draftRowId}`).click();
  await page.getByTestId(`feed-add-comment-input-${draftRowId}`).fill(DRAFT);
  await page.getByTestId('database-actions-search').click();
  await page.getByTestId('database-actions-search-input').fill('No row contains this missing search value');
});

Then('no additional Feed cards are mounted for the empty result', async ({ page }) => {
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(0);
  await expect.poll(() => DatabaseFeedSelectors.cards(page).count()).toBeLessThanOrEqual(20);
});

When('the user searches for the row outside the first page', async ({ page }) => {
  await page.getByTestId('database-actions-search-input').fill(MATCH_TITLE);
});

Then('only that result is added and clearing search restores the draft', async ({ page }) => {
  const { draftRowId, matchRowId } = scenario(page);

  await expect(DatabaseFeedSelectors.cardByRowId(page, matchRowId)).toBeVisible();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(1);
  await expect.poll(() => DatabaseFeedSelectors.cards(page).count()).toBeLessThanOrEqual(21);
  await page.getByTestId('database-actions-search-clear').click();
  await expect(page.locator('article[data-row-id]:visible')).toHaveCount(20);
  await expect(page.getByTestId(`feed-add-comment-input-${draftRowId}`)).toBeVisible();
  await expect(page.getByTestId(`feed-add-comment-input-${draftRowId}`)).toHaveValue(DRAFT);
});

Given('a fresh second tab searches for a value that no row contains', async ({ page }) => {
  const state = scenario(page);

  // Finish fixture writes before the second tab takes its initial snapshot.
  await page.evaluate(async () => {
    const flush = (window as unknown as { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> }).__TEST_FLUSH_ALL_SYNC__;

    if (!flush || !(await flush())) throw new Error('Could not flush the Feed fixture to sync');
  });
  const remote = await page.context().newPage();

  state.remotePage = remote;
  setupPageErrorHandling(remote);
  await remote.addInitScript(() => {
    const mountedRows = new Set<string>();

    (window as unknown as { __FEED_SEARCH_MOUNTED_ROWS__: Set<string> }).__FEED_SEARCH_MOUNTED_ROWS__ = mountedRows;
    const observer = new MutationObserver(() => {
      document.querySelectorAll('article[data-row-id]').forEach((card) => {
        const id = card.getAttribute('data-row-id');

        if (id) mountedRows.add(id);
      });
    });

    observer.observe(document, { childList: true, subtree: true });
  });
  await remote.goto(page.url());
  await expect.poll(() => activeDatabaseViewId(remote)).toBe(state.feedId);
  await expect.poll(() => getActiveRowIds(remote)).toHaveLength(35);
  await expect(DatabaseFeedSelectors.cards(remote)).toHaveCount(20);
  const previouslyMounted = await remote.evaluate(() =>
    [...(window as unknown as { __FEED_SEARCH_MOUNTED_ROWS__: Set<string> }).__FEED_SEARCH_MOUNTED_ROWS__]
  );
  const target = state.rowIds.find((id) => !previouslyMounted.includes(id));

  if (!target) throw new Error('Expected a never-mounted row in the fresh Feed tab');
  state.matchRowId = target;
  state.remoteFeedRoot = (await DatabaseFeedSelectors.feed(remote).elementHandle()) ?? undefined;
  await remote.getByTestId('database-actions-search').click();
  await remote.getByTestId('database-actions-search-input').fill(LIVE_MATCH_TITLE);
  await expect(DatabaseFeedSelectors.cards(remote)).toHaveCount(0);
});

When('the original tab renames a never-mounted row to match that search', async ({ page }) => {
  const { matchRowId, remotePage: remote } = scenario(page);

  if (!remote) throw new Error('The fresh search tab was not opened');
  expect(await remote.evaluate((id) =>
    (window as unknown as { __FEED_SEARCH_MOUNTED_ROWS__: Set<string> }).__FEED_SEARCH_MOUNTED_ROWS__.has(id), matchRowId
  )).toBe(false);
  await page.bringToFront();
  if (await DatabaseFeedSelectors.cardByRowId(page, matchRowId).count() === 0) {
    await DatabaseFeedSelectors.loadMoreButton(page).click();
  }
  await DatabaseFeedSelectors.titleByRowId(page, matchRowId).click();
  await expect(RowDetailSelectors.titleInput(page)).toBeVisible();
  await RowDetailSelectors.titleInput(page).fill(LIVE_MATCH_TITLE);
  await RowDetailSelectors.titleInput(page).press('Tab');
  await expect(RowDetailSelectors.titleInput(page)).toHaveValue(LIVE_MATCH_TITLE);
});

Then('the second tab shows the live result without remounting its Feed', async ({ page }) => {
  const { matchRowId, remotePage: remote, remoteFeedRoot } = scenario(page);

  if (!remote || !remoteFeedRoot) throw new Error('The fresh search tab was not initialized');
  await remote.bringToFront();
  await expect(DatabaseFeedSelectors.titleByRowId(remote, matchRowId)).toHaveText(LIVE_MATCH_TITLE);
  await expect(DatabaseFeedSelectors.cards(remote)).toHaveCount(1);
  await expect(remote.getByTestId('database-actions-search-input')).toHaveValue(LIVE_MATCH_TITLE);
  expect(await DatabaseFeedSelectors.feed(remote).evaluate((current, original) => current === original, remoteFeedRoot)).toBe(true);
  await remote.close();
});
