import { BrowserContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi, signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  databaseBlocks,
  editFirstGridCell,
  editorForView,
  insertInlineGridViaSlash,
} from '../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate, currentViewIdFromUrl } from '../../support/page-utils';
import { openRowDetail } from '../../support/row-detail-helpers';
import { DatabaseViewSelectors, ModalSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

const PASSWORD = 'AppFlowy123!';
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

type NestedDatabaseState = {
  email: string;
  workspaceId: string;
  rowPageViewId: string;
  rowPageUrl: string;
  nestedViewId: string;
  secondContext?: BrowserContext;
  secondPage?: Page;
  secondClientRowCountBeforeInsert?: number;
};

const stateByPage = new WeakMap<Page, NestedDatabaseState>();

After(async ({ page }) => {
  const state = stateByPage.get(page);

  await state?.secondContext?.close();
  stateByPage.delete(page);
});

Given('a nested inline database in a database row page is open', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const email = generateRandomEmail();

  await signUpAndLoginWithPasswordViaUi(page, request, email, PASSWORD);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  const documentViewId = await createDocumentPageAndNavigate(page);

  await insertInlineGridViaSlash(page, documentViewId);

  const parentGrid = databaseBlocks(editorForView(page, documentViewId)).first();

  await expect(parentGrid).toBeVisible({ timeout: 30000 });
  await expect(dataRows(parentGrid).first()).toBeVisible({ timeout: 30000 });

  await openRowDetail(page, 0);
  await RowDetailSelectors.modalTitle(page).locator('button').first().click({ force: true });

  await expect
    .poll(() => currentViewIdFromUrl(page), {
      timeout: 15000,
      message: 'Expected the database row to open as a full page',
    })
    .not.toBe(documentViewId);

  const rowPageEditor = page.locator('[id^="editor-"]').first();

  await expect(rowPageEditor).toBeVisible({ timeout: 15000 });

  const rowPageEditorId = await rowPageEditor.getAttribute('id');
  const rowPageViewId = rowPageEditorId?.replace('editor-', '');

  if (!rowPageViewId) {
    throw new Error(`Expected a mounted row document editor id, got ${String(rowPageEditorId)}`);
  }

  await insertInlineGridViaSlash(page, rowPageViewId);

  const nestedGrid = databaseBlocks(rowPageEditor).first();

  await expect(nestedGrid).toBeVisible({ timeout: 30000 });

  const nestedTab = nestedGrid.locator('[data-testid^="view-tab-"]').first();

  await expect(nestedTab).toBeVisible({ timeout: 15000 });

  const nestedTabTestId = await nestedTab.getAttribute('data-testid');
  const nestedViewId = nestedTabTestId?.replace('view-tab-', '');

  if (!nestedViewId) {
    throw new Error(`Expected a nested database view id, got ${String(nestedTabTestId)}`);
  }

  const rowPageUrl = page.url();

  stateByPage.set(page, {
    email,
    workspaceId: workspaceIdFromAppUrl(rowPageUrl),
    rowPageViewId,
    rowPageUrl,
    nestedViewId,
  });
});

Given('another web client opens the same database row page', async ({ page, browser }) => {
  const state = requireState(page);
  const origin = new URL(state.rowPageUrl).origin;
  const secondContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  });
  const secondPage = await secondContext.newPage();

  state.secondContext = secondContext;
  state.secondPage = secondPage;
  setupPageErrorHandling(secondPage);

  await signInWithPasswordViaUi(secondPage, state.email, PASSWORD, 1500);
  await secondPage.goto(state.rowPageUrl, { waitUntil: 'domcontentloaded' });
  await waitForNestedDatabase(secondPage, state);
  state.secondClientRowCountBeforeInsert = await dataRows(nestedGrid(secondPage, state)).count();
});

Then('the nested database title is {string}', async ({ page }, expectedTitle: string) => {
  const state = requireState(page);

  await expect(nestedGrid(page, state).getByTestId('embedded-database-title')).toHaveText(expectedTitle, {
    timeout: 15000,
  });
});

