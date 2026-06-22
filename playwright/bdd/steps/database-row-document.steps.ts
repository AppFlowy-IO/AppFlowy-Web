import { expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import {
  databaseBlocks,
  editFirstGridCell,
  editorForView,
  firstGridCellText,
  insertInlineGridViaSlash,
} from '../../support/duplicate-test-helpers';
import { closeRowDetailWithEscape, openRowDetail } from '../../support/row-detail-helpers';
import {
  BlockSelectors,
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const cardNamesByPage = new WeakMap<Page, string>();
const rowInlineGridStateByPage = new WeakMap<Page, RowInlineGridState>();

interface DatabaseBlockState {
  blockId?: string;
  parentId: string | null;
  viewIds: string[];
  databaseId: string | null;
}

interface RowInlineGridState {
  rowPageViewId?: string;
  originalBlock?: DatabaseBlockState;
  duplicatedBlock?: DatabaseBlockState;
  originalCellText?: string;
  duplicateCellText?: string;
}

Given('a board database with a card is open', async ({ page, request }) => {
  const currentCardName = `ImageLink-${uuidv4().slice(0, 6)}`;

  cardNamesByPage.set(page, currentCardName);

  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Board', {
    createWaitMs: 7000,
    verify: async (p) => {
      await expect(BoardSelectors.boardContainer(p)).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.cards(p).first()).toBeVisible({ timeout: 15000 });
    },
  });

  await addNewCard(page, currentCardName);
  await expect(cardByName(page, currentCardName)).toBeVisible({ timeout: 15000 });
});

When('I add image link {string} to the card row page', async ({ page }, imageUrl: string) => {
  const currentCardName = getCurrentCardName(page);

  await cardByName(page, currentCardName).click({ force: true });
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15000 });

  await focusRowDocumentEditor(page);
  await page.keyboard.type('/image', { delay: 30 });

  const imageCommand = page.getByTestId('slash-menu-image');

  await expect(imageCommand).toBeVisible({ timeout: 10000 });
  await imageCommand.click({ force: true });

  const popover = page.locator('.MuiPopover-root:visible').last();

  await expect(popover).toBeVisible({ timeout: 10000 });
  await popover.getByText('Embed link', { exact: true }).click({ force: true });

  const input = popover.getByPlaceholder('Paste or type an image link');

  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(imageUrl);
  await input.press('Enter');
  await expect(popover).toBeHidden({ timeout: 10000 });
});

When('I close the card row page', async ({ page }) => {
  await closeRowDetailWithEscape(page);
  await page.waitForTimeout(2000);
});

When('I switch the database to a new Grid view', async ({ page }) => {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });
  await DatabaseViewSelectors.viewTypeOption(page, 'Grid').click({ force: true });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toBeVisible({ timeout: 15000 });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveAttribute('data-state', 'active', {
    timeout: 15000,
  });
  await waitForGridReady(page);
});

Then('the card primary cell shows a row document icon', async ({ page }) => {
  const currentCardName = getCurrentCardName(page);

  await expect(cardByName(page, currentCardName).locator('.custom-icon')).toBeVisible({ timeout: 15000 });
});

Then('the grid primary cell shows a row document icon', async ({ page }) => {
  const currentCardName = getCurrentCardName(page);
  const row = DatabaseGridSelectors.dataRows(page).filter({ hasText: currentCardName }).first();

  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.locator('.custom-icon')).toBeVisible({ timeout: 15000 });
});

Given('a grid database is open for row-page inline grid duplication', async ({ page, request }) => {
  setupPageErrorHandling(page);
  rowInlineGridStateByPage.set(page, {
    originalCellText: `row-page-original-${uuidv4().slice(0, 6)}`,
    duplicateCellText: `row-page-duplicate-${uuidv4().slice(0, 6)}`,
  });

  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
    createWaitMs: 6000,
    verify: waitForGridReady,
  });
});

When('I open the first row as a full row page', async ({ page }) => {
  await openRowDetail(page, 0);
  await page.locator('.MuiDialogTitle-root').locator('button').first().click({ force: true });
  await page.waitForTimeout(2000);

  const editor = page.locator('[id^="editor-"]').first();

  await expect(editor).toBeVisible({ timeout: 15000 });
  const editorId = await editor.getAttribute('id');
  const rowPageViewId = editorId?.replace('editor-', '');

  if (!rowPageViewId) {
    throw new Error(`Expected mounted row document editor id, got ${String(editorId)}`);
  }

  getRowInlineGridState(page).rowPageViewId = rowPageViewId;
});

When('I create an inline grid in the row page', async ({ page }) => {
  const state = getRowInlineGridState(page);
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);

  await insertInlineGridViaSlash(page, rowPageViewId);
  await expect(databaseBlocks(editor)).toHaveCount(1, { timeout: 30000 });

  const originalGrid = databaseBlocks(editor).first();
  const originalCellText = state.originalCellText ?? 'row-page-original';

  await editFirstGridCell(page, originalGrid, originalCellText);
  state.originalBlock = (await getDatabaseBlockStates(page, rowPageViewId))[0];

  expect(state.originalBlock?.viewIds[0]).toBeTruthy();
  expect(state.originalBlock?.databaseId).toBeTruthy();
});

