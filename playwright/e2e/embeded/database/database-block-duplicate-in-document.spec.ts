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
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
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
import { getSlashMenuItemName } from '../../../support/i18n-constants';

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
  return PageSelectors.itemByViewId(page, parentViewId).locator(':scope > div:nth-child(2) > [data-testid="page-item"]');
}

async function closeViewModal(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]');
  const isVisible = await dialog.isVisible().catch(() => false);
  if (!isVisible) {
    return;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

async function renamePageByName(page: Page, currentName: string, newName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, currentName);
  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.hover({ force: true });
  await page.waitForTimeout(500);
  await PageSelectors.moreActionsButton(page, currentName).click({ force: true });
  await expect(ViewActionSelectors.renameButton(page)).toBeVisible({ timeout: 10000 });
  await ViewActionSelectors.renameButton(page).click({ force: true });
  await expect(ModalSelectors.renameInput(page)).toBeVisible({ timeout: 10000 });
  await ModalSelectors.renameInput(page).clear();
  await ModalSelectors.renameInput(page).fill(newName);
  await ModalSelectors.renameSaveButton(page).click({ force: true });
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

async function insertInlineGridViaSlash(page: Page, docViewId: string): Promise<void> {
  const editor = editorForView(page, docViewId);
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await editor.pressSequentially('/', { delay: 50 });
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10000 });
  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });
  await closeViewModal(page);
  await expect(databaseBlocks(editor).first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function focusAndReplaceCellText(page: Page, gridBlock: Locator, text: string): Promise<void> {
  const firstCell = gridBlock.locator('[data-testid^="grid-cell-"]').first();
  await expect(firstCell).toBeVisible({ timeout: 15000 });
  await firstCell.click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
}

async function firstCellText(gridBlock: Locator): Promise<string> {
  return (await gridBlock.locator('[data-testid^="grid-cell-"]').first().innerText()).trim();
}

async function hoverDatabaseBlock(page: Page, gridBlock: Locator): Promise<void> {
  await gridBlock.scrollIntoViewIfNeeded();
  const box = await gridBlock.boundingBox();

  if (!box) {
    throw new Error('Failed to determine grid block position');
  }

  await gridBlock.hover({ position: { x: 6, y: 6 }, force: true });
  await page.waitForTimeout(400);
  await page.mouse.move(box.x + 6, box.y + 6);
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

    await focusAndReplaceCellText(page, databaseBlocks(editor).nth(0), 'inline original');
    await expect(await firstCellText(databaseBlocks(editor).nth(0))).toContain('inline original');

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

    await focusAndReplaceCellText(page, databaseBlocks(editor).nth(1), 'inline dup edit');
    await expect(await firstCellText(databaseBlocks(editor).nth(0))).toContain('inline original');
  });

  test('duplicates linked database blocks as shared views of the same database', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    await createStandaloneGridDatabase(page, sourceDatabaseName);
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await focusAndReplaceCellText(page, DatabaseGridSelectors.grid(page), 'linked shared');

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

    await focusAndReplaceCellText(page, databaseBlocks(editor).nth(1), 'linked duplicate edit');
    await expect(await firstCellText(databaseBlocks(editor).nth(0))).toContain('linked duplicate edit');
  });
});
