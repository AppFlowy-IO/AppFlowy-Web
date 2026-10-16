import { expect, test, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForRowBodyCompletion } from '../../support/atomic-creation-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { openRowDetail, openRowDetailByRowId, closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

const documentRoute = '**/v2/page-view/document/default{,?**}';

async function chooseDocument(page: Page) {
  await page.locator('[data-testid="inline-add-page"]:visible').first().click();
  await AddPageSelectors.addDocumentButton(page).click();
}

test('atomic creation keeps document/sidebar, database tabs and row-page content consistent', async ({
  page,
  request,
}, info) => {
  page.on('console', (event) => {
    if (event.text().includes('[AtomicCreation]')) console.log(event.text());
  });
  page.on('pageerror', (error) => console.log('page-error:', error.message));
  const timings: { operation: string; elapsedMs: number }[] = [];
  const atomicRequests: { url: string; body: string }[] = [];

  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/v2\/(?:page-view\/|database\/[^/]+\/row\/)/.test(new URL(req.url()).pathname)) {
      atomicRequests.push({ url: req.url(), body: req.postData() ?? '' });
    }
  });
  await page.context().addInitScript(
    (config) => {
      window.__APP_CONFIG__ = config;
    },
    {
      APPFLOWY_BASE_URL: TestConfig.apiUrl,
      APPFLOWY_GOTRUE_BASE_URL: TestConfig.gotrueUrl,
      APPFLOWY_WS_BASE_URL: TestConfig.wsUrl,
    }
  );
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);

  // Drop only the acknowledgement, after the real server has committed. The explicit
  // retry must publish the exact saved command and then read current authorized state.
  const previousUrl = page.url();
  let committedDocumentId = '';

  await page.route(
    documentRoute,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      expect(body.code).toBe(0);
      committedDocumentId = body.data.result.view_id;
      await route.abort('failed');
    },
    { times: 1 }
  );
  await chooseDocument(page);
  await expect(page.getByRole('button', { name: 'Finish creating your page' })).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toBe(previousUrl);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Finish creating your page' })).toBeVisible();
  expect(atomicRequests.filter((entry) => new URL(entry.url).pathname.endsWith('/document/default'))).toHaveLength(1);
  const started = Date.now();

  await page.getByRole('button', { name: 'Finish creating your page' }).click();
  await expect(page).toHaveURL(new RegExp(committedDocumentId));
  await expect(page.getByTestId('editor-content').first()).toBeVisible();
  await expect(page.getByTestId(`page-${committedDocumentId}`)).toHaveAttribute('data-selected', 'true');
  timings.push({ operation: 'document explicit recovery to editor', elapsedMs: Date.now() - started });
  const documentRequests = atomicRequests.filter((entry) => new URL(entry.url).pathname.endsWith('/document/default'));

  expect(documentRequests).toHaveLength(2);
  expect(documentRequests[1].body).toBe(documentRequests[0].body);
  expect(documentRequests[0].body).not.toMatch(/page_data|encoded_collab|doc_state/);

  const databaseStarted = Date.now();
  const databaseResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/database/default')
  );

  await createDatabaseView(page, 'Grid', 0);
  const databaseBody = await (await databaseResponse).json();

  expect(databaseBody.code).toBe(0);
  const containerId = databaseBody.data.result.view_id;

  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30_000 });
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  await expect(page.getByTestId(`page-${containerId}`)).toHaveAttribute('data-selected', 'true');
  timings.push({ operation: 'database click to grid', elapsedMs: Date.now() - databaseStarted });
  const gridTabId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');
  const viewStarted = Date.now();
  const viewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/database-view/default')
  );

  await DatabaseViewSelectors.addViewButton(page).click();
  await page.getByTestId('add-list-view-button').click();
  const viewBody = await (await viewResponse).json();

  expect(viewBody.code).toBe(0);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute(
    'data-testid',
    `view-tab-${viewBody.data.result.view_id}`
  );
  await expect(DatabaseViewSelectors.listView(page)).toBeVisible();
  timings.push({ operation: 'database view click to list', elapsedMs: Date.now() - viewStarted });
  await page.getByTestId(gridTabId!).click();

  // Opening creates the empty server-owned body before mounting its editor;
  // ordinary database Row creation still uses normal client synchronization.
  const beforeBody = atomicRequests.length;
  const rowStarted = Date.now();
  const rowResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/row-document')
  );

  await openRowDetail(page);
  expect((await (await rowResponse).json()).code).toBe(0);
  const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

  await expect(editor).toBeVisible();
  expect(atomicRequests).toHaveLength(beforeBody + 1);
  await editor.fill('Atomic first row body');
  await expect(RowDetailSelectors.modal(page)).toContainText('Atomic first row body');
  await closeRowDetailWithEscape(page);
  await openRowDetail(page);
  await expect(RowDetailSelectors.modal(page)).toContainText('Atomic first row body');
  timings.push({ operation: 'row page open through body edit and reopen', elapsedMs: Date.now() - rowStarted });
  await closeRowDetailWithEscape(page);

  // The new Row is committed atomically before its first body is created.
  const previousRows = new Set(
    await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))
  );

  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
  const newRowId = (
    await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))
  ).find((id) => !previousRows.has(id));

  expect(newRowId).toBeTruthy();
  const newRowCompletion = waitForRowBodyCompletion(page);

  await openRowDetailByRowId(page, newRowId!.replace('grid-row-', ''));
  await newRowCompletion;
  const newRowEditor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

  await expect(newRowEditor).toBeVisible();
  await newRowEditor.fill('First body on a newly added row');
  await expect(RowDetailSelectors.modal(page)).toContainText('First body on a newly added row');
  await closeRowDetailWithEscape(page);

  const beforeOffline = atomicRequests.length;

  // Prime the lazy menu while connected; its action must recheck connectivity
  // at the actual click, independently of when the menu was rendered.
  await page.locator('[data-testid="inline-add-page"]:visible').first().click();
  await expect(AddPageSelectors.addDocumentButton(page)).toBeVisible();
  await page.context().setOffline(true);
  await AddPageSelectors.addDocumentButton(page).click();
  // Connectivity is checked at the click and exposes the reviewed offline guidance.
  await expect(page.getByText('Connect to the internet to create this item.', { exact: true })).toBeVisible();
  expect(atomicRequests).toHaveLength(beforeOffline);
  await page.keyboard.press('Escape');
  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(DatabaseGridSelectors.newRowButton(page)).toBeEnabled();
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
  expect(atomicRequests).toHaveLength(beforeOffline);
  await page.context().setOffline(false);
  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(5);
  const reconnectedRequests = atomicRequests.slice(beforeOffline);

  expect(new Set(reconnectedRequests.map((entry) => entry.body)).size).toBe(1);
  expect(reconnectedRequests.every((entry) => new URL(entry.url).pathname.endsWith('/row/default'))).toBe(true);
  await info.attach('creation-phase-timings', {
    body: JSON.stringify(timings, null, 2),
    contentType: 'application/json',
  });
});
