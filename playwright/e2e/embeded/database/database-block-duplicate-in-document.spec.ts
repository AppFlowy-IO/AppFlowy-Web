/**
 * Embedded Database Block Duplication Tests
 *
 * Mirrors the Flutter desktop document-block duplication flow:
 * - duplicate inline database block => deep copy with "(Copy)" child page
 * - duplicate linked database block => another linked view pointing to same database
 */
import { test, expect, Locator, Page } from '@playwright/test';
import {
  AddPageSelectors,
  BlockSelectors,
  DatabaseGridSelectors,
  itemDirectChildPageItems,
  ModalSelectors,
  PageSelectors,
  ViewActionSelectors,
} from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../../support/auth-flow-helpers';
import {
  createDocumentPageAndNavigate,
  ensurePageExpandedByViewId,
  expandSpaceByName,
  insertLinkedDatabaseViaSlash,
} from '../../../support/page-utils';
import { editFirstGridCell, firstGridCellText, insertInlineGridViaSlash } from '../../../support/duplicate-test-helpers';

const spaceName = 'General';
const sourceDatabaseName = 'Block Database';

function editorForView(page: Page, viewId: string): Locator {
  return page.locator(`#editor-${viewId}`);
}

function databaseBlocks(editor: Locator): Locator {
  return editor.locator(BlockSelectors.blockSelector('grid'));
}

async function getDatabaseBlockState(page: Page, docViewId: string) {
  return page.evaluate((currentDocViewId) => {
    const testWindow = window as Window & {
      __TEST_EDITORS__?: Record<
        string,
        {
          children?: Array<{
            type?: string;
            blockId?: string;
            data?: {
              parent_id?: string;
              view_id?: string;
              view_ids?: string[];
              database_id?: string;
            };
          }>;
        }
      >;
    };
    const editor = testWindow.__TEST_EDITORS__?.[currentDocViewId];
    const children = editor?.children ?? [];

    return children
      .filter((node) => node?.type === 'grid')
      .map((node) => ({
        blockId: node.blockId,
        viewIds: Array.isArray(node.data?.view_ids)
          ? node.data?.view_ids
          : node.data?.view_id
          ? [node.data.view_id]
          : [],
        databaseId: node.data?.database_id ?? null,
      }));
  }, docViewId);
}

async function waitForInlineDuplicateRewrite(page: Page, docViewId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const blocks = await getDatabaseBlockState(page, docViewId);

        if (blocks.length < 2) {
          return false;
        }

        const firstViewId = blocks[0]?.viewIds?.[0] ?? null;
        const secondViewId = blocks[1]?.viewIds?.[0] ?? null;
        const firstDatabaseId = blocks[0]?.databaseId ?? null;
        const secondDatabaseId = blocks[1]?.databaseId ?? null;

        return (
          firstViewId !== null &&
          secondViewId !== null &&
          firstDatabaseId !== null &&
          secondDatabaseId !== null &&
          firstViewId !== secondViewId &&
          firstDatabaseId !== secondDatabaseId
        );
      },
      { timeout: 15000 }
    )
    .toBe(true);
}

async function waitForLinkedDuplicateRewrite(page: Page, docViewId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const blocks = await getDatabaseBlockState(page, docViewId);

        if (blocks.length < 2) {
          return false;
        }

        const firstViewId = blocks[0]?.viewIds?.[0] ?? null;
        const secondViewId = blocks[1]?.viewIds?.[0] ?? null;
        const firstDatabaseId = blocks[0]?.databaseId ?? null;
        const secondDatabaseId = blocks[1]?.databaseId ?? null;

        return (
          firstViewId !== null &&
          secondViewId !== null &&
          firstDatabaseId !== null &&
          secondDatabaseId !== null &&
          firstViewId !== secondViewId &&
          firstDatabaseId === secondDatabaseId
        );
      },
      { timeout: 15000 }
    )
    .toBe(true);
}

function directChildPageItems(page: Page, parentViewId: string): Locator {
  return PageSelectors.itemByViewId(page, parentViewId).locator(itemDirectChildPageItems());
}