When('I duplicate the inline grid block in the row page', async ({ page }) => {
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);

  await duplicateDatabaseBlockAt(page, editor, 0);
  await expect(databaseBlocks(editor)).toHaveCount(2, { timeout: 30000 });
  getRowInlineGridState(page).duplicatedBlock = await waitForInlineGridDuplicateRewrite(page, rowPageViewId);
});

When('I edit the duplicated inline grid', async ({ page }) => {
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);
  const duplicateCellText = getRowInlineGridState(page).duplicateCellText ?? 'row-page-duplicate';

  await editFirstGridCell(page, databaseBlocks(editor).nth(1), duplicateCellText);
});

Then('the original row-page inline grid remains unchanged', async ({ page }) => {
  const state = getRowInlineGridState(page);
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);

  expect(state.duplicatedBlock?.viewIds[0]).toBeTruthy();
  expect(state.duplicatedBlock?.databaseId).toBeTruthy();
  expect(state.duplicatedBlock?.viewIds[0]).not.toBe(state.originalBlock?.viewIds[0]);
  expect(state.duplicatedBlock?.databaseId).not.toBe(state.originalBlock?.databaseId);

  await expect
    .poll(async () => firstGridCellText(databaseBlocks(editor).first()), {
      timeout: 15000,
      message: 'Expected editing the duplicated inline grid not to modify the original inline grid',
    })
    .toContain(state.originalCellText ?? 'row-page-original');
  expect(await firstGridCellText(databaseBlocks(editor).first())).not.toContain(
    state.duplicateCellText ?? 'row-page-duplicate'
  );
});

async function addNewCard(page: Page, cardName: string) {
  const todoColumn = BoardSelectors.boardContainer(page)
    .locator('[data-column-id]')
    .filter({ hasText: 'To Do' });

  await todoColumn.getByText('New').click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.type(cardName, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
}

async function focusRowDocumentEditor(page: Page) {
  const dialog = page.locator('[role="dialog"]');
  const scrollContainer = dialog.locator('.appflowy-scroll-container');

  if ((await scrollContainer.count()) > 0) {
    await scrollContainer.evaluate((el) => el.scrollTo(0, 9999));
    await page.waitForTimeout(500);
  }

  const editor = dialog.locator('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]').first();

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
}

function cardByName(page: Page, cardName: string) {
  return BoardSelectors.boardContainer(page).locator('.board-card').filter({ hasText: cardName }).first();
}

function getCurrentCardName(page: Page) {
  const cardName = cardNamesByPage.get(page);

  if (!cardName) {
    throw new Error('No current card name is available for this scenario');
  }

  return cardName;
}

function getRowInlineGridState(page: Page): RowInlineGridState {
  const state = rowInlineGridStateByPage.get(page);

  if (!state) {
    throw new Error('No row inline grid duplication state is available for this scenario');
  }

  return state;
}

function getRowPageViewId(page: Page): string {
  const rowPageViewId = getRowInlineGridState(page).rowPageViewId;

  if (!rowPageViewId) {
    throw new Error('No row page view id is available for this scenario');
  }

  return rowPageViewId;
}

async function getDatabaseBlockStates(page: Page, rowPageViewId: string): Promise<DatabaseBlockState[]> {
  return page.evaluate((currentRowPageViewId) => {
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
    const editor = testWindow.__TEST_EDITORS__?.[currentRowPageViewId];
    const children = editor?.children ?? [];

    return children
      .filter((node) => node?.type === 'grid')
      .map((node) => ({
        blockId: node.blockId,
        parentId: node.data?.parent_id ?? null,
        viewIds: Array.isArray(node.data?.view_ids)
          ? node.data.view_ids
          : node.data?.view_id
            ? [node.data.view_id]
            : [],
        databaseId: node.data?.database_id ?? null,
      }));
  }, rowPageViewId);
}

async function waitForInlineGridDuplicateRewrite(page: Page, rowPageViewId: string): Promise<DatabaseBlockState> {
  await expect
    .poll(
      async () => {
        const blocks = await getDatabaseBlockStates(page, rowPageViewId);
        const original = blocks[0];
        const duplicated = blocks[1];

        return Boolean(
          original?.viewIds[0] &&
            duplicated?.viewIds[0] &&
            original?.databaseId &&
            duplicated?.databaseId &&
            original.parentId === rowPageViewId &&
            duplicated.parentId === rowPageViewId &&
            original.viewIds[0] !== duplicated.viewIds[0] &&
            original.databaseId !== duplicated.databaseId
        );
      },
      {
        timeout: 30000,
        message: 'Expected duplicated row-page inline grid block to be rewritten to fresh view/database ids',
      }
    )
    .toBe(true);

  return (await getDatabaseBlockStates(page, rowPageViewId))[1];
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
          (await BlockSelectors.dragHandle(page)
            .isVisible()
            .catch(() => false))
        );
      },
      { timeout: 10000, message: 'Expected database block hover controls to become visible' }
    )
    .toBe(true);
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
