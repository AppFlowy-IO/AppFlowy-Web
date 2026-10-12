import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { writeFile } from 'fs/promises';
import * as Y from 'yjs';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { ensurePageExpandedByViewId } from '../../support/page-utils';
import {
  AddPageSelectors,
  BoardSelectors,
  CalendarSelectors,
  ChartSelectors,
  DatabaseFeedSelectors,
  DatabaseGallerySelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FormSelectors,
  TimelineSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { grantTestProSubscription, mockProBillingResponses } from '../../support/subscription-test-helpers';
import { expectViewCreationAvailable } from '../../support/view-creation-availability';

const viewRoute = '**/v2/page-view/database-view/default';
const viewPath = '/v2/page-view/database-view/default';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });

  return { promise, release };
}

async function createSource(page: Page, request: APIRequestContext) {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  const response = page.waitForResponse((item) => item.request().method() === 'POST' &&
    item.url().endsWith('/v2/page-view/database/default'));

  await createDatabaseView(page, 'Grid', 0);
  const created = await response;
  const body = await created.json();
  const command = created.request().postDataJSON();

  expect(body.code).toBe(0);
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  return { containerId: body.data.result.view_id as string, databaseId: body.data.result.database_id as string,
    primaryId: command.database.view_id as string, rowIds: command.database.initial_row_ids as string[],
    name: command.name as string };
}

async function addList(page: Page) {
  await DatabaseViewSelectors.addViewButton(page).click();
  await page.getByTestId('add-list-view-button').click();
}

function observeCreations(page: Page) {
  const compact: string[] = [];
  const legacy: string[] = [];

  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;

    if (pathname.endsWith(viewPath)) compact.push(request.postData() ?? '');
    if (/\/page-view\/[^/]+\/database-view$/.test(pathname)) legacy.push(pathname);
  });
  return { compact, legacy };
}

