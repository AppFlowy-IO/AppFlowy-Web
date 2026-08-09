import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { createNamedGridPage, editFirstGridCell } from '../../support/duplicate-test-helpers';
import { DatabaseGridSelectors, DatabaseViewSelectors, RowControlsSelectors, TrashSelectors } from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';

// Reused steps defined elsewhere:
// - 'I am signed in with a new account' (favorite-page.steps.ts)
// - 'I switch the database to a new Grid view' (database-row-document.steps.ts)

const { Given, When, Then, Before } = createBdd();

type RowPageLifecycleState = {
  gridUrl?: string;
};

const stateByPage = new WeakMap<Page, RowPageLifecycleState>();

function getState(page: Page): RowPageLifecycleState {
  let state = stateByPage.get(page);

  if (!state) {
    state = {};
    stateByPage.set(page, state);
  }

  return state;
}

// A database with several views can keep more than one grid mounted, and the
// same row renders with the same grid-row-{rowId} testid in every grid. All
// row queries must therefore be scoped to the visible grid — page-global
// lookups can match a hidden duplicate from another view.
const gridScope = (page: Page) => DatabaseGridSelectors.grid(page).filter({ visible: true }).first();

const gridDataRows = (page: Page) =>
  gridScope(page).locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');

const gridRowByName = (page: Page, name: string) => gridDataRows(page).filter({ hasText: name });

const favoriteEntryByName = (page: Page, name: string) =>
  page.locator('[id^="favorite-view-"]').filter({ hasText: name });

const trashRowByName = (page: Page, name: string) =>
  TrashSelectors.rows(page).filter({ hasText: name });

async function openTrashPage(page: Page): Promise<void> {
  if (!/\/app\/trash/.test(page.url())) {
    await TrashSelectors.sidebarTrashButton(page).click();
    await expect(page).toHaveURL(/\/app\/trash/, { timeout: 15000 });
  }

  // The table renders only once the trash list request resolves; an empty
  // trash keeps the skeleton away but shows no table rows.
  await page.waitForTimeout(1500);
}

async function returnToGridPage(page: Page): Promise<void> {
  const { gridUrl } = getState(page);

  if (!gridUrl) {
    throw new Error('Grid URL was not captured; create the grid first');
  }

  await page.goto(gridUrl);
  await waitForGridReady(page);
}

/**
 * Hover a data row and click its hover-accessory button via JS dispatch.
 * The hover controls use onMouseMove on the row's parent and the accessory
 * button has pointer-events handling that swallows Playwright clicks, so this
 * mirrors the proven flow in e2e/database/row-operations.spec.ts.
 */
async function openRowMenuByTestId(page: Page, rowTestId: string): Promise<void> {
  await page.evaluate((testId) => {
    const isVisible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const row = Array.from(document.querySelectorAll(`[data-testid="${testId}"]`)).find(isVisible);

    if (row && row.parentElement) {
      row.parentElement.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      row.parentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
  }, rowTestId);
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const isVisible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const button = Array.from(document.querySelectorAll('[data-testid="row-accessory-button"]')).find(isVisible);

    if (button) {
      (button as HTMLElement).click();
    }
  });
  await page.waitForTimeout(1000);

  await expect(page.locator('[role="menu"], [data-slot="dropdown-menu-content"]').first()).toBeVisible({
    timeout: 5000,
  });
}

async function dataRowTestIdByName(page: Page, name: string): Promise<string> {
  const row = gridRowByName(page, name).first();

  await expect(row).toBeVisible({ timeout: 15000 });

  const testId = await row.getAttribute('data-testid');

  if (!testId) {
    throw new Error(`Row named "${name}" has no data-testid`);
  }

  return testId;
}

