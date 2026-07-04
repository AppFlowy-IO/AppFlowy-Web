import { expect, Locator, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import {
  databaseBlocks,
  editFirstGridCell,
  editorForView,
  firstGridCellText,
  insertInlineGridViaSlash,
} from '../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
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
  isDuplicatePlaceholder: boolean;
}

interface RowInlineGridState {
  documentViewId?: string;
  rowPageViewId?: string;
  originalBlock?: DatabaseBlockState;
  duplicatedBlock?: DatabaseBlockState;
  originalCellText?: string;
  originalEditedCellText?: string;
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
  initializeRowInlineGridState(page);

  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
    createWaitMs: 6000,
    verify: waitForGridReady,
  });
});

Given('a document is open for row-page inline grid duplication', async ({ page, request }) => {
  setupPageErrorHandling(page);
  const state = initializeRowInlineGridState(page);

  await signUpAndLoginWithPasswordViaUi(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(2000);

  state.documentViewId = await createDocumentPageAndNavigate(page);
});

When('I create a parent inline grid in the document', async ({ page }) => {
  const docViewId = getDocumentViewId(page);

  await insertInlineGridViaSlash(page, docViewId);

  // Inserting an inline grid opens the new database in a ViewModal. Close it so the
  // row-open step targets the document's inline grid rather than a row hidden behind
  // the modal backdrop (page-level `grid-row-*` would otherwise match both).
  await closeOpenDialogs(page);

  const editor = editorForView(page, docViewId);

  await expect(databaseBlocks(editor)).toHaveCount(1, { timeout: 30000 });
  // The inline grid's first row must be hydrated before `openRowDetail` can hover it.
  // Scope to the document's grid block (page-level would also match a modal grid).
  await expect(databaseBlocks(editor).first().locator('[data-testid^="grid-row-"]').first()).toBeVisible({
    timeout: 30000,
  });
});

When('I open the first row as a full row page', async ({ page }) => {
  await openFirstRowAsFullRowPage(page);
});

When('I open the first parent grid row as a full row page', async ({ page }) => {
  await openFirstRowAsFullRowPage(page);
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
  const state = getRowInlineGridState(page);
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);
  const originalDatabaseId = state.originalBlock?.databaseId;

  if (!originalDatabaseId) {
    throw new Error('Expected original inline grid database id before duplication');
  }

  await Promise.all([
    delayNextDatabaseBlobDiffRequest(page, 1500, [originalDatabaseId]),
    delayNextPageDuplicateRequest(page, 3000),
  ]);

  await duplicateDatabaseBlockAt(page, editor, 0, { waitAfterMs: 0 });
  await expect(databaseBlocks(editor)).toHaveCount(2, { timeout: 30000 });
});

Then('the duplicated inline grid shows a loading placeholder', async ({ page }) => {
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);

  await expect(databaseBlocks(editor).nth(1).getByTestId('database-duplicate-placeholder')).toBeVisible({
    timeout: 5000,
  });
  await expectDuplicatedInlineGridLoadingPlaceholder(page, rowPageViewId);
});

Then('the duplicated inline grid has fresh view and database ids', async ({ page }) => {
  const state = getRowInlineGridState(page);
  const rowPageViewId = getRowPageViewId(page);

  state.duplicatedBlock = await waitForDuplicatedInlineGridFreshIds(page, rowPageViewId);
  expectDuplicatedBlockHasFreshIds(state);
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
  const originalCellText = state.originalCellText ?? 'row-page-original';
  const duplicateCellText = state.duplicateCellText ?? 'row-page-duplicate';

  expectDuplicatedBlockHasFreshIds(state);

  await expect
    .poll(async () => firstGridCellText(databaseBlocks(editor).first()), {
      timeout: 15000,
      message: 'Expected editing the duplicated inline grid not to modify the original inline grid',
    })
    .toContain(originalCellText);
  expect(await firstGridCellText(databaseBlocks(editor).first())).not.toContain(duplicateCellText);

  await expect
    .poll(async () => firstGridCellText(databaseBlocks(editor).nth(1)), {
      timeout: 15000,
      message: 'Expected editing the duplicated inline grid to update the duplicated inline grid',
    })
    .toContain(duplicateCellText);
});

