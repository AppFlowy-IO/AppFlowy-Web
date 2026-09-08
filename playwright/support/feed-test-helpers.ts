import { expect, type Locator, type Page } from '@playwright/test';

import { waitForDatabaseTestContext } from './relation-test-helpers';
import { closeRowDetailWithEscape } from './row-detail-helpers';
import { DatabaseFeedSelectors, DatabaseViewSelectors, RowDetailSelectors } from './selectors';
import { databaseViewIds, getActiveRowIds } from './gallery-test-helpers';

export { activeDatabaseViewId, databaseViewIds, getActiveRowIds, seedPrimaryTitlesDirect } from './gallery-test-helpers';

/** Add a Feed tab from the database tab bar and wait until it renders (Desktop `tapCreateLinkedDatabaseViewButton(Feed)`). */
export async function addFeedView(page: Page): Promise<string> {
  const previousViewIds = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  const option = page.getByTestId('add-feed-view-button');

  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  let feedViewId = '';

  await expect
    .poll(
      async () => {
        feedViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';
        return feedViewId;
      },
      { timeout: 20_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${feedViewId}`);
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible({ timeout: 30_000 });
  return feedViewId;
}

export async function switchToFeedOrGridView(page: Page, viewId: string, layout: 'Feed' | 'Grid'): Promise<void> {
  await DatabaseViewSelectors.viewTab(page, viewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);

  if (layout === 'Feed') {
    await expect(DatabaseFeedSelectors.feed(page)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(DatabaseViewSelectors.gridView(page)).toBeVisible({ timeout: 30_000 });
  }
}

/** Row ids of the rendered feed cards, in DOM (feed) order. */
export async function getFeedCardRowIds(page: Page): Promise<string[]> {
  return DatabaseFeedSelectors.cards(page).evaluateAll((cards) =>
    cards
      .filter((card) => !(card as HTMLElement).hidden)
      .map((card) => card.getAttribute('data-row-id'))
      .filter((rowId): rowId is string => Boolean(rowId))
  );
}

export async function expectFeedTitles(page: Page, titles: string[]): Promise<void> {
  await expect(DatabaseFeedSelectors.titles(page)).toHaveCount(titles.length, { timeout: 20_000 });
  await expect(DatabaseFeedSelectors.titles(page)).toHaveText(titles, { timeout: 20_000 });
}

export async function waitForFeedCards(page: Page, minimumCount: number): Promise<void> {
  await expect
    .poll(() => DatabaseFeedSelectors.cards(page).count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(minimumCount);
}

/** Click a card body (not a control) to open the row detail page. */
export async function openFeedCard(page: Page, rowId: string): Promise<Locator> {
  await DatabaseFeedSelectors.titleByRowId(page, rowId).click();
  const modal = RowDetailSelectors.modal(page).last();

  await expect(modal).toBeVisible({ timeout: 15_000 });
  return modal;
}

/** Hover the card so the Desktop-style hover actions appear, then open the more menu. */
export async function openFeedCardMenu(page: Page, rowId: string): Promise<void> {
  const card = DatabaseFeedSelectors.cardByRowId(page, rowId);

  await card.scrollIntoViewIfNeeded();
  await card.hover();
  const moreButton = DatabaseFeedSelectors.moreButtonByRowId(page, rowId);

  await expect(moreButton).toBeVisible({ timeout: 10_000 });
  await moreButton.click();
  await expect(DatabaseFeedSelectors.rowActionMenu(page)).toBeVisible({ timeout: 10_000 });
}

/** Create a row from the trailing feed button; the row detail page opens and is dismissed. */
export async function addRowFromFeed(page: Page): Promise<string> {
  const previousRowIds = new Set(await getActiveRowIds(page));

  await DatabaseFeedSelectors.newRowButton(page).scrollIntoViewIfNeeded();
  await DatabaseFeedSelectors.newRowButton(page).click();
  await expect(RowDetailSelectors.modal(page)).toHaveCount(1, { timeout: 15_000 });
  await closeRowDetailWithEscape(page);

  let newRowId = '';

  await expect
    .poll(
      async () => {
        newRowId = (await getActiveRowIds(page)).find((rowId) => !previousRowIds.has(rowId)) ?? '';
        return newRowId;
      },
      { timeout: 15_000 }
    )
    .not.toBe('');
  return newRowId;
}

/** Read `created_at` (seconds) per active row through the database test bridge. */
export async function getRowCreatedAtDirect(page: Page): Promise<Record<string, number>> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(async () => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const rows = (view.get('row_orders').toArray() as Array<{ id: string; is_deleted?: boolean }>).filter(
      (row) => !row.is_deleted
    );
    const result: Record<string, number> = {};

    for (const { id } of rows) {
      const rowDoc = ctx.rowMap?.[id] ?? (await ctx.ensureRow?.(id));
      const createdAt = rowDoc?.getMap('data').get('data')?.get('created_at');

      if (createdAt !== undefined) result[id] = Number(createdAt);
    }

    return result;
  });
}

/** Overwrite a row's `created_at` so feed ordering tests are deterministic. */
export async function setRowCreatedAtDirect(page: Page, rowId: string, createdAtSeconds: number): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(
    async ({ createdAtSeconds, rowId }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was unavailable`);
      rowDoc.transact(() => {
        rowDoc.getMap('data').get('data').set('created_at', String(createdAtSeconds));
      });
    },
    { createdAtSeconds, rowId }
  );
}
