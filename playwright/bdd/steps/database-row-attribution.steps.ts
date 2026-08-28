import { BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { editFirstGridCell } from '../../support/duplicate-test-helpers';
import { addFieldWithType } from '../../support/field-type-helpers';
import { createNamedGridDatabase, getCurrentDatabaseInfo } from '../../support/relation-test-helpers';
import {
  DatabaseGridSelectors,
  FieldType,
  HeaderSelectors,
  ModalSelectors,
  ViewActionSelectors,
  WorkspaceSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const NATHAN_EMAIL = process.env.NATHAN_EMAIL || 'nathan@appflowy.io';
const NATHAN_PASSWORD = process.env.NATHAN_PASSWORD || process.env.SEEDED_USER_PASSWORD || 'AppFlowy!@123';
const EVA_EMAIL = process.env.EVA_EMAIL || 'eva@appflowy.io';
const EVA_PASSWORD = process.env.EVA_PASSWORD || 'AppFlowy!@123';

type AttributionScenarioState = {
  databaseName?: string;
  databaseUrl?: string;
  workspaceName?: string;
  rowId?: string;
  createdByFieldId?: string;
  lastEditedByFieldId?: string;
  evaContext?: BrowserContext;
  evaPage?: Page;
};

const stateByPage = new WeakMap<Page, AttributionScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {});
});

After(async ({ page }) => {
  const state = stateByPage.get(page);

  await state?.evaContext?.close().catch(() => undefined);

  if (state?.databaseUrl && state.databaseName) {
    await page.goto(state.databaseUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await deleteCurrentDatabase(page, state.databaseName).catch(() => undefined);
  }

  stateByPage.delete(page);
});

Given('Nathan creates a renamed database row with attribution fields', async ({ page }) => {
  const state = getState(page);
  const databaseName = `Row attribution ${Date.now().toString(36)}`;

  await signInWithPasswordViaUi(page, NATHAN_EMAIL, NATHAN_PASSWORD, 2000);
  state.workspaceName = await switchWorkspaceMatching(page, /nathan.*workspace/i);
  await createNamedGridDatabase(page, databaseName, []);
  // Register cleanup as soon as the database exists so a later setup failure
  // (for example while adding a field) cannot leave test data behind.
  state.databaseName = databaseName;
  state.databaseUrl = page.url();

  const createdByFieldId = await addFieldWithType(page, FieldType.CreatedBy);
  const lastEditedByFieldId = await addFieldWithType(page, FieldType.LastEditedBy);
  const rowsBefore = new Set((await getCurrentDatabaseInfo(page)).rowIds);

  await DatabaseGridSelectors.newRowButton(page).click({ force: true });

  let rowId = '';

  await expect
    .poll(
      async () => {
        const info = await getCurrentDatabaseInfo(page);

        rowId = info.rowIds.find((id) => !rowsBefore.has(id)) || '';
        return rowId;
      },
      { timeout: 30000, message: "Waiting for Nathan's newly created row" }
    )
    .not.toBe('');

  const row = DatabaseGridSelectors.rowById(page, rowId);

  await expect(row).toBeVisible({ timeout: 30000 });
  await editFirstGridCell(page, row, 'Created and edited by Nathan');

  state.rowId = rowId;
  state.createdByFieldId = createdByFieldId;
  state.lastEditedByFieldId = lastEditedByFieldId;

  await expect(attributionCell(page, rowId, createdByFieldId)).toContainText(/nathan/i, { timeout: 30000 });
  await expect(attributionCell(page, rowId, lastEditedByFieldId)).toContainText(/nathan/i, { timeout: 30000 });
});

When("Eva edits Nathan's database row", async ({ page, browser }) => {
  const state = requireCompleteState(page);
  const baseURL = new URL(state.databaseUrl).origin;
  const evaContext = await browser.newContext({ baseURL });
  const evaPage = await evaContext.newPage();

  setupPageErrorHandling(evaPage);
  state.evaContext = evaContext;
  state.evaPage = evaPage;

  await signInWithPasswordViaUi(evaPage, EVA_EMAIL, EVA_PASSWORD, 2000);
  await switchWorkspace(evaPage, state.workspaceName);
  await evaPage.goto(state.databaseUrl, { waitUntil: 'domcontentloaded' });
  await waitForGridReady(evaPage);

  const row = DatabaseGridSelectors.rowById(evaPage, state.rowId);

  await expect(row).toBeVisible({ timeout: 30000 });
  await editFirstGridCell(evaPage, row, 'Edited by Eva');
  await expect(row).toContainText('Edited by Eva', { timeout: 30000 });
  await expect(DatabaseGridSelectors.rowById(page, state.rowId)).toContainText('Edited by Eva', { timeout: 30000 });
});

Then('the row shows Nathan as its creator and Eva as its last editor', async ({ page }) => {
  const state = requireCompleteState(page);
  const pages = [page, state.evaPage].filter((candidate): candidate is Page => Boolean(candidate));

  for (const currentPage of pages) {
    await expect(attributionCell(currentPage, state.rowId, state.createdByFieldId)).toContainText(/nathan/i, {
      timeout: 30000,
    });
    await expect(attributionCell(currentPage, state.rowId, state.lastEditedByFieldId)).toContainText(/eva/i, {
      timeout: 30000,
    });
  }
});

function attributionCell(page: Page, rowId: string, fieldId: string) {
  return page.getByTestId(`attribution-cell-${rowId}-${fieldId}`);
}

function getState(page: Page): AttributionScenarioState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Database row attribution scenario state was not initialized');
  return state;
}

