/**
 * Native embedded List block lifecycle regression.
 *
 * Complements the shared Grid block tests with the Flutter document contract:
 * List database views are serialized as `list` blocks and must keep that type
 * while being duplicated, deleted, and reloaded.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';

import { getPrimaryFieldId, loginAndCreateGrid, typeTextIntoCell } from '../../../support/filter-test-helpers';
import {
  createDocumentPageAndNavigate,
  ensurePageExpandedByViewId,
  insertLinkedDatabaseViaSlash,
} from '../../../support/page-utils';
import { BlockSelectors, itemDirectChildPageItems, PageSelectors } from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';

type ListBlockState = {
  blockId: string;
  databaseId: string | null;
  legacyViewId: string | null;
  viewIds: string[];
};

function listBlocks(editor: Locator): Locator {
  return editor.locator(BlockSelectors.blockSelector('list'));
}

async function readListBlockState(page: Page, documentViewId: string): Promise<ListBlockState[]> {
  return page.evaluate((viewId) => {
    type TestNode = {
      blockId?: string;
      data?: {
        database_id?: string;
        view_id?: string;
        view_ids?: string[];
      };
      type?: string;
    };
    type TestEditor = { children?: TestNode[] };
    const testWindow = window as Window & {
      __TEST_EDITORS__?: Record<string, TestEditor | undefined>;
    };

    return (testWindow.__TEST_EDITORS__?.[viewId]?.children ?? [])
      .filter((node) => node.type === 'list' && Boolean(node.blockId))
      .map((node) => ({
        blockId: node.blockId as string,
        databaseId: node.data?.database_id ?? null,
        legacyViewId: node.data?.view_id ?? null,
        viewIds: Array.isArray(node.data?.view_ids) ? node.data.view_ids : [],
      }));
  }, documentViewId);
}

async function expectCanonicalListBlockState(
  page: Page,
  documentViewId: string,
  expectedCount: number
): Promise<ListBlockState[]> {
  await expect
    .poll(
      async () => {
        const blocks = await readListBlockState(page, documentViewId);

        return {
          count: blocks.length,
          hasCompleteIds: blocks.every(
            (block) =>
              Boolean(block.blockId) &&
              Boolean(block.databaseId) &&
              Boolean(block.legacyViewId) &&
              block.viewIds.length > 0
          ),
          hasSynchronizedPrimaryViewIds: blocks.every((block) => block.legacyViewId === block.viewIds[0]),
        };
      },
      {
        message: `Expected ${expectedCount} canonical List block(s) with synchronized view_id/view_ids`,
        timeout: 30_000,
      }
    )
    .toEqual({
      count: expectedCount,
      hasCompleteIds: true,
      hasSynchronizedPrimaryViewIds: true,
    });

  return readListBlockState(page, documentViewId);
}

async function hoverBlockControls(page: Page, block: Locator): Promise<void> {
  await block.scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () => {
        const box = await block.boundingBox();

        if (!box) return false;

        await page.mouse.move(
          box.x + Math.min(Math.max(box.width / 2, 16), box.width - 1),
          box.y + Math.min(Math.max(box.height / 2, 16), box.height - 1)
        );
        return BlockSelectors.dragHandle(page)
          .isVisible()
          .catch(() => false);
      },
      { message: 'Expected native List block hover controls', timeout: 10_000 }
    )
    .toBe(true);
}

async function runBlockMenuAction(page: Page, block: Locator, action: 'delete' | 'duplicate'): Promise<void> {
  await hoverBlockControls(page, block);
  await BlockSelectors.dragHandle(page).click({ force: true });
  await expect(BlockSelectors.controlsMenu(page)).toBeVisible({ timeout: 5_000 });
  await BlockSelectors.controlsMenuAction(page, action).click({ force: true });
}

async function expectRenderedListBlocks(editor: Locator, expectedCount: number, rowTitle: string): Promise<void> {
  const blocks = listBlocks(editor);

  await expect(blocks).toHaveCount(expectedCount, { timeout: 30_000 });
  for (let index = 0; index < expectedCount; index += 1) {
    const databaseList = blocks.nth(index).getByTestId('database-list');

    await expect(databaseList).toBeVisible({ timeout: 30_000 });
    await expect(databaseList.locator('[data-testid^="list-primary-cell-"]').filter({ hasText: rowTitle })).toHaveCount(
      1,
      { timeout: 30_000 }
    );
  }
  await expect(editor.getByTestId('unsupported-block')).toHaveCount(0);
}

test.describe('Native embedded List block lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  test('duplicates, deletes, and reloads a linked List block without degrading it to Grid', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const rowTitle = 'Native List lifecycle row';

    await loginAndCreateGrid(page, request, generateRandomEmail());
    await typeTextIntoCell(page, await getPrimaryFieldId(page), 0, rowTitle);

    const documentViewId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'List');

    let editor = page.locator(`#editor-${documentViewId}`);
    const linkedChildren = PageSelectors.itemByViewId(page, documentViewId).locator(itemDirectChildPageItems(true));

    await expectRenderedListBlocks(editor, 1, rowTitle);
    const [sourceBlock] = await expectCanonicalListBlockState(page, documentViewId, 1);
    await ensurePageExpandedByViewId(page, documentViewId);
    await expect(linkedChildren).toHaveCount(1, { timeout: 30_000 });

    await runBlockMenuAction(page, listBlocks(editor).first(), 'duplicate');
    await expectRenderedListBlocks(editor, 2, rowTitle);
    const duplicatedBlocks = await expectCanonicalListBlockState(page, documentViewId, 2);
    await ensurePageExpandedByViewId(page, documentViewId);
    await expect(linkedChildren).toHaveCount(2, { timeout: 30_000 });

    expect(duplicatedBlocks.map((block) => block.blockId)).toContain(sourceBlock.blockId);
    expect(new Set(duplicatedBlocks.map((block) => block.legacyViewId)).size).toBe(2);
    expect(new Set(duplicatedBlocks.map((block) => block.databaseId)).size).toBe(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    editor = page.locator(`#editor-${documentViewId}`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expectRenderedListBlocks(editor, 2, rowTitle);
    await expectCanonicalListBlockState(page, documentViewId, 2);

    await runBlockMenuAction(page, listBlocks(editor).last(), 'delete');
    await expectRenderedListBlocks(editor, 1, rowTitle);
    const [remainingBlock] = await expectCanonicalListBlockState(page, documentViewId, 1);

    expect(remainingBlock.blockId).toBe(sourceBlock.blockId);
    // Wait past CollaborativeEditor's deletion grace period and prove the
    // linked child—not its parent document—was deleted from the outline.
    await ensurePageExpandedByViewId(page, documentViewId);
    await expect(linkedChildren).toHaveCount(1, { timeout: 30_000 });
    await expect(editor).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    editor = page.locator(`#editor-${documentViewId}`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expectRenderedListBlocks(editor, 1, rowTitle);
    await expectCanonicalListBlockState(page, documentViewId, 1);
  });
});
