import { readFile } from 'node:fs/promises';

import { Download, expect, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';
import { getMetaIdMap } from '../../../src/application/database-yjs/row_meta';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import {
  activeDatabaseViewId,
  addGalleryView,
  getActiveDatabaseFields,
  switchToDatabaseView,
} from '../../support/gallery-test-helpers';
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
const RECORDING = process.env.PLAYWRIGHT_VIDEO === 'on';

interface PdfExportState {
  pageViewId?: string;
  databaseViewId?: string;
  rowId?: string;
  title?: string;
  body?: string;
  surface?: 'full page' | 'peek';
  exportedViewId?: string;
  exportUrl?: URL;
  download?: Download;
  gridViewId?: string;
  galleryViewId?: string;
  gridFieldNames?: string[];
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

/**
 * Recorded runs (PLAYWRIGHT_VIDEO=on) show what each step does and checks,
 * because a headless download never appears on screen.
 */
async function caption(page: Page, text: string): Promise<void> {
  if (!RECORDING) return;
  await page.evaluate((value) => {
    let el = document.getElementById('bdd-caption');

    if (!el) {
      el = document.createElement('div');
      el.id = 'bdd-caption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: '80%',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'rgba(17, 24, 39, 0.9)',
        color: '#fff',
        font: '600 15px/1.45 system-ui, sans-serif',
        whiteSpace: 'pre-line',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }

    el.textContent = value;
  }, text);
  await page.waitForTimeout(1500);
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

/**
 * CI serves the app and the API from different origins, and the API proxy's
 * /api/export location neither answers CORS preflights nor exposes
 * Content-Disposition. Send the app's export request from the test runner so
 * that gap cannot hide the app's behavior; the real server still renders the
 * requested page and names the file.
 */
async function sendExportFromRunner(route: Route): Promise<void> {
  const response = await route.fetch({ timeout: 60_000 });

  await route.fulfill({
    response,
    headers: { ...response.headers(), 'access-control-expose-headers': 'Content-Disposition' },
  });
}

Given('a signed-in user has a new grid database for PDF export', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  stateOf(page).databaseViewId = viewIdFromUrl(page.url());
  await caption(page, 'Given a new grid database');
});

Given('the first grid row is titled {string}', async ({ page }, title: string) => {
  await openFirstRowInPeek(page);
  await RowDetailSelectors.modal(page).getByTestId('row-title-input').fill(title);
  stateOf(page).title = title;
  await caption(page, `The first row is titled "${title}"`);
});

Given(
  'the first grid row is titled {string} with page content {string}',
  async ({ page }, title: string, body: string) => {
    await openFirstRowInPeek(page);
    await RowDetailSelectors.modal(page).getByTestId('row-title-input').fill(title);
    await typeInRowDocument(page, body);
    Object.assign(stateOf(page), { title, body });
    await caption(page, `The first row is titled "${title}" and has page content`);
  }
);

Given('the first grid row has no title', async ({ page }) => {
  await openFirstRowInPeek(page);
  await expect(RowDetailSelectors.modal(page).getByTestId('row-title-input')).toHaveText('');
  stateOf(page).title = '';
  await caption(page, 'The first row has no title');
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
  await caption(page, 'The row is open as a full page');
});

Given('the row is open in a {word} peek', async ({ page }, mode: string) => {
  if (mode !== 'side' && mode !== 'center') throw new Error(`Unknown peek mode "${mode}"`);
  if (mode === 'center') await choosePeekMenuItem(page, 'Center peek');
  await expectPeekOpen(page, mode, stateOf(page).title);
  stateOf(page).surface = 'peek';
  await caption(page, `The row is open in a ${mode} peek`);
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
    await caption(page, `A document page titled "${title}"`);
  }
);

When('I clear the page title', async ({ page }) => {
  await renamePage(page, stateOf(page).pageViewId!, '');
  // The emptied title shows its "Untitled" placeholder.
  await expect(pageTitleInput(page)).toHaveText('');
  await expect(pageTitleInput(page)).toHaveAttribute('data-placeholder', 'Untitled');
  await caption(page, 'The page title is cleared, so the page shows as "Untitled"');
});

async function closeSharePopover(page: Page): Promise<void> {
  if (await ShareSelectors.sharePopover(page).isVisible()) {
    await page.keyboard.press('Escape');
    await expect(ShareSelectors.sharePopover(page)).toBeHidden();
  }
}

async function openExportTab(page: Page): Promise<void> {
  const state = stateOf(page);

  // The Share button toggles its popover, so a click while it is open would close it.
  await closeSharePopover(page);

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
  await expect(exportTab, `the ${state.surface ?? 'page'} Share menu offers "Export as"`).toBeVisible();
  await exportTab.click({ force: true });
  await expect(ExportSelectors.pdfButton(page)).toBeEnabled({ timeout: 15_000 });
}

/** Clicks Export to PDF and keeps the request the app sent and the file it downloaded. */
async function exportFromPanel(page: Page): Promise<void> {
  const state = stateOf(page);

  await page.route(PDF_EXPORT_URL, sendExportFromRunner);
  try {
    const exportRequest = page.waitForRequest(PDF_EXPORT_URL);
    const download = page.waitForEvent('download', { timeout: 60_000 });

    await ExportSelectors.pdfButton(page).click({ force: true });
    const url = (await exportRequest).url();

    state.exportUrl = new URL(url);
    state.exportedViewId = PDF_EXPORT_URL.exec(url)![1];
    state.download = await download;
  } finally {
    await page.unroute(PDF_EXPORT_URL, sendExportFromRunner);
  }
}

interface SavedPdfPage {
  width: number;
  height: number;
  text: string;
}

/** Reopens a downloaded PDF and reads each page's size and text. */
async function readSavedPdf(download: Download): Promise<SavedPdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile((await download.path())!));
  const document = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: SavedPdfPage[] = [];

  for (let index = 1; index <= document.numPages; index += 1) {
    const pdfPage = await document.getPage(index);
    const content = await pdfPage.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');

    pages.push({ width: pdfPage.view[2], height: pdfPage.view[3], text });
  }

  await document.destroy();
  return pages;
}

