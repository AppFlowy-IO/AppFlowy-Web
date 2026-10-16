import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { editFirstGridCell, renameCurrentPage } from '../../support/duplicate-test-helpers';
import { BreadcrumbSelectors, DatabaseGridSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

type RowSubpageState = {
  gridUrl: string;
  subpageId: string;
};

const stateByPage = new WeakMap<Page, RowSubpageState>();

function requireState(page: Page): RowSubpageState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Create a subpage inside the row document first');

  return state;
}

async function flushPendingSync(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const flush = (window as typeof window & { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> })
            .__TEST_FLUSH_ALL_SYNC__;

          return flush ? flush() : false;
        }),
      { message: 'row and document edits reach the server', timeout: 30_000 }
    )
    .toBe(true);
}

When('I create a subpage inside the row document', async ({ page }) => {
  const rowUrl = new URL(page.url());
  const editor = page.getByTestId('editor-content').filter({ visible: true }).first();

  expect(rowUrl.searchParams.get('r')).toBeTruthy();
  await editor.click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').filter({ hasText: 'Subpage' }).click();

  const block = editor.locator('[data-block-type="sub_page"]');

  await expect(block).toBeVisible();
  const subpageId = await block.locator('[data-mention-id]').getAttribute('data-mention-id');

  if (!subpageId) throw new Error('The subpage block has no child view id');

  stateByPage.set(page, { gridUrl: `${rowUrl.origin}${rowUrl.pathname}`, subpageId });
  await flushPendingSync(page);
});

When('I open the new row subpage and name it {string}', async ({ page }, name: string) => {
  const { subpageId } = requireState(page);

  await page.locator(`[data-block-type="sub_page"] [data-mention-id="${subpageId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/app/[^/]+/${subpageId}$`));
  await expect(page.locator(`#editor-${subpageId}`)).toBeVisible();
  await renameCurrentPage(page, name);
});

Then('the subpage breadcrumb ends with {string} followed by {string}', async ({ page }, rowName: string, childName: string) => {
  const items = BreadcrumbSelectors.navigation(page).locator('[data-testid^="breadcrumb-item-"]');

  await expect(items.nth(-2)).toHaveText(rowName);
  await expect(items.last()).toHaveText(childName);
});

Then(
  'the expanded subpage breadcrumb includes {string} before {string} and {string}',
  async ({ page }, databaseName: string, rowName: string, childName: string) => {
    await BreadcrumbSelectors.navigation(page).getByRole('button').click();
    const dialog = page.getByRole('dialog').last();
    const items = dialog.locator('[data-testid^="breadcrumb-item-"]');

    await expect(items.filter({ hasText: databaseName })).toHaveText(databaseName);
    await expect(items.nth(-2)).toHaveText(rowName);
    await expect(items.last()).toHaveText(childName);
    const names = await items.allTextContents();

    expect(names.indexOf(databaseName)).toBeLessThan(names.indexOf(rowName));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
);

When('I reload the row subpage', async ({ page }) => {
  const { subpageId } = requireState(page);

  await flushPendingSync(page);
  await page.reload();
  await expect(page.locator(`#editor-${subpageId}`)).toBeVisible();
});

When('I change the row primary cell to {string} in another tab', async ({ page }, name: string) => {
  const { gridUrl } = requireState(page);
  const gridPage = await page.context().newPage();

  try {
    await gridPage.goto(gridUrl);
    await waitForGridReady(gridPage);
    const grid = DatabaseGridSelectors.grid(gridPage).filter({ visible: true }).first();

    // Edit the primary cell through the grid: the row-page header also writes
    // view.name, which would hide the regression this scenario protects.
    await editFirstGridCell(gridPage, grid, name);
    await flushPendingSync(gridPage);
  } finally {
    await gridPage.close();
  }
});
