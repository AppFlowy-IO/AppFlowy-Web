import { readFile } from 'node:fs/promises';

import { Download, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';
import { getMetaIdMap } from '../../../src/application/database-yjs/row_meta';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { openRowDetail, typeInRowDocument } from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  ExportSelectors,
  RowDetailSelectors,
  ShareSelectors,
} from '../../support/selectors';
import { choosePeekMenuItem, expectPeekOpen } from '../../support/side-peek-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

// POST /api/export/view/{workspace}/{view}/pdf — the second id is what the server renders.
const PDF_EXPORT_URL = /\/api\/export\/view\/[^/]+\/([^/]+)\/pdf(\?|$)/;

interface PdfExportState {
  pageViewId?: string;
  databaseViewId?: string;
  rowId?: string;
  title?: string;
  body?: string;
  surface?: 'full page' | 'peek';
  exportedViewId?: string;
  download?: Download;
}

const states = new WeakMap<Page, PdfExportState>();

function stateOf(page: Page): PdfExportState {
  let state = states.get(page);

  if (!state) {
    state = {};
    states.set(page, state);
  }

  return state;
}

function viewIdFromUrl(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).pop()!;
}

function pageTitleInput(page: Page) {
  return page.locator('#root').getByTestId('page-title-input').first();
}

/** Types the title and commits it with Escape, which sends update-name without the 3s debounce. */
async function renamePage(page: Page, viewId: string, name: string): Promise<void> {
  const updateName = page.waitForRequest(
    (req) =>
      req.method() === 'POST' &&
      new URL(req.url()).pathname.endsWith(`/page-view/${viewId}/update-name`) &&
      req.postDataJSON()?.name === name
  );
  const title = pageTitleInput(page);

  await title.click();
  await title.fill(name);
  await title.press('Escape');
  await (await updateName).response();
}

async function openFirstRowInPeek(page: Page): Promise<void> {
  const firstRow = DatabaseGridSelectors.dataRows(page).first();

  await expect(firstRow).toBeAttached({ timeout: 15_000 });
  stateOf(page).rowId = (await firstRow.getAttribute('data-testid'))!.replace('grid-row-', '');
  await openRowDetail(page, 0);
  await expectPeekOpen(page);
}

Given('a signed-in user has a new grid database for PDF export', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  stateOf(page).databaseViewId = viewIdFromUrl(page.url());
});

Given('the first grid row is titled {string}', async ({ page }, title: string) => {
  await openFirstRowInPeek(page);
  await RowDetailSelectors.modal(page).getByTestId('row-title-input').fill(title);
  stateOf(page).title = title;
});

Given(
  'the first grid row is titled {string} with page content {string}',
  async ({ page }, title: string, body: string) => {
    await openFirstRowInPeek(page);
    await RowDetailSelectors.modal(page).getByTestId('row-title-input').fill(title);
    await typeInRowDocument(page, body);
    Object.assign(stateOf(page), { title, body });
  }
);

Given('the first grid row has no title', async ({ page }) => {
  await openFirstRowInPeek(page);
  await expect(RowDetailSelectors.modal(page).getByTestId('row-title-input')).toHaveText('');
  stateOf(page).title = '';
});

Given('the row is opened as a full page', async ({ page }) => {
  const state = stateOf(page);

  await RowDetailSelectors.openFullPageButton(page).click();
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]r=.+/, { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get('r')).toBe(state.rowId);
  await expect(RowDetailSelectors.titleInput(page)).toHaveText(state.title ?? '', { timeout: 15_000 });
  if (state.body) await expect(page.getByTestId('editor-content')).toContainText(state.body);
  state.surface = 'full page';
});

Given('the row is open in a {word} peek', async ({ page }, mode: string) => {
  if (mode !== 'side' && mode !== 'center') throw new Error(`Unknown peek mode "${mode}"`);
  if (mode === 'center') await choosePeekMenuItem(page, 'Center peek');
  await expectPeekOpen(page, mode, stateOf(page).title);
  stateOf(page).surface = 'peek';
});

Given(
  'a signed-in user has a document page titled {string} for PDF export',
  async ({ page, request }, title: string) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAndWaitForApp(page, request, generateRandomEmail());
    const viewId = await createDocumentPageAndNavigate(page);

    await renamePage(page, viewId, title);
    stateOf(page).pageViewId = viewId;
  }
);

When('I clear the page title', async ({ page }) => {
  await renamePage(page, stateOf(page).pageViewId!, '');
  // The emptied title shows its "Untitled" placeholder.
  await expect(pageTitleInput(page)).toHaveText('');
  await expect(pageTitleInput(page)).toHaveAttribute('data-placeholder', 'Untitled');
});

When('I export it to PDF from the Share menu', async ({ page }) => {
  const state = stateOf(page);

  if (state.surface === 'peek') {
    await RowDetailSelectors.modal(page).getByTestId('share-button').click();
  } else {
    const headerShare = page.locator('.appflowy-top-bar').getByTestId('share-button');

    await expect(headerShare).toBeVisible({ timeout: 10_000 });
    // evaluate(click) avoids the sticky header overlay intercepting pointer events
    await headerShare.evaluate((el: HTMLElement) => el.click());
  }

  const popover = ShareSelectors.sharePopover(page);
  const exportTab = popover.getByText('Export as', { exact: true });

  await expect(popover).toBeVisible();
  await expect(exportTab, `the ${state.surface} Share menu offers "Export as"`).toBeVisible();
  await exportTab.click({ force: true });
  await expect(ExportSelectors.pdfButton(page)).toBeEnabled({ timeout: 15_000 });

  const exportRequest = page.waitForRequest(PDF_EXPORT_URL);
  const download = page.waitForEvent('download', { timeout: 60_000 });

  await ExportSelectors.pdfButton(page).click({ force: true });
  state.exportedViewId = PDF_EXPORT_URL.exec((await exportRequest).url())![1];
  state.download = await download;
});

Then('the PDF export targets the row page, not the database', async ({ page }) => {
  const { rowId, databaseViewId, exportedViewId } = stateOf(page);

  expect(exportedViewId, 'exported view id').toBe(getMetaIdMap(rowId!).get(RowMetaKey.DocumentId));
  expect(exportedViewId).not.toBe(databaseViewId);
});

Then('the downloaded PDF is named {string}', async ({ page }, filename: string) => {
  const download = stateOf(page).download!;

  expect(download.suggestedFilename()).toBe(filename);
  const bytes = await readFile((await download.path())!);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
