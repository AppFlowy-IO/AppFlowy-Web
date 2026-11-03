import { readFile } from 'node:fs/promises';

import { Download, expect, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType, RowMetaKey } from '../../../src/application/database-yjs/database.type';
import { getMetaIdMap } from '../../../src/application/database-yjs/row_meta';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { apiGet, apiPost, browserAccessToken } from '../../support/dashboard-shared-helpers';
import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import {
  activeDatabaseViewId,
  addGalleryView,
  createFieldDirect,
  getActiveDatabaseFields,
  getActiveRowIds,
  setCellDirect,
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

// PDF points per millimetre, and each paper's portrait size in points.
const PT_PER_MM = 72 / 25.4;
const PAPER_POINTS: Record<string, [number, number]> = {
  A4: [210 * PT_PER_MM, 297 * PT_PER_MM],
  A3: [297 * PT_PER_MM, 420 * PT_PER_MM],
  Letter: [612, 792],
  Legal: [612, 1008],
};

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
  /** Each fixture row's name, with the values it holds in view order. */
  fixtureRows?: { name: string; values: string[] }[];
  fixtureHeaders?: string[];
  /** Mixed-field fixture: which rows are checked and which tag each row has. */
  checkedRows?: string[];
  tagByRow?: Record<string, string>;
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

interface SavedPdfText {
  str: string;
  x: number;
  y: number;
}

interface SavedPdfPage {
  width: number;
  height: number;
  text: string;
  items: SavedPdfText[];
}

/** Reopens a downloaded PDF and reads each page's size, text and text positions. */
async function readSavedPdf(download: Download): Promise<SavedPdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile((await download.path())!));
  const document = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: SavedPdfPage[] = [];

  for (let index = 1; index <= document.numPages; index += 1) {
    const pdfPage = await document.getPage(index);
    const content = await pdfPage.getTextContent();
    const items = content.items.flatMap((item) =>
      'str' in item && item.str.trim() ? [{ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }] : []
    );

    pages.push({ width: pdfPage.view[2], height: pdfPage.view[3], text: items.map((item) => item.str).join(' '), items });
  }

  await document.destroy();
  return pages;
}

/** The row whose name is printed nearest to `y` on this page. */
function nearestRowName(page: SavedPdfPage, rowNames: string[], y: number): string | undefined {
  let nearest: { name: string; distance: number } | undefined;

  for (const item of page.items) {
    if (!rowNames.includes(item.str)) continue;
    const distance = Math.abs(item.y - y);

    if (!nearest || distance < nearest.distance) nearest = { name: item.str, distance };
  }

  return nearest?.name;
}