When('I edit the original inline grid', async ({ page }) => {
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);
  const originalEditedCellText = getRowInlineGridState(page).originalEditedCellText ?? 'row-page-original-edited';

  await editFirstGridCell(page, databaseBlocks(editor).first(), originalEditedCellText);
});

Then('the duplicated row-page inline grid remains unchanged', async ({ page }) => {
  const state = getRowInlineGridState(page);
  const rowPageViewId = getRowPageViewId(page);
  const editor = editorForView(page, rowPageViewId);
  const duplicateCellText = state.duplicateCellText ?? 'row-page-duplicate';
  const originalEditedCellText = state.originalEditedCellText ?? 'row-page-original-edited';

  expectDuplicatedBlockHasFreshIds(state);

  await expect
    .poll(async () => firstGridCellText(databaseBlocks(editor).first()), {
      timeout: 15000,
      message: 'Expected editing the original inline grid to update the original inline grid',
    })
    .toContain(originalEditedCellText);

  await expect
    .poll(async () => firstGridCellText(databaseBlocks(editor).nth(1)), {
      timeout: 15000,
      message: 'Expected editing the original inline grid not to modify the duplicated inline grid',
    })
    .toContain(duplicateCellText);
  expect(await firstGridCellText(databaseBlocks(editor).nth(1))).not.toContain(originalEditedCellText);
});

async function addNewCard(page: Page, cardName: string) {
  const todoColumn = BoardSelectors.boardContainer(page).locator('[data-column-id]').filter({ hasText: 'To Do' });

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

function initializeRowInlineGridState(page: Page): RowInlineGridState {
  const state: RowInlineGridState = {
    originalCellText: `row-page-original-${uuidv4().slice(0, 6)}`,
    originalEditedCellText: `row-page-original-edited-${uuidv4().slice(0, 6)}`,
    duplicateCellText: `row-page-duplicate-${uuidv4().slice(0, 6)}`,
  };

  rowInlineGridStateByPage.set(page, state);
  return state;
}

function getRowInlineGridState(page: Page): RowInlineGridState {
  const state = rowInlineGridStateByPage.get(page);

  if (!state) {
    throw new Error('No row inline grid duplication state is available for this scenario');
  }

  return state;
}

function getDocumentViewId(page: Page): string {
  const documentViewId = getRowInlineGridState(page).documentViewId;

  if (!documentViewId) {
    throw new Error('No document view id is available for this scenario');
  }

  return documentViewId;
}

async function openFirstRowAsFullRowPage(page: Page): Promise<void> {
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
}

function getRowPageViewId(page: Page): string {
  const rowPageViewId = getRowInlineGridState(page).rowPageViewId;

  if (!rowPageViewId) {
    throw new Error('No row page view id is available for this scenario');
  }

  return rowPageViewId;
}

async function closeOpenDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5 && (await page.locator('[role="dialog"]').count()) > 0; attempt++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10000 });
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
              is_database_duplicate_placeholder?: boolean;
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
        viewIds: Array.isArray(node.data?.view_ids) ? node.data.view_ids : node.data?.view_id ? [node.data.view_id] : [],
        databaseId: node.data?.database_id ?? null,
        isDuplicatePlaceholder: node.data?.is_database_duplicate_placeholder === true,
      }));
  }, rowPageViewId);
}

async function waitForDuplicatedInlineGridFreshIds(page: Page, rowPageViewId: string): Promise<DatabaseBlockState> {
  await expect
    .poll(
      async () => {
        const blocks = await getDatabaseBlockStates(page, rowPageViewId);
        const original = blocks[0];
        const duplicated = blocks[1];

        return Boolean(
          original?.viewIds[0] &&
            original?.databaseId &&
            duplicated?.viewIds[0] &&
            duplicated?.databaseId &&
            duplicated.parentId === rowPageViewId &&
            !duplicated.isDuplicatePlaceholder &&
            duplicated.viewIds[0] !== original.viewIds[0] &&
            duplicated.databaseId !== original.databaseId
        );
      },
      {
        timeout: 30000,
        message: 'Expected duplicated row-page inline grid placeholder to be replaced with fresh view/database ids',
      }
    )
    .toBe(true);

  return expectDuplicatedInlineGridHasFreshIds(page, rowPageViewId);
}

