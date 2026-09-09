import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { RowCoverType } from '../../../src/application/types';

import {
  activeDatabaseViewId,
  addFeedView,
  addRowFromFeed,
  getFeedCardRowIds,
  openFeedCard,
  switchToFeedOrGridView,
} from '../../support/feed-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { setGalleryRowMetaDirect } from '../../support/gallery-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseFeedSelectors, RowDetailSelectors } from '../../support/selectors';

test.describe('Desktop Feed creator, comment and reaction cases', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 1000, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_feed_card_creator_test.dart: new creator avatar persists after navigating away and back', async ({
    page,
  }) => {
    const gridId = await activeDatabaseViewId(page);
    const feedId = await addFeedView(page);
    const rowId = await addRowFromFeed(page);
    const name = page.getByTestId(`feed-card-creator-name-${rowId}`);
    const avatar = page.getByTestId(`feed-card-creator-avatar-${rowId}`);

    await expect(avatar).toBeVisible();
    await expect(name).not.toBeEmpty();
    const creator = await name.textContent();

    await switchToFeedOrGridView(page, gridId, 'Grid');
    await switchToFeedOrGridView(page, feedId, 'Feed');
    await expect(avatar).toBeVisible();
    await expect(name).toHaveText(creator!);
    await page.reload();
    await expect(avatar).toBeVisible({ timeout: 30_000 });
    await expect(name).toHaveText(creator!);
  });

  test('database_feed_comment_test.dart: attach a file from the Feed card and read it in row detail', async ({
    page,
  }) => {
    await addFeedView(page);
    const [rowId] = await getFeedCardRowIds(page);

    await DatabaseFeedSelectors.addCommentByRowId(page, rowId).click();
    await page.getByTestId(`feed-add-comment-attachment-${rowId}`).setInputFiles([
      {
        name: 'feed-comment.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Attachment from Feed'),
      },
      {
        name: 'feed-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
          'base64'
        ),
      },
    ]);
    await expect(page.getByTestId('comment-pending-attachment')).toHaveText(['feed-comment.txt', 'feed-image.png'], {
      timeout: 30_000,
    });
    await page.getByTestId(`feed-add-comment-submit-${rowId}`).click();
    await expect(DatabaseFeedSelectors.commentSummaryByRowId(page, rowId)).toContainText('1 reply');
    const modal = await openFeedCard(page, rowId);
    const attachment = modal.getByTestId('row-comment-attachment').filter({ hasText: 'feed-comment.txt' });

    await expect(attachment).toHaveText('feed-comment.txt');
    await expect(attachment).toHaveAttribute('href', /^https?:/, { timeout: 20_000 });
    const downloaded = page.waitForEvent('download');

    await attachment.click();
    const download = await downloaded;

    expect(download.suggestedFilename()).toBe('feed-comment.txt');
    const downloadedFile = await download.path();

    expect(downloadedFile).not.toBeNull();
    expect(await readFile(downloadedFile!, 'utf8')).toBe('Attachment from Feed');
    await expect
      .poll(() => modal.getByAltText('feed-image.png').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1);
    await closeRowDetailWithEscape(page);
    await openFeedCard(page, rowId);
    await expect(RowDetailSelectors.modal(page).getByTestId('row-comment-attachment')).toHaveText([
      'feed-comment.txt',
      'feed-image.png',
    ]);
  });

  test('desktop card defaults always display the row cover and icon, and follow metadata changes', async ({ page }) => {
    await addFeedView(page);
    const [rowId] = await getFeedCardRowIds(page);
    const card = DatabaseFeedSelectors.cardByRowId(page, rowId);

    await setGalleryRowMetaDirect(page, rowId, {
      icon: '🚀',
      cover: { data: '#ff0000', coverType: RowCoverType.ColorCover },
    });
    await expect(card.getByTestId('feed-card-icon')).toHaveText('🚀');
    await expect(card.getByTestId(`feed-card-cover-${rowId}`)).toBeVisible();
    await page.reload();
    await expect(card.getByTestId('feed-card-icon')).toHaveText('🚀', { timeout: 30_000 });
    await expect(card.getByTestId(`feed-card-cover-${rowId}`)).toBeVisible();
    await setGalleryRowMetaDirect(page, rowId, { icon: null, cover: null });
    await expect(card.getByTestId('feed-card-icon')).toHaveCount(0);
    await expect(card.getByTestId(`feed-card-cover-${rowId}`)).toHaveCount(0);
  });

  test('Feed mentions display names in the draft and desktop-compatible mentions in row detail', async ({ page }) => {
    await addFeedView(page);
    const [rowId] = await getFeedCardRowIds(page);

    await DatabaseFeedSelectors.addCommentByRowId(page, rowId).click();
    const input = DatabaseFeedSelectors.addCommentInputByRowId(page, rowId);

    await input.fill('@');
    const option = page.getByRole('listbox').getByRole('option').first();

    await expect(option).toBeVisible({ timeout: 20_000 });
    const name = (await option.textContent())!;

    await option.click();
    await expect(input).toHaveValue(`@${name} `);
    await page.keyboard.type('please review');
    await page.getByTestId(`feed-add-comment-submit-${rowId}`).click();
    const modal = await openFeedCard(page, rowId);

    await expect(modal.locator('[data-mention-id]')).toHaveText(`@${name}`);
    await expect(modal.getByTestId('row-comment-content')).toContainText('please review');
  });

  test('database_row_reaction_test.dart: multiple emojis toggle and sync between Feed and row detail', async ({
    page,
  }) => {
    await addFeedView(page);
    const [rowId] = await getFeedCardRowIds(page);
    let modal = await openFeedCard(page, rowId);

    await expect(modal.getByTestId(`detail-row-add-reaction-${rowId}`)).toHaveCount(0);
    await closeRowDetailWithEscape(page);
    const emojis: string[] = [];

    for (let index = 0; index < 2; index++) {
      await DatabaseFeedSelectors.reactionButtonByRowId(page, rowId).click();
      const emojiButton = page.locator('.emoji-picker button.text-xl').nth(index);

      await expect(emojiButton).toBeVisible();
      const emoji = (await emojiButton.textContent())!.trim();

      emojis.push(emoji);
      await emojiButton.click();
      await expect(DatabaseFeedSelectors.reactionChip(page, rowId, emoji)).toContainText('1');
    }

    expect(new Set(emojis).size).toBe(2);
    modal = await openFeedCard(page, rowId);
    await expect(modal.getByTestId(`detail-row-add-reaction-${rowId}`)).toHaveCount(0);
    for (const emoji of emojis) {
      await expect(modal.getByTestId(`detail-row-reaction-${rowId}-${emoji}`)).toHaveAttribute('aria-pressed', 'true');
    }

    await modal.getByTestId(`detail-row-reaction-${rowId}-${emojis[0]}`).click();
    await closeRowDetailWithEscape(page);
    await expect(DatabaseFeedSelectors.reactionChip(page, rowId, emojis[0])).toHaveCount(0);
    await expect(DatabaseFeedSelectors.reactionChip(page, rowId, emojis[1])).toContainText('1');
    await DatabaseFeedSelectors.reactionChip(page, rowId, emojis[1]).click();
    await expect(DatabaseFeedSelectors.reactionChip(page, rowId, emojis[1])).toHaveCount(0);
  });
});