// List/Feed and linked Gallery have separate recovery/placement cases below.
// These cases cover the remaining layouts on an already existing Database.
for (const layout of [
  { name: 'Grid', value: 0 }, { name: 'Board', value: 1 }, { name: 'Calendar', value: 2 },
  { name: 'Chart', value: 3 }, { name: 'Gallery', value: 5 },
  { name: 'Form builder', value: 7 }, { name: 'Timeline', value: 8 },
]) {
  test(`server-created ${layout.name} view is complete before activation and matches the sidebar after reload`, async ({ page, request }, info) => {
    if (layout.value === 8) await mockProBillingResponses(page);
    const source = await createSource(page, request);

    if (layout.value === 8) grantTestProSubscription(page);
    const requests = observeCreations(page);
    let serverSchemaChecked = false;

    await page.route(viewRoute, async (route) => {
      const response = await route.fetch();
      const result = await response.json();

      expect(result.code).toBe(0);
      const url = new URL(route.request().url());

      url.pathname = url.pathname.replace('/v2/page-view/database-view/default', `/page-view/${result.data.result.view_id}`);
      // Inspect the committed schema while the creator still waits for its
      // receipt. No client-side completion can make this assertion pass.
      const stored = await request.get(url.toString(), {
        headers: { Authorization: route.request().headers().authorization },
      });
      const graph = await stored.json();
      const doc = new Y.Doc();

      try {
        expect(graph.code).toBe(0);
        Y.applyUpdate(doc, Uint8Array.from(graph.data.data.encoded_collab));
        const database = doc.getMap('data').get('database') as Y.Map<unknown>;
        const views = database.get('views') as Y.Map<Y.Map<unknown>>;
        const view = views.get(result.data.result.view_id)!;

        expect(database.get('id')).toBe(source.databaseId);
        expect(Number(view.get('layout'))).toBe(layout.value);
        expect((view.get('row_orders') as Y.Array<{ id: string }>).toArray().map((row) => row.id).sort())
          .toEqual([...source.rowIds].sort());
        if (layout.value === 1) {
          const groups = view.get('groups') as Y.Array<Y.Map<unknown>>;

          expect(groups.length).toBeGreaterThan(0);
          expect((database.get('fields') as Y.Map<unknown>).has(groups.get(0).get('field_id') as string)).toBe(true);
          expect((groups.get(0).get('groups') as Y.Array<unknown>).length).toBeGreaterThan(0);
        }
        serverSchemaChecked = true;
      } finally { doc.destroy(); }
      await route.fulfill({ response });
    }, { times: 1 });
    const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(viewPath));

    await DatabaseViewSelectors.addViewButton(page).click();
    const option = page.getByRole('menuitem', { name: layout.name, exact: true });

    await expectViewCreationAvailable(option);
    await option.click();
    const created = await response;
    const body = await created.json();
    const command = created.request().postDataJSON();
    const viewId = body.data.result.view_id as string;

    expect(serverSchemaChecked).toBe(true);
    expect(command.view).toMatchObject({ database_id: source.databaseId, parent_view_id: source.containerId,
      source_view_id: null, layout: layout.value });
    expect(requests.compact).toHaveLength(1);
    expect(requests.compact[0]).not.toMatch(/encoded_collab|doc_state|field_settings|layout_settings|filters|group_settings/);
    expect(requests.legacy).toEqual([]);
    const assertContent = async () => {
      await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveAttribute('data-state', 'active');
      await ensurePageExpandedByViewId(page, source.containerId);
      await expect(page.getByTestId(`page-${viewId}`)).toHaveAttribute('data-selected', 'true');
      if (layout.value === 0) await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
      if (layout.value === 1) {
        await expect(BoardSelectors.cards(page)).toHaveCount(3);
        for (const rowId of source.rowIds) await expect(BoardSelectors.cardByRowId(page, rowId)).toBeVisible();
      }
      if (layout.value === 2) await expect(CalendarSelectors.calendarContainer(page).locator('.fc-daygrid-day').first()).toBeVisible();
      if (layout.value === 3) {
        await expect(ChartSelectors.chart(page).locator('svg.recharts-surface').or(ChartSelectors.emptyStateNoData(page))).toBeVisible();
        await expect(ChartSelectors.emptyStateNoField(page)).toBeHidden();
      }
      if (layout.value === 5) {
        await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(3);
        for (const rowId of source.rowIds) await expect(DatabaseGallerySelectors.cardByRowId(page, rowId)).toBeVisible();
      }
      if (layout.value === 7) {
        await expect(FormSelectors.autoCreateDialog(page).or(FormSelectors.addQuestionButton(page))).toBeVisible();
        if (await FormSelectors.autoCreateDialog(page).isVisible()) await FormSelectors.autoCreateStartFromScratch(page).click();
        await expect(FormSelectors.addQuestionButton(page)).toBeVisible();
        await expect(FormSelectors.previewButton(page)).toBeEnabled();
      }
      if (layout.value === 8) {
        await expect(TimelineSelectors.view(page)).toBeVisible();
        await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(3);
      }
    };

    await assertContent();
    const screenshot = info.outputPath(`existing-database-layout-${layout.value}.png`);

    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await info.attach('created-view', { path: screenshot, contentType: 'image/png' });
    await page.reload();
    await assertContent();
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(layout.value === 7 ? 3 : 2);
    expect(requests.compact).toHaveLength(1);
  });
}