When('I export it to PDF from the Share menu', async ({ page }) => {
  await caption(page, `Share → Export as → Export to PDF (${stateOf(page).surface ?? 'page'})`);
  await openExportTab(page);
  await exportFromPanel(page);
});

Given('the database has a Gallery tab, which shows only the name field', async ({ page }) => {
  const state = stateOf(page);

  state.gridViewId = await activeDatabaseViewId(page);
  state.gridFieldNames = (await getActiveDatabaseFields(page)).map((field) => field.name);
  expect(state.gridFieldNames.length, 'the new grid has fields besides Name').toBeGreaterThan(1);
  state.galleryViewId = await addGalleryView(page);
  const galleryFields = await getActiveDatabaseFields(page);

  expect(galleryFields.filter((field) => field.visibility === 0).map((field) => field.name)).toEqual(['Name']);
  await caption(page, `A Gallery tab shows only "Name"; the Grid tab shows ${state.gridFieldNames.join(', ')}`);
});

When('I switch to the Grid tab', async ({ page }) => {
  await closeSharePopover(page);
  await switchToDatabaseView(page, stateOf(page).gridViewId!, 'Grid');
  await caption(page, 'Switch back to the Grid tab');
});

When('I open Export as from the database Share menu', async ({ page }) => {
  await caption(page, 'Share → Export as');
  await openExportTab(page);
});

When('I choose {word} paper in {word}', async ({ page }, paper: string, orientation: string) => {
  const pageSize = paper.toLowerCase();

  await ExportSelectors.pageSizeTrigger(page).click();
  await ExportSelectors.pageSizeOption(page, pageSize).click();
  await expect(ExportSelectors.pageSizeTrigger(page)).toHaveText(paper);
  const landscape = ExportSelectors.landscapeSwitch(page);

  if ((orientation === 'landscape') !== ((await landscape.getAttribute('data-state')) === 'checked')) {
    await landscape.click();
  }

  await expect(landscape).toHaveAttribute('data-state', orientation === 'landscape' ? 'checked' : 'unchecked');
  await caption(page, `Choose ${paper} paper in ${orientation}`);
});

When('I export the database to PDF', async ({ page }) => {
  await caption(page, 'Export to PDF');
  await exportFromPanel(page);
});

Then(
  'the PDF export offers the paper sizes {string} with {string} selected',
  async ({ page }, sizes: string, selected: string) => {
    const trigger = ExportSelectors.pageSizeTrigger(page);

    await expect(trigger).toHaveText(selected);
    await trigger.click();
    const options = sizes.split(',').map((size) => size.trim());

    for (const size of options) {
      await expect(ExportSelectors.pageSizeOption(page, size.toLowerCase())).toHaveText(size);
    }

    await expect(page.locator('[data-testid^="export-pdf-page-size-"]:not([data-testid$="-trigger"])')).toHaveCount(
      options.length
    );
    await caption(page, `✓ Paper sizes: ${options.join(', ')}; ${selected} is selected`);
    await page.keyboard.press('Escape');
    await expect(ExportSelectors.pageSizeOption(page, options[0].toLowerCase())).toHaveCount(0);
  }
);