function expectDuplicatedBlockHasFreshIds(state: RowInlineGridState): void {
  expect(state.duplicatedBlock?.viewIds[0]).toBeTruthy();
  expect(state.duplicatedBlock?.databaseId).toBeTruthy();
  expect(state.duplicatedBlock?.viewIds[0]).not.toBe(state.originalBlock?.viewIds[0]);
  expect(state.duplicatedBlock?.databaseId).not.toBe(state.originalBlock?.databaseId);
}

async function expectDuplicatedInlineGridHasFreshIds(page: Page, rowPageViewId: string): Promise<DatabaseBlockState> {
  const blocks = await getDatabaseBlockStates(page, rowPageViewId);
  const original = blocks[0];
  const duplicated = blocks[1];

  expect(original?.viewIds[0]).toBeTruthy();
  expect(original?.databaseId).toBeTruthy();
  expect(duplicated?.parentId).toBe(rowPageViewId);
  expect(duplicated?.isDuplicatePlaceholder).toBe(false);
  expect(duplicated?.viewIds[0]).toBeTruthy();
  expect(duplicated?.databaseId).toBeTruthy();
  expect(duplicated?.viewIds[0]).not.toBe(original?.viewIds[0]);
  expect(duplicated?.databaseId).not.toBe(original?.databaseId);

  return duplicated as DatabaseBlockState;
}

async function expectDuplicatedInlineGridLoadingPlaceholder(page: Page, rowPageViewId: string): Promise<void> {
  const blocks = await getDatabaseBlockStates(page, rowPageViewId);
  const original = blocks[0];
  const duplicated = blocks[1];

  expect(original?.viewIds[0]).toBeTruthy();
  expect(original?.databaseId).toBeTruthy();
  expect(duplicated?.parentId).toBe(rowPageViewId);
  expect(duplicated?.isDuplicatePlaceholder).toBe(true);
  expect(duplicated?.viewIds).toEqual([]);
  expect(duplicated?.databaseId).toBeNull();
}

async function delayNextPageDuplicateRequest(page: Page, delayMs: number): Promise<void> {
  await page.route(
    /\/api\/workspace\/[^/]+\/page-view\/[^/]+\/duplicate(?:\?|$)/,
    async (route) => {
      await page.waitForTimeout(delayMs);
      await route.continue();
    },
    { times: 1 }
  );
}

async function delayNextDatabaseBlobDiffRequest(
  page: Page,
  delayMs: number,
  excludedDatabaseIds: string[] = []
): Promise<void> {
  const excludedDatabaseIdSet = new Set(excludedDatabaseIds);
  const routePattern = /\/api\/workspace\/[^/]+\/database\/[^/]+\/blob\/diff(?:\?|$)/;
  let handledDuplicatedRequest = false;
  const getDatabaseIdFromBlobDiffUrl = (url: string): string | undefined => {
    return url.match(/\/api\/workspace\/[^/]+\/database\/([^/]+)\/blob\/diff(?:\?|$)/)?.[1];
  };
  const handler = async (route: Route) => {
    const databaseId = getDatabaseIdFromBlobDiffUrl(route.request().url());

    if (databaseId && excludedDatabaseIdSet.has(databaseId)) {
      await route.continue();
      return;
    }

    if (handledDuplicatedRequest) {
      await route.continue();
      return;
    }

    handledDuplicatedRequest = true;
    await page.waitForTimeout(delayMs);
    await route.continue();
    void page.unroute(routePattern, handler).catch(() => undefined);
  };

  await page.route(routePattern, handler);
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

async function duplicateDatabaseBlockAt(
  page: Page,
  editor: Locator,
  blockIndex: number,
  options: { waitAfterMs?: number } = {}
): Promise<void> {
  const gridBlock = databaseBlocks(editor).nth(blockIndex);

  await expect(gridBlock).toBeVisible({ timeout: 15000 });
  await hoverDatabaseBlock(page, gridBlock);
  await BlockSelectors.dragHandle(page).click({ force: true });
  await expect(BlockSelectors.controlsMenu(page)).toBeVisible({ timeout: 5000 });
  await BlockSelectors.controlsMenuAction(page, 'duplicate').click({ force: true });

  if (options.waitAfterMs !== 0) {
    await page.waitForTimeout(options.waitAfterMs ?? 3000);
  }
}