function requireCompleteState(page: Page) {
  const state = getState(page);

  if (
    !state.databaseUrl ||
    !state.workspaceName ||
    !state.rowId ||
    !state.createdByFieldId ||
    !state.lastEditedByFieldId
  ) {
    throw new Error('Nathan must create the attributed database row before Eva edits it');
  }

  return state as Required<
    Pick<
      AttributionScenarioState,
      'databaseUrl' | 'workspaceName' | 'rowId' | 'createdByFieldId' | 'lastEditedByFieldId'
    >
  > &
    AttributionScenarioState;
}

async function switchWorkspace(page: Page, workspaceName: string): Promise<void> {
  const currentWorkspaceName = page.getByTestId('current-workspace-name');

  if ((await currentWorkspaceName.textContent())?.trim() === workspaceName) return;

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  await WorkspaceSelectors.item(page).filter({ hasText: workspaceName }).first().click();
  await expect(currentWorkspaceName).toHaveText(workspaceName, { timeout: 30000 });
}

async function switchWorkspaceMatching(page: Page, workspaceName: RegExp): Promise<string> {
  const currentWorkspaceName = page.getByTestId('current-workspace-name');
  const currentName = (await currentWorkspaceName.textContent())?.trim();

  if (currentName && workspaceName.test(currentName)) return currentName;

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  const workspace = WorkspaceSelectors.item(page).filter({ hasText: workspaceName }).first();

  await workspace.click();
  await expect(currentWorkspaceName).toHaveText(workspaceName, { timeout: 30000 });
  return (await currentWorkspaceName.textContent())?.trim() || 'Nathan workspace';
}

async function deleteCurrentDatabase(page: Page, databaseName: string): Promise<void> {
  await expect(HeaderSelectors.moreActionsButton(page)).toBeVisible({ timeout: 30000 });
  await HeaderSelectors.moreActionsButton(page).click({ force: true });
  await expect(ViewActionSelectors.deleteButton(page)).toBeVisible({ timeout: 10000 });
  await ViewActionSelectors.deleteButton(page).click({ force: true });

  const confirmButton = ModalSelectors.confirmDeleteButton(page);

  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click({ force: true });
  }

  await expect(page.getByTestId('page-title-input').filter({ hasText: databaseName })).toHaveCount(0, {
    timeout: 30000,
  });
}