When('I add nested database row {string}', async ({ page }, rowName: string) => {
  const state = requireState(page);
  const grid = nestedGrid(page, state);
  const rows = dataRows(grid);
  const rowIdsBefore = new Set(await databaseRowIds(rows));
  const rowCountBefore = rowIdsBefore.size;

  await grid.getByTestId('grid-new-row').click({ force: true });
  await expect(rows).toHaveCount(rowCountBefore + 1, { timeout: 15000 });

  await expect
    .poll(
      async () => {
        const currentIds = await databaseRowIds(rows);

        return currentIds.find((rowId) => !rowIdsBefore.has(rowId)) ?? '';
      },
      {
        timeout: 15000,
        message: 'Expected the nested database to expose the newly created row',
      }
    )
    .not.toBe('');

  const newRowId = (await databaseRowIds(rows)).find((rowId) => !rowIdsBefore.has(rowId));

  if (!newRowId) {
    throw new Error('Expected to resolve the newly created nested database row id');
  }

  const newRow = grid.getByTestId(`grid-row-${newRowId}`);

  await editFirstGridCell(page, newRow, rowName);
  await expect(newRow).toContainText(rowName, { timeout: 15000 });
});

Then('nested database row {string} remains after reopening the row page', async ({ page }, rowName: string) => {
  const state = requireState(page);

  await reopenRowPage(page, state);
  await expect(dataRows(nestedGrid(page, state)).filter({ hasText: rowName })).toBeVisible({
    timeout: 30000,
  });
});

Then('the other web client shows nested database row {string}', async ({ page }, rowName: string) => {
  const state = requireState(page);
  const secondPage = requireSecondPage(state);

  await expect(dataRows(nestedGrid(secondPage, state)).filter({ hasText: rowName })).toBeVisible({
    timeout: 30000,
  });
});

Then("the other web client's nested database row count increases by 1", async ({ page }) => {
  const state = requireState(page);
  const secondPage = requireSecondPage(state);
  const rowCountBeforeInsert = state.secondClientRowCountBeforeInsert;

  if (rowCountBeforeInsert === undefined) {
    throw new Error('Expected the second web client row count baseline to be recorded');
  }

  await expect(dataRows(nestedGrid(secondPage, state))).toHaveCount(rowCountBeforeInsert + 1, {
    timeout: 30000,
  });
});

When('I add a {string} view to the nested database', async ({ page }, viewType: string) => {
  const state = requireState(page);
  const grid = nestedGrid(page, state);
  const tabs = grid.locator('[data-testid^="view-tab-"]');
  const tabIdsBefore = new Set(await databaseTabIds(tabs));
  const tabCountBefore = tabIdsBefore.size;
  const addButton = grid.getByTestId('add-view-button');

  await addButton.scrollIntoViewIfNeeded();
  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]');

  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu.locator('[role="menuitem"]').filter({ hasText: viewType }).first().click({ force: true });
  await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 15000 });

  await expect
    .poll(
      async () => {
        const currentIds = await databaseTabIds(tabs);

        return currentIds.find((viewId) => !tabIdsBefore.has(viewId)) ?? '';
      },
      {
        timeout: 15000,
        message: 'Expected the nested database to expose the newly created view',
      }
    )
    .not.toBe('');

  const nestedViewId = (await databaseTabIds(tabs)).find((viewId) => !tabIdsBefore.has(viewId));

  if (!nestedViewId) {
    throw new Error('Expected to resolve the newly created nested database view id');
  }

  state.nestedViewId = nestedViewId;
  await expect(grid.getByTestId(`view-tab-${nestedViewId}`)).toContainText(viewType, { timeout: 15000 });
  await page.waitForTimeout(1000);
});

When('I rename nested database tab {string} to {string}', async ({ page }, currentLabel: string, nextLabel: string) => {
  const state = requireState(page);
  const grid = nestedGrid(page, state);
  const tab = grid.getByTestId(`view-tab-${state.nestedViewId}`);
  const tabLabel = tab.locator('span').filter({ hasText: currentLabel });

  await expect(tabLabel).toBeVisible({ timeout: 10000 });

  await tabLabel.click({ button: 'right', force: true });
  await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible({ timeout: 10000 });
  await DatabaseViewSelectors.tabActionRename(page).click();
  await expect(ModalSelectors.renameInput(page)).toBeVisible({ timeout: 10000 });
  await ModalSelectors.renameInput(page).clear();
  await ModalSelectors.renameInput(page).fill(nextLabel);
  await expect(ModalSelectors.renameSaveButton(page)).toBeEnabled({ timeout: 10000 });

  const renameResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.endsWith(`/page-view/${state.nestedViewId}`),
    { timeout: 15000 }
  );

  await ModalSelectors.renameSaveButton(page).click();

  const renameResponse = await renameResponsePromise;

  expect(renameResponse.ok(), `Nested view rename failed with HTTP ${renameResponse.status()}`).toBeTruthy();
  await expect(tab).toContainText(nextLabel, { timeout: 15000 });
});

