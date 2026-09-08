import { expect, test } from '@playwright/test';

import { addFeedView, getActiveRowIds, seedPrimaryTitlesDirect } from '../../support/feed-test-helpers';
import { addRows } from '../../support/field-type-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { DatabaseFeedSelectors } from '../../support/selectors';

test.describe('Feed incremental rendering (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_feed_load_more.dart: renders 20 cards, then 10 more per load-more click', async ({ page }) => {
    test.setTimeout(240_000);

    const desiredRows = 25;
    const rowsToAdd = desiredRows - (await getActiveRowIds(page)).length;

    await addRows(page, rowsToAdd);
    await expect.poll(() => getActiveRowIds(page), { timeout: 60_000 }).toHaveLength(desiredRows);
    await seedPrimaryTitlesDirect(
      page,
      Array.from({ length: desiredRows }, (_, index) => `Feed Item ${index + 1}`)
    );
    await addFeedView(page);

    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(20, { timeout: 30_000 });
    await expect(DatabaseFeedSelectors.loadMoreButton(page)).toContainText('(5)');

    await DatabaseFeedSelectors.loadMoreButton(page).scrollIntoViewIfNeeded();
    await DatabaseFeedSelectors.loadMoreButton(page).click();

    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(desiredRows, { timeout: 30_000 });
    await expect(DatabaseFeedSelectors.loadMoreButton(page)).toHaveCount(0);
    await expect(DatabaseFeedSelectors.newRowButton(page)).toBeVisible();
  });
});