Then('the PDF export is in portrait', async ({ page }) => {
  await expect(ExportSelectors.landscapeSwitch(page)).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByText('Wide tables continue on additional pages, repeating the name column.')).toBeVisible();
  await caption(page, '✓ Landscape is off, and wide tables continue on more pages');
});

Then('the PDF export does not offer {string}', async ({ page }, option: string) => {
  await expect(ExportSelectors.panel(page)).toBeVisible();
  await expect(ExportSelectors.includeLinkedPagesSwitch(page)).toHaveCount(0);
  await expect(ExportSelectors.panel(page).getByText(option)).toHaveCount(0);
  await caption(page, `✓ "${option}" applies to documents, so a database does not offer it`);
});

Then('the PDF export requests {string} paper in {word}', async ({ page }, pageSize: string, orientation: string) => {
  const params = stateOf(page).exportUrl!.searchParams;

  expect(params.get('page_size'), 'page_size query parameter').toBe(pageSize);
  expect(params.get('landscape'), 'landscape query parameter').toBe(String(orientation === 'landscape'));
  await caption(page, `✓ The export asks the server for page_size=${pageSize}, landscape=${orientation === 'landscape'}`);
});

Then('the downloaded file is a PDF', async ({ page }) => {
  const download = stateOf(page).download!;
  const bytes = await readFile((await download.path())!);

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await caption(page, `✓ Downloaded "${download.suggestedFilename()}" (a valid PDF)`);
});

Then('the PDF export targets the Gallery tab, not the first Grid tab', async ({ page }) => {
  const { exportedViewId, galleryViewId, gridViewId } = stateOf(page);

  expect(exportedViewId, 'exported view id').toBe(galleryViewId);
  expect(exportedViewId).not.toBe(gridViewId);
  await caption(page, `✓ Exported the Gallery tab ${galleryViewId?.slice(0, 8)}…`);
});

Then('the PDF export targets the Grid tab', async ({ page }) => {
  const { exportedViewId, gridViewId } = stateOf(page);

  expect(exportedViewId, 'exported view id').toBe(gridViewId);
  await caption(page, `✓ Exported the Grid tab ${gridViewId?.slice(0, 8)}…`);
});

Then(
  'the exported PDF has the column {string} and none of the grid\'s other columns',
  async ({ page }, column: string) => {
    const state = stateOf(page);
    const text = (await readSavedPdf(state.download!)).map((pdfPage) => pdfPage.text).join(' ');
    const hidden = state.gridFieldNames!.filter((name) => name !== column);

    expect(text).toContain(column);
    for (const name of hidden) expect(text, `the Gallery tab hides "${name}"`).not.toContain(name);
    await caption(page, `✓ The saved PDF shows "${column}" and omits ${hidden.join(', ')}`);
  }
);

Then('the exported PDF has every column of the grid', async ({ page }) => {
  const state = stateOf(page);
  const text = (await readSavedPdf(state.download!)).map((pdfPage) => pdfPage.text).join(' ');

  for (const name of state.gridFieldNames!) expect(text, `the Grid tab shows "${name}"`).toContain(name);
  await caption(page, `✓ The saved PDF shows ${state.gridFieldNames!.join(', ')}`);
});

Then('the PDF export targets the row page, not the database', async ({ page }) => {
  const { rowId, databaseViewId, exportedViewId } = stateOf(page);
  const rowPageId = getMetaIdMap(rowId!).get(RowMetaKey.DocumentId);

  expect(exportedViewId, 'exported view id').toBe(rowPageId);
  expect(exportedViewId).not.toBe(databaseViewId);
  await caption(page, `✓ Exported the row page ${rowPageId?.slice(0, 8)}…, not the database ${databaseViewId?.slice(0, 8)}…`);
});

Then('the downloaded PDF is named {string}', async ({ page }, filename: string) => {
  const download = stateOf(page).download!;

  expect(download.suggestedFilename()).toBe(filename);
  const bytes = await readFile((await download.path())!);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await caption(page, `✓ Downloaded "${download.suggestedFilename()}" (a valid PDF)`);
});
