import { expect, test } from '@playwright/test';

import { DatabaseViewLayout } from '../../../src/application/types';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  addFeedView,
  addRowFromFeed,
  expectFeedTitles,
  getActiveRowIds,
  getFeedCardRowIds,
  openFeedCard,
  openFeedCardMenu,
  seedPrimaryTitlesDirect,
  setRowCreatedAtDirect,
  switchToFeedOrGridView,
  waitForFeedCards,
} from '../../support/feed-test-helpers';
import { addRows } from '../../support/field-type-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseFeedSelectors, DatabaseViewSelectors, RowDetailSelectors } from '../../support/selectors';

test.describe('Standalone Feed creation (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  test('database_feed_card_actions_test.dart: a new Feed page shows the three default cards', async ({
    page,
    request,
  }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Feed', {
      createWaitMs: 8_000,
      verify: async (currentPage) => {
        await expect(DatabaseFeedSelectors.feed(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });

    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('Feed');
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3, { timeout: 30_000 });
    await expect(DatabaseFeedSelectors.newRowButton(page)).toBeVisible();
    await expect(page.getByTestId('database-actions-search')).toBeVisible();
    await expect(page.getByTestId('database-actions-sort')).toBeVisible();
  });
});

test.describe('Feed view basics (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_feed_basic.dart: feed view can be created from grid tab bar', async ({ page }) => {
    const gridViewId = (await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid'))!.replace(
      'view-tab-',
      ''
    );
    const feedViewId = await addFeedView(page);

    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3, { timeout: 30_000 });

    await switchToFeedOrGridView(page, gridViewId, 'Grid');
    await switchToFeedOrGridView(page, feedViewId, 'Feed');
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3, { timeout: 30_000 });
  });

  test('database_feed_basic.dart: feed view shows rows sorted by created time descending', async ({ page }) => {
    const rowIds = await getActiveRowIds(page);

    await seedPrimaryTitlesDirect(page, ['AAA_First', 'BBB_Second', 'CCC_Third']);
    await addRows(page, 1);
    await expect.poll(() => getActiveRowIds(page), { timeout: 20_000 }).toHaveLength(4);

    const newestRowId = (await getActiveRowIds(page)).find((rowId) => !rowIds.includes(rowId))!;
    const base = Math.floor(Date.now() / 1000) - 3_600;

    await setRowCreatedAtDirect(page, rowIds[0], base);
    await setRowCreatedAtDirect(page, rowIds[1], base + 60);
    await setRowCreatedAtDirect(page, rowIds[2], base + 120);
    await setRowCreatedAtDirect(page, newestRowId, base + 600);
    await seedPrimaryTitlesDirect(page, ['AAA_First', 'BBB_Second', 'CCC_Third', 'ZZZ_Newest']);

    await addFeedView(page);

    await expectFeedTitles(page, ['ZZZ_Newest', 'CCC_Third', 'BBB_Second', 'AAA_First']);
    expect(await getFeedCardRowIds(page)).toEqual([newestRowId, rowIds[2], rowIds[1], rowIds[0]]);
  });

  test('database_feed_card_actions_test.dart: more menu duplicates and deletes a card', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Alpha', 'Beta', 'Gamma']);
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const [firstRowId] = await getFeedCardRowIds(page);

    await openFeedCardMenu(page, firstRowId);
    await DatabaseFeedSelectors.rowDuplicate(page).click();
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(4, { timeout: 20_000 });
    await expect.poll(() => getActiveRowIds(page)).toHaveLength(4);

    const [rowToDelete] = await getFeedCardRowIds(page);

    await openFeedCardMenu(page, rowToDelete);
    await DatabaseFeedSelectors.rowDelete(page).click();
    await expect(RowDetailSelectors.deleteRowConfirmButton(page)).toBeVisible({ timeout: 10_000 });
    await RowDetailSelectors.deleteRowConfirmButton(page).click();
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3, { timeout: 20_000 });
    await expect(DatabaseFeedSelectors.cardByRowId(page, rowToDelete)).toHaveCount(0);
  });

  test('database_feed_card_actions_test.dart: clicking the more button does not open row detail', async ({ page }) => {
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const [firstRowId] = await getFeedCardRowIds(page);

    await openFeedCardMenu(page, firstRowId);
    await expect(DatabaseFeedSelectors.rowDuplicate(page)).toBeVisible();
    await expect(DatabaseFeedSelectors.rowDelete(page)).toBeVisible();
    await expect(DatabaseFeedSelectors.rowActionMenu(page).getByRole('menuitem')).toHaveText(['Duplicate', 'Delete']);
    await expect(page.getByTestId(`feed-card-actions-${firstRowId}`)).toHaveCSS('opacity', '1');
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(DatabaseFeedSelectors.rowActionMenu(page)).toHaveCount(0);
    await expect(DatabaseFeedSelectors.feed(page)).toBeVisible();
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
  });

  test('clicking a feed card opens the row detail page', async ({ page }) => {
    await seedPrimaryTitlesDirect(page, ['Open me', 'Second', 'Third']);
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const [firstRowId] = await getFeedCardRowIds(page);
    const modal = await openFeedCard(page, firstRowId);

    await expect(modal.getByTestId('row-title-input')).toContainText('Open me');
    await closeRowDetailWithEscape(page);
    await expect(DatabaseFeedSelectors.feed(page)).toBeVisible();
  });

  test('database_feed_load_more.dart: the trailing new-row button opens row detail and prepends the row', async ({
    page,
  }) => {
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const newRowId = await addRowFromFeed(page);

    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(4, { timeout: 20_000 });
    expect((await getFeedCardRowIds(page))[0]).toBe(newRowId);
    await expect(DatabaseFeedSelectors.titleByRowId(page, newRowId)).toHaveText('Untitled');
  });

  test('database_feed_comment_test.dart: adding a comment from the card shows the reply summary', async ({ page }) => {
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const [rowId] = await getFeedCardRowIds(page);

    await DatabaseFeedSelectors.addCommentByRowId(page, rowId).click();
    await DatabaseFeedSelectors.addCommentInputByRowId(page, rowId).fill('Looks great');
    await page.keyboard.press('Enter');

    await expect(DatabaseFeedSelectors.commentSummaryByRowId(page, rowId)).toContainText('1 reply', {
      timeout: 15_000,
    });
    await expect(DatabaseFeedSelectors.addCommentByRowId(page, rowId)).toHaveCount(0);
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);

    const modal = await openFeedCard(page, rowId);

    await expect(modal.getByTestId('row-comment-section')).toContainText('Looks great', { timeout: 15_000 });
    await closeRowDetailWithEscape(page);
  });

  test('database_row_reaction_test.dart: hover reaction button adds a row reaction chip that toggles off', async ({
    page,
  }) => {
    await addFeedView(page);
    await waitForFeedCards(page, 3);

    const [rowId] = await getFeedCardRowIds(page);
    const card = DatabaseFeedSelectors.cardByRowId(page, rowId);

    await card.hover();
    await DatabaseFeedSelectors.reactionButtonByRowId(page, rowId).click();
    const emojiButton = page.locator('.emoji-picker button.text-xl').first();

    await expect(emojiButton).toBeVisible({ timeout: 15_000 });
    const emoji = (await emojiButton.textContent())?.trim() ?? '';

    expect(emoji).not.toBe('');
    await emojiButton.click();

    const chip = DatabaseFeedSelectors.reactionChip(page, rowId, emoji);

    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-reacted', 'true');
    await expect(chip).toContainText('1');
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);

    await chip.click();
    await expect(chip).toHaveCount(0, { timeout: 15_000 });
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
  });

  test('database_settings_list.dart: switching an existing view to the Feed layout only exposes the layout setting', async ({
    page,
  }) => {
    await page.getByTestId('database-actions-settings').click();
    await DatabaseViewSelectors.layoutSettingsTrigger(page).hover();
    await expect(DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Feed)).toBeVisible({ timeout: 10_000 });
    await DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Feed).click();

    await expect(DatabaseFeedSelectors.feed(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3, { timeout: 30_000 });

    await page.getByTestId('database-actions-settings').click();
    await expect(DatabaseFeedSelectors.settingsMenu(page)).toBeVisible();
    await expect(DatabaseViewSelectors.layoutSettingsTrigger(page)).toBeVisible();
    await expect(page.getByTestId('database-properties-settings-trigger')).toHaveCount(0);
    await expect(DatabaseFeedSelectors.settingsMenu(page).getByRole('menuitem')).toHaveCount(1);
    await DatabaseViewSelectors.layoutSettingsTrigger(page).hover();
    await DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Grid).click();
    await expect(DatabaseViewSelectors.gridView(page)).toBeVisible();
  });
});