Then('the other web client shows nested database tab {string}', async ({ page }, expectedLabel: string) => {
  const state = requireState(page);
  const secondPage = requireSecondPage(state);

  await expect(nestedGrid(secondPage, state).getByTestId(`view-tab-${state.nestedViewId}`)).toContainText(
    expectedLabel,
    { timeout: 30000 }
  );
});

Then('nested database tab {string} remains after reopening the row page', async ({ page }, expectedLabel: string) => {
  const state = requireState(page);

  await reopenRowPage(page, state);
  await expect(nestedGrid(page, state).getByTestId(`view-tab-${state.nestedViewId}`)).toContainText(expectedLabel, {
    timeout: 30000,
  });
});

When('I paste the nested database view link into another document', async ({ page }) => {
  const state = requireState(page);

  await createDocumentPageAndNavigate(page);

  const slateEditor = page.locator('[data-slate-editor="true"]').first();
  const nestedViewUrl = `${new URL(state.rowPageUrl).origin}/app/${state.workspaceId}/${state.nestedViewId}`;

  await expect(slateEditor).toBeVisible({ timeout: 15000 });
  await slateEditor.click({ force: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (url) => navigator.clipboard.writeText(url), nestedViewUrl);
  await page.keyboard.press(`${modKey}+V`);
});

Then('the pasted page reference is labeled {string}', async ({ page }, expectedLabel: string) => {
  const state = requireState(page);
  const mention = page.locator(`.mention-inline[data-mention-id="${state.nestedViewId}"]`);

  await expect(mention).toBeVisible({ timeout: 15000 });
  await expect(mention.locator('.mention-content')).toHaveText(expectedLabel, { timeout: 15000 });
});

function requireState(page: Page): NestedDatabaseState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Nested database test state was not initialized');
  }

  return state;
}

function workspaceIdFromAppUrl(urlValue: string): string {
  const segments = new URL(urlValue).pathname.split('/').filter(Boolean);

  if (segments[0] !== 'app' || !segments[1]) {
    throw new Error(`Expected an AppFlowy application URL, got ${urlValue}`);
  }

  return segments[1];
}

function nestedGrid(page: Page, state: NestedDatabaseState): Locator {
  return databaseBlocks(editorForView(page, state.rowPageViewId)).first();
}

function requireSecondPage(state: NestedDatabaseState): Page {
  if (!state.secondPage) {
    throw new Error('Expected the second web client to be open');
  }

  return state.secondPage;
}

function dataRows(grid: Locator): Locator {
  return grid.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
}

async function databaseRowIds(rows: Locator): Promise<string[]> {
  return rows.evaluateAll((elements) =>
    elements.map((element) => (element.getAttribute('data-testid') ?? '').replace('grid-row-', ''))
  );
}

async function databaseTabIds(tabs: Locator): Promise<string[]> {
  return tabs.evaluateAll((elements) =>
    elements.map((element) => (element.getAttribute('data-testid') ?? '').replace('view-tab-', ''))
  );
}

async function waitForNestedDatabase(page: Page, state: NestedDatabaseState): Promise<void> {
  await expect(editorForView(page, state.rowPageViewId)).toBeVisible({ timeout: 30000 });
  await expect(nestedGrid(page, state)).toBeVisible({ timeout: 30000 });
  await expect(nestedGrid(page, state).getByTestId('embedded-database-title')).toBeVisible({ timeout: 30000 });
}

async function reopenRowPage(page: Page, state: NestedDatabaseState): Promise<void> {
  await page.goto(state.rowPageUrl, { waitUntil: 'domcontentloaded' });
  await waitForNestedDatabase(page, state);
}