async function databaseApi(page: Page): Promise<{ token: string; base: string; databaseId: string }> {
  const token = await browserAccessToken(page);
  const workspaceId = new URL(page.url()).pathname.split('/')[2];
  const databaseId = await page.evaluate(() =>
    String((window as any).__TEST_DATABASE_CONTEXT__.databaseDoc.getMap('data').get('database').get('id'))
  );

  return { token, base: `/api/workspace/${workspaceId}/database/${databaseId}`, databaseId };
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

Given(
  'the database has {int} columns and {int} rows of distinct values written through the server',
  async ({ page, request }, columns: number, rows: number) => {
    const state = stateOf(page);
    const { token, base } = await databaseApi(page);
    const existing = (await getActiveDatabaseFields(page)).map((field) => field.name);
    const added = Array.from({ length: columns - existing.length }, (_, index) => `Header${String(index + 1).padStart(2, '0')}End`);

    for (const name of added) {
      await apiPost(request, token, `${base}/fields`, { name, field_type: FieldType.RichText });
    }

    state.fixtureHeaders = [...existing, ...added];
    state.fixtureRows = [];
    const rowIds: string[] = [];

    for (let row = 0; row < rows; row += 1) {
      const name = `Row${String(row).padStart(2, '0')}NameEnd`;
      const values = added.map((_, column) => `Row${String(row).padStart(2, '0')}Col${String(column + 1).padStart(2, '0')}End`);
      const cells = Object.fromEntries([['Name', name], ...added.map((header, column) => [header, values[column]])]);

      rowIds.push(
        await apiPost<string>(request, token, `${base}/row`, { cells, document: null, parse_link_as_link_preview: false })
      );
      state.fixtureRows.push({ name, values: [name, ...values] });
    }

    // Export reads the server's copy: wait until it returns every row with its last value.
    const lastHeader = added[added.length - 1];

    await expect
      .poll(
        async () => {
          const details = await apiGet<{ cells: Record<string, unknown> }[]>(
            request,
            token,
            `${base}/row/detail?ids=${rowIds.join(',')}`
          );

          return details.map(({ cells }) => `${String(cells.Name)}|${String(cells[lastHeader])}`).sort();
        },
        { timeout: 60_000, message: 'waiting for the fixture rows to reach the server' }
      )
      .toEqual(state.fixtureRows.map(({ name, values }) => `${name}|${values[values.length - 1]}`).sort());

    // Reopen the page so the grid shows what the server holds.
    await page.reload();
    await expect.poll(async () => (await getActiveDatabaseFields(page)).length, { timeout: 30_000 }).toBe(columns);
    await expect
      .poll(async () => (await getActiveRowIds(page)).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(rows);
    await caption(page, `${columns} columns × ${rows} rows written through the server`);
  }
);

Given(
  'the first and third rows are checked and every row has its own Status tag',
  async ({ page, request }) => {
    const state = stateOf(page);
    const fields = await getActiveDatabaseFields(page);
    const nameField = fields.find((field) => field.isPrimary)!;
    const doneField = fields.find((field) => field.type === FieldType.Checkbox)!;
    const rowIds = await getActiveRowIds(page);
    const tags = ['Alpha', 'Beta', 'Gamma'];
    const statusField = await createFieldDirect(page, {
      fieldType: FieldType.SingleSelect,
      name: 'Status',
      selectOptions: tags.map((tag) => ({ id: tag.toLowerCase(), name: tag })),
    });

    expect(rowIds.length, 'the new grid has three rows').toBe(3);
    state.fixtureRows = [];
    state.checkedRows = [];
    state.tagByRow = {};
    for (const [index, rowId] of rowIds.entries()) {
      const name = `Mixed${index + 1}End`;

      await setCellDirect(page, rowId, nameField.id, FieldType.RichText, name);
      await setCellDirect(page, rowId, statusField, FieldType.SingleSelect, tags[index].toLowerCase());
      if (index !== 1) {
        await setCellDirect(page, rowId, doneField.id, FieldType.Checkbox, 'Yes');
        state.checkedRows.push(name);
      }

      state.tagByRow[name] = tags[index];
      state.fixtureRows.push({ name, values: [name] });
    }

    // Export reads the server's copy: wait until every cell has reached it.
    const { token, base } = await databaseApi(page);

    await expect
      .poll(
        async () => {
          const details = await apiGet<{ cells: Record<string, unknown> }[]>(
            request,
            token,
            `${base}/row/detail?ids=${rowIds.join(',')}`
          );

          return details
            .map(({ cells }) => {
              const done = cells[doneField.name];
              const checked = done === true || done === 'Yes' || done === 'true';

              return [String(cells.Name), String(cells.Status), String(checked)].join('|');
            })
            .sort();
        },
        { timeout: 30_000, message: 'waiting for the mixed-field cells to reach the server' }
      )
      .toEqual(
        state.fixtureRows
          .map(({ name }) => [name, state.tagByRow![name], state.checkedRows!.includes(name) ? 'true' : 'false'].join('|'))
          .sort()
      );
    await caption(page, 'Rows 1 and 3 are checked; each row has its own Status tag');
  }
);

Then('every page of the downloaded PDF is {word} paper in {word}', async ({ page }, paper: string, orientation: string) => {
  const [width, height] = PAPER_POINTS[paper];
  const [expectedWidth, expectedHeight] = orientation === 'landscape' ? [height, width] : [width, height];
  const pages = await readSavedPdf(stateOf(page).download!);

  for (const [index, pdfPage] of pages.entries()) {
    expect(Math.abs(pdfPage.width - expectedWidth), `page ${index + 1} width`).toBeLessThan(0.5);
    expect(Math.abs(pdfPage.height - expectedHeight), `page ${index + 1} height`).toBeLessThan(0.5);
  }

  await caption(page, `✓ All ${pages.length} pages are ${paper} ${orientation}`);
});

Then(
  'the downloaded PDF has every cell beside its row name, continuing columns on more pages',
  async ({ page }) => {
    const { download, fixtureRows, fixtureHeaders } = stateOf(page);
    const pages = await readSavedPdf(download!);
    const rowNames = fixtureRows!.map((row) => row.name);

    expect(pages.length, 'wide tables continue on more pages instead of shrinking').toBeGreaterThan(1);
    for (const [index, pdfPage] of pages.entries()) {
      // Every page repeats the name column, so each page identifies its rows.
      for (const name of rowNames) expect(pdfPage.text, `page ${index + 1} lists ${name}`).toContain(name);
      expect(pdfPage.text, `page ${index + 1} repeats the Name header`).toContain('Name');
    }

    for (const header of fixtureHeaders!) {
      expect(pages.some((pdfPage) => pdfPage.items.some((item) => item.str === header)), `header ${header}`).toBe(true);
    }

    for (const { name, values } of fixtureRows!) {
      for (const value of values.slice(1)) {
        const placements = pages.flatMap((pdfPage) =>
          pdfPage.items.filter((item) => item.str === value).map((item) => nearestRowName(pdfPage, rowNames, item.y))
        );

        expect(placements, `${value} appears once, beside ${name}`).toEqual([name]);
      }
    }

    await caption(page, `✓ ${fixtureRows!.length * fixtureRows![0].values.length} cells beside their rows on ${pages.length} pages`);
  }
);

Then('the downloaded PDF shows ticks and Status tags beside their own rows only', async ({ page }) => {
  const { download, fixtureRows, checkedRows, tagByRow } = stateOf(page);
  const rowNames = fixtureRows!.map((row) => row.name);
  const pages = await readSavedPdf(download!);
  const ticks = pages.flatMap((pdfPage) =>
    pdfPage.items.filter((item) => item.str === '✓').map((item) => nearestRowName(pdfPage, rowNames, item.y))
  );

  expect(ticks.sort(), 'rows with a tick').toEqual([...checkedRows!].sort());
  for (const [name, tag] of Object.entries(tagByRow!)) {
    const placements = pages.flatMap((pdfPage) =>
      pdfPage.items.filter((item) => item.str === tag).map((item) => nearestRowName(pdfPage, rowNames, item.y))
    );

    expect(placements, `the ${tag} tag sits beside ${name}`).toEqual([name]);
  }

  await caption(page, `✓ Ticks beside ${checkedRows!.join(' and ')}; each Status tag beside its row`);
});
