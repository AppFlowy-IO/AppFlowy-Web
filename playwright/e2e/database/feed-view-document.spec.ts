import { expect, test } from '@playwright/test';

import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { addFeedView, getFeedCardRowIds, openFeedCard, waitForFeedCards } from '../../support/feed-test-helpers';
import { addGalleryView } from '../../support/gallery-test-helpers';
import { generateRandomEmail, loginAndCreateGrid, setupPageErrorHandling } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import { BlockSelectors, DatabaseFeedSelectors, RowDetailSelectors } from '../../support/selectors';

// Enough paragraphs to push the card past its 600px cap.
const LONG_LINES = Array.from(
  { length: 24 },
  (_, index) => `Line ${index + 1}: Add content so the Feed card must clip its document preview.`
);

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
    await expect(DatabaseFeedSelectors.bodyByRowId(page, rowId)).toHaveAttribute('data-clipped', 'false');
    await expect(DatabaseFeedSelectors.openFullPageByRowId(page, rowId)).toHaveCount(0);
  });

  test('Figma feed card: long documents clip at 600px and open as a full page', async ({ page }) => {
    test.setTimeout(120_000);
    const [rowId] = await getFeedCardRowIds(page);

    await openFeedCard(page, rowId);
    // Focus the editor once; typeInRowDocument re-scrolls and waits per call.
    await typeInRowDocument(page, LONG_LINES[0]);
    for (const line of LONG_LINES.slice(1)) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line);
    }

    await closeRowDetailWithEscape(page);

    const preview = DatabaseFeedSelectors.documentPreviewByRowId(page, rowId);

    await expect(preview).toContainText('Line 1:', { timeout: 30_000 });

    const card = DatabaseFeedSelectors.cardByRowId(page, rowId);

    await expect(DatabaseFeedSelectors.bodyByRowId(page, rowId)).toHaveAttribute('data-clipped', 'true', {
      timeout: 30_000,
    });
    expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(600);

    // The button stays visible without hover and opens the row page, not the peek.
    await DatabaseFeedSelectors.openFullPageByRowId(page, rowId).click();
    await expect(page).toHaveURL(new RegExp(`[?&]r=${rowId}`));
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
    await expect(page.getByTestId('editor-content').first()).toContainText('Line 24:', { timeout: 30_000 });
  });

  test('a row linking back to its own Feed renders nested cards without recursively loading documents', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await renameCurrentDatabasePage(page, 'Recursive Feed');
    const [rowId] = await getFeedCardRowIds(page);
    const modal = await openFeedCard(page, rowId);

    await typeInRowDocument(page, 'A row can refer back to its database.');
    await page.keyboard.press('Enter');
    const editor = modal.getByTestId('editor-content').first();
    const documentId = (await editor.getAttribute('id'))!.replace('editor-', '');

    await insertLinkedDatabaseViaSlash(page, documentId, 'Recursive Feed', 'Feed');
    await expect(modal.getByTestId('database-feed').first()).toBeVisible({ timeout: 30_000 });
    await closeRowDetailWithEscape(page);
    const preview = DatabaseFeedSelectors.documentPreviewByRowId(page, rowId).first();
    const nestedFeed = preview.getByTestId('database-feed');

    await expect(nestedFeed).toBeAttached({ timeout: 30_000 });
    await expect(nestedFeed.locator('[data-testid^="feed-card-"][data-row-id]')).toHaveCount(3);
    await expect(nestedFeed.locator('[data-testid^="feed-document-preview-"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="feed-document-preview-${rowId}"]`)).toHaveCount(1);
  });
});

test.describe('Linked Feed inside a document (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('document_with_database_test.dart: the linked picker lists the container once and excludes Grid, Gallery and Feed tabs', async ({
    page,
  }) => {
    await renameCurrentDatabasePage(page, 'Feed picker source');
    await addFeedView(page);
    await addGalleryView(page);
    const documentId = await createDocumentPageAndNavigate(page);
    const editor = page.locator(`#editor-${documentId}`);

    await editor.click();
    await page.keyboard.type('/');
    await page.getByTestId('slash-menu-linkedGrid').click();
    const picker = page.locator('.MuiPopover-paper').last();

    await expect(picker).toContainText('Link to an existing database');
    await picker.locator('input').fill('Feed picker source');
    await expect(picker.getByText('Feed picker source', { exact: true })).toHaveCount(1);
    await expect(picker.getByText('Grid', { exact: true })).toHaveCount(0);
    await expect(picker.getByText('Gallery', { exact: true })).toHaveCount(0);
    await expect(picker.getByText('Feed', { exact: true })).toHaveCount(0);
    await picker.getByText('Feed picker source', { exact: true }).click();
    await expect(editor.getByTestId('database-grid')).toBeVisible({ timeout: 30_000 });
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