test('a held source read and lost view ACK preserve selection until exact retry activates readable content', async ({ page, request }) => {
  const source = await createSource(page, request);
  const requests = observeCreations(page);
  const sourceEntered = barrier();
  const releaseSource = barrier();
  const committed = barrier();
  let createdId = '';

  // Hold the real source generation check instead of waiting an arbitrary delay.
  await page.route(`**/database/${source.databaseId}/restore-state`, async (route) => {
    sourceEntered.release();
    await releaseSource.promise;
    await route.continue();
  });
  await page.route(viewRoute, async (route) => {
    const response = await route.fetch();
    const body = await response.json();

    expect(body.code).toBe(0);
    createdId = body.data.result.view_id;
    await route.abort('failed');
    committed.release();
  }, { times: 1 });

  try {
    await addList(page);
    await sourceEntered.promise;
    await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${source.primaryId}`);
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
    expect(requests.compact).toHaveLength(0);
  } finally { releaseSource.release(); }

  await committed.promise;
  await expect(page.getByText('Creation is pending. Retry the original request to finish.', { exact: true })).toBeVisible();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${source.primaryId}`);
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible();

  // Repeat the original UI action: it must discover the pending journal command,
  // not create another ID even if its first committed tab arrived through sync.
  await expect(DatabaseViewSelectors.addViewButton(page)).toBeEnabled();
  await addList(page);
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${createdId}`);
  await expect(DatabaseListSelectors.list(page)).toBeVisible();
  await expect(DatabaseListSelectors.rows(page)).toHaveCount(3);
  for (const rowId of source.rowIds) await expect(DatabaseListSelectors.rowById(page, rowId)).toBeVisible();
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
  await ensurePageExpandedByViewId(page, source.containerId);
  await expect(page.getByTestId(`page-${createdId}`)).toHaveAttribute('data-selected', 'true');
  expect(requests.compact).toHaveLength(2);
  expect(requests.compact[1]).toBe(requests.compact[0]);
  expect(requests.compact[0]).not.toMatch(/encoded_collab|doc_state|field_settings|filters/);
  expect(requests.legacy).toEqual([]);

  // A fresh page load proves the selected view was durably created, including its rows.
  await page.reload();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${createdId}`);
  await expect(DatabaseListSelectors.rows(page)).toHaveCount(3);
  await expect(page.getByTestId(`page-${createdId}`)).toHaveAttribute('data-selected', 'true');
});

test('adding Feed to an existing Grid preserves the database and publishes matching cards, tab and sidebar across reload', async ({ page, request }, info) => {
  const source = await createSource(page, request);
  const requests = observeCreations(page);
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(viewPath));

  await DatabaseViewSelectors.addViewButton(page).click();
  await page.getByTestId('add-feed-view-button').click();
  const created = await response;
  const body = await created.json();
  const command = created.request().postDataJSON();

  // Only this disposable creation payload/response is retained; never include
  // authorization headers or the authentication fixture in test attachments.
  const responsePath = info.outputPath('existing-grid-feed-creation.json');

  await writeFile(responsePath, JSON.stringify({ status: created.status(), command, response: body }, null, 2));
  await info.attach('existing-grid-feed-creation', { path: responsePath, contentType: 'application/json' });
  expect(body.code).toBe(0);
  expect(body.data.result.database_id).toBe(source.databaseId);
  // The add-tab action requests native Feed defaults on the same database;
  // source_view_id is reserved for an explicit copy/linked source recipe.
  expect(command.view).toMatchObject({ database_id: source.databaseId, source_view_id: null,
    parent_view_id: source.containerId, layout: 6, embedded: false });
  expect(requests.compact).toHaveLength(1);
  expect(requests.compact[0]).not.toMatch(/encoded_collab|doc_state|field_settings|filters/);
  expect(requests.legacy).toEqual([]);
  const feedId = body.data.result.view_id as string;

  expect(feedId).toBe(command.view.view_id);
  await expect(DatabaseViewSelectors.viewTab(page, feedId)).toHaveAttribute('data-state', 'active');
  await expect(DatabaseViewSelectors.viewTab(page, feedId)).toContainText('Feed');
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible();
  await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3);
  for (const rowId of source.rowIds) await expect(DatabaseFeedSelectors.cardByRowId(page, rowId)).toBeVisible();
  await ensurePageExpandedByViewId(page, source.containerId);
  await expect(page.getByTestId(`page-${feedId}`)).toHaveAttribute('data-selected', 'true');

  await page.reload();
  await expect(DatabaseViewSelectors.viewTab(page, feedId)).toHaveAttribute('data-state', 'active');
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible();
  await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3);
  for (const rowId of source.rowIds) await expect(DatabaseFeedSelectors.cardByRowId(page, rowId)).toBeVisible();
  await expect(page.getByTestId(`page-${feedId}`)).toHaveAttribute('data-selected', 'true');
  expect(requests.compact).toHaveLength(1);
});