Before({ tags: '@row-page-lifecycle' }, async ({ page }) => {
  stateByPage.delete(page);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

Given('I have created a grid page named {string}', async ({ page }, name: string) => {
  await createNamedGridPage(page, name);

  const url = new URL(page.url());

  getState(page).gridUrl = `${url.origin}${url.pathname}`;
});

When('I set the first grid cell to {string}', async ({ page }, text: string) => {
  await editFirstGridCell(page, gridScope(page), text);
  // Allow the cell edit to sync before follow-up mutations depend on it.
  await page.waitForTimeout(1500);
});

When('I delete the grid row named {string}', async ({ page }, name: string) => {
  const rowTestId = await dataRowTestIdByName(page, name);

  await openRowMenuByTestId(page, rowTestId);
  await RowControlsSelectors.rowMenuDelete(page).click({ force: true });
  await page.waitForTimeout(500);

  const confirmButton = RowControlsSelectors.deleteRowConfirmButton(page);

  if ((await confirmButton.count()) > 0) {
    await confirmButton.click({ force: true });
  }

  // Wait for the tombstone/hard delete plus the async trash HTTP chain.
  await page.waitForTimeout(2500);
});

Then('the grid contains a row named {string}', async ({ page }, name: string) => {
  await expect(gridRowByName(page, name).first()).toBeVisible({ timeout: 15000 });
});

Then('the grid does not contain a row named {string}', async ({ page }, name: string) => {
  await expect(gridRowByName(page, name)).toHaveCount(0, { timeout: 15000 });
});

When('I switch to the database view at index {int}', async ({ page }, index: number) => {
  await DatabaseViewSelectors.viewTab(page).nth(index).click({ force: true });
  await waitForGridReady(page);
});

Then('the database view at index {int} contains a row named {string}', async ({ page }, index: number, name: string) => {
  await DatabaseViewSelectors.viewTab(page).nth(index).click({ force: true });
  await waitForGridReady(page);
  await expect(gridRowByName(page, name).first()).toBeVisible({ timeout: 15000 });
});

Then(
  'the database view at index {int} does not contain a row named {string}',
  async ({ page }, index: number, name: string) => {
    await DatabaseViewSelectors.viewTab(page).nth(index).click({ force: true });
    await waitForGridReady(page);
    await expect(gridRowByName(page, name)).toHaveCount(0, { timeout: 15000 });
  }
);

When('I open the grid row named {string} as a full row page', async ({ page }, name: string) => {
  const row = gridRowByName(page, name).first();

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(500);

  const expandButton = page.getByTestId('row-expand-button').filter({ visible: true }).first();

  await expect(expandButton).toBeVisible({ timeout: 5000 });
  await expandButton.click({ force: true });

  // The row opens in a modal first; the dialog-title expand button promotes it
  // to a full row page (?r= URL).
  await expect(page.locator('.MuiDialog-paper')).toBeVisible({ timeout: 10000 });
  await page.locator('.MuiDialogTitle-root').locator('button').first().click({ force: true });

  await expect(page).toHaveURL(/[?&]r=/, { timeout: 15000 });
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible({ timeout: 15000 });
});

When('I type {string} into the row document', async ({ page }, text: string) => {
  const editor = page.locator('[data-slate-editor="true"]').first();

  await editor.click({ force: true });
  await page.keyboard.type(text, { delay: 30 });
  await expect(editor).toContainText(text, { timeout: 10000 });
  // The document-empty row meta flushes on a debounce and then registers the
  // row-document view on the server; give it time before deleting/favoriting.
  await page.waitForTimeout(2500);
});

When('I favorite the current row page', async ({ page }) => {
  const button = page.getByTestId('favorite-button');

  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click({ force: true });
  // ensure-view + title push + favorite API round-trip + favorites reload.
  await page.waitForTimeout(2500);
});

When('I rename the current row page to {string}', async ({ page }, name: string) => {
  const titleInput = page.getByTestId('row-title-input').first();

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await titleInput.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(name);
  // Title sync to the row-document view name is debounced (500ms) and the
  // favorites list refreshes afterwards.
  await page.waitForTimeout(3000);
});

Then('the Favorites section contains an entry named {string}', async ({ page }, name: string) => {
  await expect(favoriteEntryByName(page, name).first()).toBeVisible({ timeout: 15000 });
});

Then('the Favorites section does not contain an entry named {string}', async ({ page }, name: string) => {
  await expect(favoriteEntryByName(page, name)).toHaveCount(0, { timeout: 15000 });
});

When('I open the Favorites entry named {string}', async ({ page }, name: string) => {
  await favoriteEntryByName(page, name).first().click({ force: true });
  // Row-page favorites resolve the container via the server before navigating.
  await page.waitForTimeout(2000);
});

Then('the current page is a full row page', async ({ page }) => {
  await expect(page).toHaveURL(/[?&]r=/, { timeout: 15000 });
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible({ timeout: 15000 });
});

When('I return to the grid page', async ({ page }) => {
  await returnToGridPage(page);
});

Then('the trash contains a row page named {string}', async ({ page }, name: string) => {
  await openTrashPage(page);
  await expect(trashRowByName(page, name).first()).toBeVisible({ timeout: 15000 });
});

Then('the trash does not contain a row page named {string}', async ({ page }, name: string) => {
  await openTrashPage(page);
  await expect(trashRowByName(page, name)).toHaveCount(0, { timeout: 15000 });
});

When('I restore the row page named {string} from trash', async ({ page }, name: string) => {
  await openTrashPage(page);

  const row = trashRowByName(page, name).first();

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByTestId('trash-restore-button').click({ force: true });
  // restore-from-trash API + database collab tombstone clear.
  await page.waitForTimeout(2500);
});

When('I permanently delete the row page named {string} from trash', async ({ page }, name: string) => {
  await openTrashPage(page);

  const row = trashRowByName(page, name).first();

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByTestId('trash-delete-button').click({ force: true });

  // NormalModal confirm: danger variant renders confirm-delete-button,
  // otherwise modal-ok-button.
  const confirm = page.locator('[data-testid="confirm-delete-button"], [data-testid="modal-ok-button"]').first();

  await expect(confirm).toBeVisible({ timeout: 10000 });
  await confirm.click({ force: true });
  await page.waitForTimeout(2500);
});