async function renamePageByName(page: Page, currentName: string, newName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, currentName);
  await expect(pageItem).toBeVisible({ timeout: 30000 });

  // On slow CI the rename-modal interaction is racy: the more-actions menu may
  // not open, the fill can land before the input is ready, or the save click
  // can be swallowed — leaving the page on its old name. Retry the whole
  // open → fill → save chain until the sidebar reflects the new name.
  for (let attempt = 0; attempt < 3; attempt++) {
    await pageItem.hover({ force: true });
    await page.waitForTimeout(500);
    await PageSelectors.moreActionsButton(page, currentName).click({ force: true });
    await expect(ViewActionSelectors.renameButton(page)).toBeVisible({ timeout: 10000 });
    await ViewActionSelectors.renameButton(page).click({ force: true });

    const renameInput = ModalSelectors.renameInput(page);
    await expect(renameInput).toBeVisible({ timeout: 10000 });
    await renameInput.clear();
    await renameInput.fill(newName);
    // Confirm the value actually landed before committing the rename.
    await expect(renameInput).toHaveValue(newName, { timeout: 5000 });
    await ModalSelectors.renameSaveButton(page).click({ force: true });

    if (
      await expect(PageSelectors.itemByName(page, newName))
        .toBeVisible({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }

    // Rename didn't take effect; dismiss any leftover modal and retry.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  // Surface a clear failure with the full timeout if every retry fell through.
  await expect(PageSelectors.itemByName(page, newName)).toBeVisible({ timeout: 30000 });
}

async function createStandaloneGridDatabase(page: Page, name: string): Promise<void> {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addGridButton(page).click({ force: true });
  await page.waitForTimeout(5000);

  await expandSpaceByName(page, spaceName);
  await renamePageByName(page, 'New Database', name);
  await page.waitForTimeout(2000);
}

async function hoverDatabaseBlock(page: Page, gridBlock: Locator): Promise<void> {
  await gridBlock.scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () => {
        const box = await gridBlock.boundingBox();

        if (!box) {
          return false;
        }

        await page.mouse.move(
          box.x + Math.min(Math.max(box.width / 2, 16), box.width - 1),
          box.y + Math.min(Math.max(box.height / 2, 16), box.height - 1)
        );
        await page.waitForTimeout(250);

        return (
          (await BlockSelectors.hoverControls(page)
            .isVisible()
            .catch(() => false)) &&
          (await BlockSelectors.addButton(page)
            .isVisible()
            .catch(() => false)) &&
          (await BlockSelectors.dragHandle(page)
            .isVisible()
            .catch(() => false))
        );
      },
      { timeout: 10000, message: 'Expected database block hover controls to become visible' }
    )
    .toBe(true);

  await expect(BlockSelectors.hoverControls(page)).toBeVisible({ timeout: 5000 });
  await expect(BlockSelectors.addButton(page)).toBeVisible({ timeout: 5000 });
  await expect(BlockSelectors.dragHandle(page)).toBeVisible({ timeout: 5000 });
}

async function duplicateDatabaseBlockAt(page: Page, editor: Locator, blockIndex: number): Promise<void> {
  const gridBlock = databaseBlocks(editor).nth(blockIndex);
  await expect(gridBlock).toBeVisible({ timeout: 15000 });
  await hoverDatabaseBlock(page, gridBlock);
  await BlockSelectors.dragHandle(page).click({ force: true });
  await expect(BlockSelectors.controlsMenu(page)).toBeVisible({ timeout: 5000 });
  await BlockSelectors.controlsMenuAction(page, 'duplicate').click({ force: true });
  await page.waitForTimeout(3000);
}

test.describe('Embedded Database Block Duplication', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('duplicates inline database blocks as deep copies with copy child pages', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);
    await expandSpaceByName(page, spaceName);

    const editor = editorForView(page, docViewId);
    await insertInlineGridViaSlash(page, docViewId);
    await ensurePageExpandedByViewId(page, docViewId);
    await expect(databaseBlocks(editor)).toHaveCount(1, { timeout: 30000 });

    await editFirstGridCell(page, databaseBlocks(editor).nth(0), 'inline original');
    await expect(await firstGridCellText(databaseBlocks(editor).nth(0))).toContain('inline original');

    await duplicateDatabaseBlockAt(page, editor, 0);
    await expect(databaseBlocks(editor)).toHaveCount(2, { timeout: 30000 });
    await waitForInlineDuplicateRewrite(page, docViewId);

    await ensurePageExpandedByViewId(page, docViewId);
    await expect(directChildPageItems(page, docViewId)).toHaveCount(2, { timeout: 30000 });
    await expect(
      directChildPageItems(page, docViewId)
        .locator('[data-testid="page-name"]')
        .filter({ hasText: 'New Database (Copy)' })
        .first()
    ).toBeVisible({ timeout: 30000 });

    await editFirstGridCell(page, databaseBlocks(editor).nth(1), 'inline dup edit');
    await expect(await firstGridCellText(databaseBlocks(editor).nth(0))).toContain('inline original');
  });

  test('duplicates linked database blocks as shared views of the same database', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    await createStandaloneGridDatabase(page, sourceDatabaseName);
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await editFirstGridCell(page, DatabaseGridSelectors.grid(page), 'linked shared');

    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);
    await expandSpaceByName(page, spaceName);

    const editor = editorForView(page, docViewId);
    await insertLinkedDatabaseViaSlash(page, docViewId, sourceDatabaseName);
    await expect(databaseBlocks(editor)).toHaveCount(1, { timeout: 30000 });

    await ensurePageExpandedByViewId(page, docViewId);
    await expect(directChildPageItems(page, docViewId)).toHaveCount(1, { timeout: 30000 });

    await duplicateDatabaseBlockAt(page, editor, 0);
    await expect(databaseBlocks(editor)).toHaveCount(2, { timeout: 30000 });
    await waitForLinkedDuplicateRewrite(page, docViewId);

    await ensurePageExpandedByViewId(page, docViewId);
    await expect(directChildPageItems(page, docViewId)).toHaveCount(2, { timeout: 30000 });

    await editFirstGridCell(page, databaseBlocks(editor).nth(1), 'linked duplicate edit');
    await expect(await firstGridCellText(databaseBlocks(editor).nth(0))).toContain('linked duplicate edit');
  });
});