for (const failure of ['offline', 'unavailable capability'] as const) {
  test(`${failure} refuses a database view without changing tabs, selection or existing content`, async ({ page, request }) => {
    const source = await createSource(page, request);
    const requests = observeCreations(page);

    if (failure === 'unavailable capability') {
      await page.route('**/api/server-info**', async (route) => {
        const response = await route.fetch();
        const body = await response.json();

        body.data.enable_atomic_creation = false;
        body.data.enable_atomic_creation_defaults = false;
        await route.fulfill({ response, json: body });
      });
      const capabilities = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/server-info');

      await page.reload();
      await capabilities;
      await waitForGridReady(page);
    }

    // Load the menu while connected so this checks admission at the click, not lazy module loading.
    await DatabaseViewSelectors.addViewButton(page).click();
    await expect(page.getByTestId('add-list-view-button')).toBeVisible();
    if (failure === 'offline') await page.context().setOffline(true);
    try {
      await page.getByTestId('add-list-view-button').click();
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
      if (failure === 'unavailable capability') {
        await expect(page.getByText('Update the server to use this creation feature.', { exact: true })).toBeVisible();
      }
      await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${source.primaryId}`);
      await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);
      await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
      await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
      expect(requests.compact).toEqual([]);
      expect(requests.legacy).toEqual([]);
    } finally { await page.context().setOffline(false); }
  });
}

test('linked Gallery publishes the source database view under the document with matching sidebar and cards', async ({ page, request }) => {
  const source = await createSource(page, request);
  const requests = observeCreations(page);
  const documentResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/v2/page-view/document/default'));

  await page.locator('[data-testid="inline-add-page"]:visible').first().click();
  await AddPageSelectors.addDocumentButton(page).click();
  const documentBody = await (await documentResponse).json();

  expect(documentBody.code).toBe(0);
  const documentId = documentBody.data.result.view_id as string;
  // Sidebar creation first opens the normal ViewModal. Expand that owned document
  // before asserting its sidebar selection or reloading its full-page URL.
  await page.getByRole('dialog').getByRole('button', { name: 'Open as a Page', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(documentId));
  const editor = page.locator(`#editor-${documentId}`);

  await expect(editor).toBeVisible();
  await editor.click();
  await editor.pressSequentially('/linked gallery');
  await page.getByTestId('slash-menu-linkedGallery').click();
  const picker = page.locator('.MuiPopover-paper').filter({ hasText: 'Link to an existing database' });

  await expect(picker).toBeVisible();
  await picker.locator('input').fill(source.name);
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(viewPath));

  await picker.getByText(source.name, { exact: true }).click();
  const created = await response;
  const body = await created.json();
  const command = created.request().postDataJSON();

  expect(body.code).toBe(0);
  expect(command.view).toMatchObject({ database_id: source.databaseId, source_view_id: source.primaryId,
    parent_view_id: documentId, layout: 5, embedded: true });
  const linkedId = body.data.result.view_id as string;

  await expect(editor.getByTestId('database-gallery')).toBeVisible();
  await expect(DatabaseViewSelectors.viewTab(page, linkedId)).toHaveAttribute('data-state', 'active');
  await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(3);
  for (const rowId of source.rowIds) await expect(DatabaseGallerySelectors.cardByRowId(page, rowId)).toBeVisible();
  await ensurePageExpandedByViewId(page, documentId);
  const documentItem = page.locator(`[data-testid="page-item"]:has(> [data-testid="page-${documentId}"])`);

  await expect(documentItem.getByTestId(`page-${linkedId}`)).toBeVisible();
  await expect(page.getByTestId(`page-${documentId}`)).toHaveAttribute('data-selected', 'true');
  expect(requests.compact).toHaveLength(1);
  expect(requests.legacy).toEqual([]);

  await page.reload();
  await expect(editor.getByTestId('database-gallery')).toBeVisible();
  await expect(DatabaseViewSelectors.viewTab(page, linkedId)).toHaveAttribute('data-state', 'active');
  await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(3);
});
