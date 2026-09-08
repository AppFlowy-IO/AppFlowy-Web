import { expect, test } from '@playwright/test';

import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { getFeedCardRowIds, openFeedCard, waitForFeedCards } from '../../support/feed-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import { BlockSelectors, DatabaseFeedSelectors, RowDetailSelectors } from '../../support/selectors';

const LONG_LINES = [
  'Line 1: Add content to exceed 120px height threshold for testing.',
  'Line 2: More text to increase the document height sufficiently.',
  'Line 3: Continue adding lines to trigger overflow state correctly.',
  'Line 4: Even more lines so the preview must clip.',
  'Line 5: The last line sits well below the collapsed preview.',
];

test.describe('Feed document preview (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Feed', {
      createWaitMs: 8_000,
      verify: async (currentPage) => {
        await expect(DatabaseFeedSelectors.feed(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });
    await waitForFeedCards(page, 3);
  });

  test('feed.feature: row document content typed in the row detail page appears on the card', async ({ page }) => {
    const [rowId] = await getFeedCardRowIds(page);

    await expect(DatabaseFeedSelectors.documentPreviewByRowId(page, rowId)).toHaveCount(0);

    await openFeedCard(page, rowId);
    await typeInRowDocument(page, 'Feed row document content');
    await closeRowDetailWithEscape(page);

    const preview = DatabaseFeedSelectors.documentPreviewByRowId(page, rowId);

    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText('Feed row document', { timeout: 30_000 });
    await expect(DatabaseFeedSelectors.documentPreviewToggleByRowId(page, rowId)).toHaveCount(0);
  });

  test('feed.feature: long documents collapse to 120px with See more / See less', async ({ page }) => {
    const [rowId] = await getFeedCardRowIds(page);

    await openFeedCard(page, rowId);
    for (const line of LONG_LINES) {
      await typeInRowDocument(page, line);
      await page.keyboard.press('Enter');
    }
    await closeRowDetailWithEscape(page);

    const preview = DatabaseFeedSelectors.documentPreviewByRowId(page, rowId);

    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toHaveAttribute('data-overflows', 'true', { timeout: 30_000 });

    const card = DatabaseFeedSelectors.cardByRowId(page, rowId);

    await card.hover();
    const toggle = DatabaseFeedSelectors.documentPreviewToggleByRowId(page, rowId);

    await expect(toggle).toContainText('See more');
    await toggle.click();
    await expect(preview).toHaveAttribute('data-expanded', 'true');
    await expect(preview).toContainText('Line 5');
    await expect(toggle).toContainText('See less');

    const cardHeight = (await card.boundingBox())?.height ?? 0;

    expect(cardHeight).toBeGreaterThan(0);
    expect(cardHeight).toBeLessThan(5_000);

    await toggle.click();
    await expect(preview).toHaveAttribute('data-expanded', 'false');
  });
});

test.describe('Linked Feed inside a document (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('feed.feature: clicking a card in a linked feed opens the row detail page', async ({ page }) => {
    const documentViewId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'Feed');

    const block = BlockSelectors.blockByType(page, 'feed').first();
    const cards = block.locator('[data-testid^="feed-card-"][data-row-id]');

    await expect(block.getByTestId('database-feed')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => cards.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

    const rowId = (await cards.first().getAttribute('data-row-id')) ?? '';

    expect(rowId).not.toBe('');

    // Click the card body (not a control) inside the document editor.
    await block.getByTestId(`feed-card-title-${rowId}`).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await closeRowDetailWithEscape(page);

    // Blank card padding must open the row as well.
    const card = block.getByTestId(`feed-card-${rowId}`);
    const box = await card.boundingBox();

    if (!box) throw new Error('Feed card had no layout box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await closeRowDetailWithEscape(page);

    // Controls inside the card still do not open the row.
    await card.hover();
    await block.getByTestId(`feed-card-more-${rowId}`).click();
    await expect(DatabaseFeedSelectors.rowActionMenu(page)).toBeVisible();
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});
