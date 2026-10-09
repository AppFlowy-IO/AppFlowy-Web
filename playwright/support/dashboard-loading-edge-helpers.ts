/**
 * The edges of dashboard loading (`dashboard-loading-edge.feature`,
 * missing-dashboard-tests M7, M10-M12, M17, M23-M27, M29): sources that fail,
 * cannot be reached, cannot be opened or never answer; rows read in pages;
 * charts, boards, calendars and timelines while their rows load; rows a
 * collaborator adds meanwhile; the version-history preview; what leaving
 * keeps; the idle release; a phone.
 *
 * The worlds, the recorders and the checks they share with
 * `dashboard-loading.feature` are in `dashboard-loading-helpers.ts`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- values read inside page.evaluate are untyped. */
import { APIRequestContext, expect, Locator, Page, Request, Route } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import {
  createDashboardOfViews,
  databaseUrlIds,
  expectRequestsSeenFor,
  HOST,
  LOAD_TIMEOUT_MS,
  loadingScenario,
  LoadingWidget,
  loadingWidgets,
  loadStats,
  nameView,
  openDashboardCold,
  prepareLoadingWorkspace,
  readPageRecord,
  recorderOf,
  resetPageRecorder,
  settledResult,
  SLOW_SOURCE_DELAY_MS,
  slowDownSources,
  sourceDatabaseNames,
  viewerOf,
  waitForWidgetData,
  widgetLocatorOf,
  widgetsInViewport,
} from './dashboard-loading-helpers';
import { apiGet, apiPost, clearCachedDatabaseStorage, WIDGET_TIMEOUT } from './dashboard-shared-helpers';
import {
  addFixtureDatabases,
  createDatabaseViewThroughApi,
  createSpace,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  FieldType,
  fixtureDatabase,
  gridDataRows,
  hostDatabase,
  openDatabasePage,
  statusOptionId,
  trashFixtureDatabase,
} from './dashboard-test-helpers';
import { configureView, ViewConfig, waitForViewSync } from './dashboard-usecase-helpers';
import { DatabaseViewSelectors, HeaderSelectors } from './selectors';
import { TestConfig } from './test-config';

// ---------------------------------------------------------------------------
// Widgets by position
// ---------------------------------------------------------------------------

/** "first" … "fourth", "last": a widget by its place in the layout. */
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3 };

export function widgetAt(page: Page, ordinal: string): LoadingWidget {
  const widgets = loadingWidgets(page);
  const index = ordinal === 'last' ? widgets.length - 1 : ORDINALS[ordinal];

  if (index === undefined || !widgets[index]) throw new Error(`The dashboard has no ${ordinal} widget`);
  return widgets[index];
}

/** The widget showing the view named `label`. */
export function widgetLabeled(page: Page, label: string): LoadingWidget {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === label);

  if (!widget) throw new Error(`The dashboard has no "${label}" widget`);
  return widget;
}

/** "first" … "fourth", "last": a source database by the place of its first widget. */
export function sourceAt(page: Page, ordinal: string): string {
  const names = sourceDatabaseNames(page);
  const index = ordinal === 'last' ? names.length - 1 : ORDINALS[ordinal];

  if (index === undefined || !names[index]) throw new Error(`The dashboard has no ${ordinal} source database`);
  return names[index];
}

// ---------------------------------------------------------------------------
// Sources that fail, cannot be reached, cannot be opened or never answer
// ---------------------------------------------------------------------------

/** The row ids of a database, its template rows included, as the server lists them. */
async function serverRowIds(page: Page, request: APIRequestContext, name: string): Promise<string[]> {
  const world = dashboardWorld(page);
  const { databaseId } = fixtureDatabase(page, name);
  const rows = await apiGet<{ id: string }[]>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/database/${databaseId}/row`
  );

  return rows.map((row) => row.id);
}

type UrlMatcher = (url: URL) => boolean;

/** The routes a scenario installed to break a source, by database name, so a later step can lift them. */
const brokenSources = new WeakMap<Page, Map<string, { matcher: UrlMatcher; handler: (route: Route) => unknown }>>();

async function breakSource(page: Page, name: string, matcher: UrlMatcher, handler: (route: Route) => unknown) {
  const viewer = viewerOf(page);
  const broken = brokenSources.get(viewer) ?? new Map();

  brokenSources.set(viewer, broken);
  broken.set(name, { matcher, handler });
  await viewer.route(matcher, handler);
}

/** Lift the route that broke a source: its requests (and its rows' realtime syncs) reach the server again. */
export async function repairSource(page: Page, name: string) {
  const viewer = viewerOf(page);
  const entry = brokenSources.get(viewer)?.get(name);

  expect(entry, `the "${name}" database was never broken in this scenario`).toBeDefined();
  await viewer.unroute(entry?.matcher as UrlMatcher, entry?.handler as (route: Route) => unknown);
  brokenSources.get(viewer)?.delete(name);
  blockedRowSyncs.get(viewer)?.delete(name);
}

/** By database name, the row ids whose realtime sync the page may not ask the server for. */
const blockedRowSyncs = new WeakMap<Page, Map<string, string[]>>();

/**
 * Drop every message the page sends over its realtime connection that names
 * one of these rows: the server never sends their state (a walk that failed
 * falls back to syncing the rows one by one over this connection).
 */
async function blockRowSyncs(page: Page, name: string, rowIds: string[]) {
  const viewer = viewerOf(page);
  let blocked = blockedRowSyncs.get(viewer);

  if (!blocked) {
    const syncs = new Map<string, string[]>();

    blocked = syncs;
    blockedRowSyncs.set(viewer, syncs);
    await viewer.routeWebSocket(/\/ws\//, (socket) => {
      const server = socket.connectToServer();

      // Only what the page sends is filtered; the server's messages pass through.
      socket.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString('latin1');
        const rowIds = Array.from(syncs.values()).flat();

        if (rowIds.some((rowId) => text.includes(rowId))) return;
        server.send(message);
      });
    });
  }

  blocked.set(name, rowIds);
}

/**
 * "The rows of … fail to load": every request for the rows of the database
 * fails: its blob/diff walk, a row document asked for on its own (in the URL,
 * or in the body of a batch sync), and the realtime sync of each row. The
 * database document still loads, so the widget opens and knows how many rows
 * it should list.
 */
export async function failRowsOf(page: Page, request: APIRequestContext, name: string) {
  const { databaseId } = fixtureDatabase(page, name);
  const rowIds = await serverRowIds(page, request, name);
  const blob = new RegExp(`/database/${databaseId}/blob(?:/|$)`);
  const isRowRequest = (url: URL) => blob.test(url.pathname) || rowIds.some((id) => url.pathname.includes(id));
  const handler = async (route: Route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    const body = req.postDataBuffer()?.toString('latin1') ?? '';

    if (
      isRowRequest(url) ||
      (url.pathname.endsWith('/collab/full-sync/batch') && rowIds.some((id) => body.includes(id)))
    ) {
      await route.abort('failed');
      return;
    }

    await route.fallback();
  };

  expect(rowIds.length, `rows of the "${name}" database`).toBeGreaterThan(0);
  await breakSource(page, name, (url) => isRowRequest(url) || url.pathname.endsWith('/collab/full-sync/batch'), handler);
  await blockRowSyncs(page, name, rowIds);
}

/**
 * "Cannot be reached": every request for the database's data fails like a
 * dropped connection (its document, its views and its rows); its permission
 * check still answers, as in `dashboard-widget-chrome.feature`.
 */
export async function makeUnreachable(page: Page, names: string[]) {
  for (const name of names) {
    const ids = databaseUrlIds(page, name);
    const matcher = (url: URL) => !url.pathname.endsWith('/permission') && ids.some((id) => url.pathname.includes(id));

    await breakSource(page, name, matcher, (route) => route.abort('internetdisconnected'));
  }
}

/** Requests held by "never answer" routes; they stay pending until the page closes. */
const heldRoutes = new WeakMap<Page, Route[]>();

/**
 * "Never answer": every request for the database's data (its document, its
 * views, its rows and its permission check) stays pending, as behind a
 * stalled connection.
 */
export async function makeSilent(page: Page, names: string[]) {
  const viewer = viewerOf(page);
  const held = heldRoutes.get(viewer) ?? [];

  heldRoutes.set(viewer, held);
  for (const name of names) {
    const ids = databaseUrlIds(page, name);

    await breakSource(
      page,
      name,
      (url) => ids.some((id) => url.pathname.includes(id)),
      (route) => {
        held.push(route);
      }
    );
  }
}

/** The view of a widget is in the trash: its database page is moved there. */
export async function trashSourceOf(page: Page, request: APIRequestContext, widget: LoadingWidget) {
  await trashFixtureDatabase(page, request, widget.database);
}

/** Move these source databases to a new owner-only space: a member of the dashboard space cannot open them. */
export async function moveToOwnerOnlySpace(page: Page, request: APIRequestContext, names: string[]) {
  const world = dashboardWorld(page);
  const spaceId = await createSpace(
    request,
    world.owner.accessToken,
    world.workspaceId,
    `Owner only ${world.runId}`,
    true
  );

  for (const name of names) {
    const database = fixtureDatabase(page, name);

    await apiPost<void>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/page-view/${database.pageId}/move`,
      { new_parent_view_id: spaceId, prev_view_id: null }
    );
    database.spaceId = spaceId;
  }
}

// ---------------------------------------------------------------------------
// What a widget shows
// ---------------------------------------------------------------------------

const PLACEHOLDER_TEXT: Record<string, string> = {
  'not-found': 'This view no longer exists',
  'no-access': "You don't have access to this database",
  offline: "Available when you're back online",
};

/** The widget shows the placeholder for `reason`, with its text. */
export async function expectPlaceholder(page: Page, widget: LoadingWidget, reason: string) {
  const placeholder = widgetLocatorOf(page, widget).getByTestId('dashboard-widget-placeholder');

  expect(PLACEHOLDER_TEXT[reason], `a "${reason}" placeholder`).toBeDefined();
  await expect(placeholder).toHaveAttribute('data-reason', reason, { timeout: LOAD_TIMEOUT_MS });
  await expect(placeholder).toContainText(PLACEHOLDER_TEXT[reason]);
}

/** Each widget lists rows of its database within `timeout`. */
export async function expectWidgetsShowRows(page: Page, widgets: LoadingWidget[], timeout = LOAD_TIMEOUT_MS) {
  await Promise.all(
    widgets.map((widget) =>
      expect(
        gridDataRows(widgetLocatorOf(page, widget)).first(),
        `the "${widget.label}" widget shows no rows`
      ).toBeVisible({
        timeout,
      })
    )
  );
}

/** Design rule R8: a real failure says so, with a retry. */
export const ROWS_NOT_LOADED_TEXT = "Some rows haven't loaded yet";

/** The widget says its rows could not be loaded ("Some rows haven't loaded yet") and offers a retry. */
export async function expectRowsNotLoadedMessage(page: Page, widget: LoadingWidget) {
  const box = widgetLocatorOf(page, widget);

  await expect(
    box.getByText(ROWS_NOT_LOADED_TEXT),
    `the "${widget.label}" widget never said its rows failed`
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(retryButton(box), `the "${widget.label}" widget offers no retry`).toBeVisible();
}

function retryButton(box: Locator): Locator {
  return box.getByRole('button', { name: /retry/i });
}

/** The widget shows no "no rows" or "no data" result: no empty grid, no empty chart, no empty number. */
export async function expectNoNoRowsResult(page: Page, widget: LoadingWidget) {
  const box = widgetLocatorOf(page, widget);

  await expect(
    box.locator(
      [
        '[data-testid="database-grid"][data-row-count="0"]',
        '[data-testid="chart-no-data"]',
        '[data-testid="number-chart-empty"]',
      ].join(', ')
    )
  ).toHaveCount(0);
  const { samples } = await readPageRecord(page);

  expect(
    samples.filter((sample) => sample.id === widget.id && sample.empty).map((sample) => sample.t),
    `the "${widget.label}" widget looked empty`
  ).toEqual([]);
}

export async function retryWidget(page: Page, widget: LoadingWidget) {
  await retryButton(widgetLocatorOf(page, widget)).click();
}

/** No widget was seen in an empty state so far, by the app's counter and by the page's looks. */
export async function expectNoEmptyStateSoFar(page: Page) {
  const widgets = loadingWidgets(page);
  const stats = await loadStats(page);
  const { samples } = await readPageRecord(page);

  expect(samples.length, 'looks at the widgets').toBeGreaterThan(0);
  expect(
    widgets.filter((widget) => (stats.emptyStateSamples[widget.id] ?? 0) > 0).map((widget) => widget.label),
    'widgets the app saw in an empty state before they completed'
  ).toEqual([]);
  expect(
    samples
      .filter((sample) => sample.empty)
      .map((sample) => widgets.find((widget) => widget.id === sample.id)?.label ?? sample.id),
    'widgets that looked empty'
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// The source load timeout (fix B4)
// ---------------------------------------------------------------------------

/**
 * The shared timeout after which a source whose document or permission
 * probe never settles gives up its load slot (`tokens.json` `loading`).
 */
export function sourceLoadTimeoutMs(): number {
  const timeout = (DASHBOARD_LOADING as Readonly<Record<string, number>>).sourceLoadTimeoutMs;

  expect(
    timeout,
    'tokens.json loading defines no sourceLoadTimeoutMs: a source that never answers holds its slot forever'
  ).toEqual(expect.any(Number));
  return timeout;
}

/** These widgets' databases were not requested, nor the widgets started, before the source load timeout. */
export async function expectNotStartedBeforeLoadTimeout(page: Page, widgets: LoadingWidget[]) {
  const scenario = loadingScenario(page);
  const timeout = sourceLoadTimeoutMs();
  const openedAt = scenario.openedAt as number;

  await viewerOf(page).waitForTimeout(Math.max(0, openedAt + timeout - 1_000 - Date.now()));
  const stats = await loadStats(page);

  for (const widget of widgets) {
    const { databaseId } = fixtureDatabase(page, widget.database);

    expect(
      recorderOf(page)
        .ofSource(databaseId, openedAt)
        .filter((entry) => entry.start < openedAt + timeout)
        .map((entry) => entry.url),
      `requests of the "${widget.database}" database before the source load timeout`
    ).toEqual([]);
    expect(
      stats.widgetStarts.some((start) => start.widgetId === widget.id),
      `the "${widget.label}" widget started before the source load timeout`
    ).toBe(false);
  }
}

/** These widgets list their rows once the source load timeout has passed. */
export async function expectRowsAfterLoadTimeout(page: Page, widgets: LoadingWidget[]) {
  const scenario = loadingScenario(page);
  const timeout = sourceLoadTimeoutMs();

  await expectWidgetsShowRows(
    page,
    widgets,
    Math.max(0, (scenario.openedAt as number) + 2 * timeout + LOAD_TIMEOUT_MS - Date.now())
  );
}

// ---------------------------------------------------------------------------
// The filter menu while widgets wait (fix B6)
// ---------------------------------------------------------------------------

/** Open the dashboard filter menu while at least one widget has not started. */
export async function openFilterMenuBeforeEveryWidgetStarted(page: Page) {
  const viewer = viewerOf(page);
  const total = loadingWidgets(page).length;

  expect((await loadStats(page)).widgetStarts.length, 'widgets that had started').toBeLessThan(total);
  await DashboardSelectors.globalFilterButton(viewer).click();
  await expect(DashboardSelectors.globalFilterMenu(viewer)).toBeVisible();
}

/**
 * The filter menu lists a group of properties for every source database,
 * while some of their widgets have still not started.
 */
export async function expectFilterMenuListsEverySource(page: Page, count: number) {
  const viewer = viewerOf(page);
  const names = sourceDatabaseNames(page);
  const listed = async () =>
    DashboardSelectors.globalFilterSourceGroups(viewer).evaluateAll((groups) =>
      groups.map((group) => group.getAttribute('data-database-id') ?? '')
    );

  expect(names.length, 'source databases of the dashboard').toBe(count);
  // While the slow sources still wait: two at a time, 3 s per response.
  await expect
    .poll(
      async () => {
        const ids = new Set(await listed());

        return names.filter((name) => !ids.has(fixtureDatabase(page, name).databaseId));
      },
      { timeout: 2 * SLOW_SOURCE_DELAY_MS, message: 'source databases the filter menu does not list' }
    )
    .toEqual([]);
  const started = new Set((await loadStats(page)).widgetStarts.map((start) => start.sourceId));

  expect(
    names.filter((name) => !started.has(fixtureDatabase(page, name).databaseId)).length,
    'source databases the menu listed before their widgets started'
  ).toBeGreaterThan(0);
  for (const name of names) {
    const group = DashboardSelectors.globalFilterSourceGroup(viewer, fixtureDatabase(page, name).databaseId);

    await expect(group, `the "${name}" group of the filter menu`).toBeVisible();
  }
}

// ---------------------------------------------------------------------------
// A collaborator's rows while widgets load (G19a)
// ---------------------------------------------------------------------------

const collaboratorRows = new WeakMap<Page, Map<string, string>>();

/** A collaborator adds a row to `name` through the API (the server's copy changes; the browser hears of it). */
export async function addCollaboratorRow(page: Page, request: APIRequestContext, name: string) {
  const world = dashboardWorld(page);
  const { databaseId } = fixtureDatabase(page, name);
  const title = `Added by a collaborator to ${name}`;

  await apiPost<string>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/database/${databaseId}/row`,
    {
      cells: { Name: title },
      document: null,
      parse_link_as_link_preview: false,
    }
  );
  const rows = collaboratorRows.get(page) ?? new Map<string, string>();

  rows.set(name, title);
  collaboratorRows.set(page, rows);
}

/** Wait until the widget of `name` started and has not shown data yet, then let a collaborator add a row. */
export async function addRowWhileLoading(page: Page, request: APIRequestContext, name: string) {
  const widget = loadingWidgets(page).find((candidate) => candidate.database === name) as LoadingWidget;

  await expect
    .poll(async () => (await loadStats(page)).widgetStarts.some((start) => start.widgetId === widget.id), {
      timeout: LOAD_TIMEOUT_MS,
      message: `waiting for the "${widget.label}" widget to start`,
    })
    .toBe(true);
  expect((await readPageRecord(page)).data[widget.id], `the "${widget.label}" widget showed data first`).toBeUndefined();
  await addCollaboratorRow(page, request, name);
}

/** Let a collaborator add a row to `name` while its widget still waits for a slot. */
export async function addRowBeforeStart(page: Page, request: APIRequestContext, name: string) {
  const widget = loadingWidgets(page).find((candidate) => candidate.database === name) as LoadingWidget;

  expect(
    (await loadStats(page)).widgetStarts.some((start) => start.widgetId === widget.id),
    `the "${widget.label}" widget started first`
  ).toBe(false);
  await addCollaboratorRow(page, request, name);
}

/** The widgets of these databases list the rows the collaborator added. */
export async function expectCollaboratorRowsShown(page: Page, names: string[]) {
  const rows = collaboratorRows.get(page) ?? new Map<string, string>();

  for (const name of names) {
    const title = rows.get(name);
    const widget = loadingWidgets(page).find((candidate) => candidate.database === name) as LoadingWidget;

    expect(title, `no collaborator row was added to "${name}"`).toBeDefined();
    await waitForWidgetData(page, [widget]);
    const scroller = widgetLocatorOf(page, widget).locator('[data-parity-id="dash-widget-grid-scrollbar"]');

    // The appended row can be below the virtual grid's mounted range. Reveal
    // it as a viewer would, then restore the top for the source comparison.
    await scroller.scrollIntoViewIfNeeded();
    await scroller.hover();
    await viewerOf(page).mouse.wheel(0, 1000);
    await expect(gridDataRows(widgetLocatorOf(page, widget)).filter({ hasText: title as string })).toHaveCount(1, {
      timeout: LOAD_TIMEOUT_MS,
    });
    await viewerOf(page).mouse.wheel(0, -1000);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  }
}

// ---------------------------------------------------------------------------
// Rows read in pages (M10, M12)
// ---------------------------------------------------------------------------

/** The database read in several blob/diff pages (256 rows a page). */
export const PAGED = 'Paged';
const PAGED_STATUS = ['Todo', 'Doing', 'Done'];

/**
 * A fresh account with a database of `rows` rows, created through the API,
 * with a Status and a Points property and its grid view (`Paged Grid`).
 * Points run 0 to 49 over and over, so one row in 50 has 0 Points.
 */
export async function addPagedDatabase(page: Page, request: APIRequestContext, rows: number) {
  await prepareLoadingWorkspace(page, request);
  const spec = {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect },
      { name: 'Points', type: FieldType.Number },
    ],
    rows: Array.from({ length: rows }, (_, index) => ({
      Name: `${PAGED} ${String(index + 1).padStart(4, '0')}`,
      Status: PAGED_STATUS[index % PAGED_STATUS.length],
      Points: (index * 7) % 50,
    })),
  };

  await addFixtureDatabases(page, request, [PAGED], { [PAGED]: spec }, { prune: false, rowConcurrency: 8 });
  nameView(page, `${PAGED} Grid`, PAGED, fixtureDatabase(page, PAGED).views.Grid);
}

/** Add a view of the paged database with `config`, named `label` for the dashboard. */
async function addPagedView(
  page: Page,
  request: APIRequestContext,
  name: string,
  folderLayout: ViewLayout,
  config: ViewConfig
) {
  const database = fixtureDatabase(page, PAGED);

  await openDatabasePage(page, PAGED);
  const viewId = await createDatabaseViewThroughApi(page, request, { database: PAGED, name, folderLayout });

  await configureView(page, database.databaseId, viewId, config);
  await waitForViewSync(page, request, PAGED, [viewId], () => configureView(page, database.databaseId, viewId, config));
  nameView(page, `${PAGED} ${name}`, PAGED, viewId);
  return viewId;
}

/**
 * A grid of the paged database showing its rows with 0 Points: a few rows
 * per page, so the grid's loading row stays inside the widget while the
 * later pages are read.
 */
export async function addPagedZeroPointsGrid(page: Page, request: APIRequestContext) {
  const database = fixtureDatabase(page, PAGED);

  await addPagedView(page, request, 'Zero points', ViewLayout.Grid, {
    layout: DatabaseViewLayout.Grid,
    // `NumberFilterCondition.Equal`.
    filters: [{ fieldId: database.fieldIds.Points, fieldType: FieldType.Number, condition: 0, content: '0' }],
    sorts: [],
  });
  return `${PAGED} Zero points`;
}

/** The views the next "dashboard showing those views" step shows, by label. */
const pendingViews = new WeakMap<Page, string[]>();

export function rememberViews(page: Page, labels: string[]) {
  pendingViews.set(page, labels);
}

/** A dashboard of the views the scenario just made, in one row. */
export async function createDashboardOfRememberedViews(page: Page, request: APIRequestContext, count: number) {
  const labels = pendingViews.get(page) ?? [];

  expect(labels, 'the views the scenario made for the dashboard').toHaveLength(count);
  await createDashboardOfViews(page, request, [labels]);
}

/** A Number chart summing Points and a bar chart counting rows by Status, on the paged database. */
export async function addPagedNumberAndBarChart(page: Page, request: APIRequestContext) {
  const database = fixtureDatabase(page, PAGED);

  await addPagedView(page, request, 'Points sum', ViewLayout.Chart, {
    layout: DatabaseViewLayout.Chart,
    filters: [],
    sorts: [],
    // Number chart (4), Sum (1) of Points.
    chart: { chartType: 4, xFieldId: '', aggregationType: 1, yFieldId: database.fieldIds.Points },
  });
  await addPagedView(page, request, 'By status', ViewLayout.Chart, {
    layout: DatabaseViewLayout.Chart,
    filters: [],
    sorts: [],
    // Bar chart (0), Count (0) by Status.
    chart: { chartType: 0, xFieldId: database.fieldIds.Status, aggregationType: 0, yFieldId: '' },
  });
  return [`${PAGED} Points sum`, `${PAGED} By status`];
}

/** The rows of the paged database the server holds (the template rows included). */
export async function pagedRowCount(page: Page, request: APIRequestContext) {
  return (await serverRowIds(page, request, PAGED)).length;
}

/** Every blob/diff page of these databases after the first answers `delayMs` later. */
export async function slowPagesAfterFirst(page: Page, names: string[], delayMs = 1_500) {
  const viewer = viewerOf(page);
  const ids = names.map((name) => fixtureDatabase(page, name).databaseId);
  const seen = new Map<string, number>();

  await viewer.route(
    (url) => ids.some((id) => new RegExp(`/database/${id}/blob(?:/|$)`).test(url.pathname)),
    async (route: Route) => {
      const id = ids.find((candidate) => route.request().url().includes(candidate)) as string;
      const index = seen.get(id) ?? 0;

      seen.set(id, index + 1);
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue().catch(() => undefined);
    }
  );
}

/** Open the dashboard with nothing cached, every blob/diff page of its sources after the first slow. */
export async function openWithSlowPages(page: Page) {
  await clearCachedDatabaseStorage(viewerOf(page));
  await slowPagesAfterFirst(page, sourceDatabaseNames(page));
  await openDashboardCold(page);
}

/** One look at a widget's loading row: the text and the counts it shows. */
interface LoadingRowLook {
  t: number;
  text: string;
  loaded: number;
  total: number;
}

const loadingRowLooks = new WeakMap<Page, LoadingRowLook[]>();

/** Look at the widget's loading row every 100 ms until it is gone for good (or the timeout). */
async function watchLoadingRow(page: Page, widget: LoadingWidget): Promise<LoadingRowLook[]> {
  const known = loadingRowLooks.get(page);

  if (known) return known;
  const box = widgetLocatorOf(page, widget);
  const looks: LoadingRowLook[] = [];
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let goneSince: number | null = null;

  while (Date.now() < deadline) {
    const look = await box
      .locator('[data-testid="grid-loading-indicator"]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          text: (row.textContent ?? '').trim(),
          loaded: Number(row.getAttribute('data-loaded-row-count')),
          total: Number(row.getAttribute('data-total-row-count')),
        }))
      )
      .catch(() => []);

    if (look.length > 0) {
      looks.push({ t: Date.now(), ...look[0] });
      goneSince = null;
    } else if (looks.length > 0) {
      goneSince ??= Date.now();
      if (Date.now() - goneSince > 2_000) break;
    }

    await page.waitForTimeout(100);
  }

  loadingRowLooks.set(page, looks);
  return looks;
}

/** The widget shows a loading row reading "Loading rows… N/M" with real counts. */
export async function expectLoadingRowCounts(page: Page, widget: LoadingWidget, pattern: string) {
  expect(pattern, 'the loading row text of the design (R8)').toBe('Loading rows… N/M');
  const looks = await watchLoadingRow(page, widget);
  const counted = looks.filter((look) => Number.isFinite(look.loaded) && Number.isFinite(look.total) && look.total > 0);

  expect(counted.length, `looks at the "${widget.label}" loading row with counts`).toBeGreaterThan(0);
  for (const look of counted) {
    expect(look.text, 'the loading row text').toBe(`Loading rows… ${look.loaded}/${look.total}`);
  }

  expect(
    counted.some((look) => look.loaded < look.total),
    'the loading row never showed a count below its total'
  ).toBe(true);
}

/** The count only grows, and the total is the row count of the database. */
export async function expectLoadingRowGrowsToTotal(page: Page, widget: LoadingWidget, total: number) {
  const looks = (await watchLoadingRow(page, widget)).filter((look) => look.total > 0);

  expect(looks.length, `looks at the "${widget.label}" loading row`).toBeGreaterThan(0);
  looks.forEach((look, index) => {
    if (index > 0)
      expect(look.loaded, 'the loading row count went down').toBeGreaterThanOrEqual(looks[index - 1].loaded);
    expect(look.total, 'the loading row total').toBe(total);
    expect(look.loaded, 'the loading row count passed its total').toBeLessThanOrEqual(total);
  });
}

/**
 * The loading row is gone within `withinMs` of the last row arriving (the
 * first look counting every row of the database), and stays gone: the grid
 * ends with its row count and no loading row.
 */
export async function expectNoLoadingRowAfterLastRow(page: Page, widget: LoadingWidget, withinMs: number) {
  const looks = await watchLoadingRow(page, widget);
  const box = widgetLocatorOf(page, widget);
  const lastLook = looks[looks.length - 1];
  const allRead = looks.find((look) => look.total > 0 && look.loaded >= look.total);

  expect(lastLook, `the "${widget.label}" loading row never showed`).toBeDefined();
  // The watch ends once the loading row has been gone for 2 s, or at its timeout.
  await expect(box.getByTestId('grid-loading-indicator'), `the "${widget.label}" loading row stayed`).toHaveCount(0);
  await expect(box.getByTestId('database-grid')).toHaveAttribute('data-row-count', /^\d+$/);
  if (allRead) {
    expect(lastLook.t - allRead.t, `ms the "${widget.label}" loading row stayed after its last row`).toBeLessThanOrEqual(
      withinMs
    );
  }
}

/**
 * Until the rows finished loading, the widget showed a loading state or its
 * final result, never another (partial) value; and never "No data".
 */
export async function expectOnlyLoadingOrFinal(page: Page, widget: LoadingWidget, what: 'number' | 'chart') {
  const final = await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`);
  const finalLook = (await readPageRecord(page)).samples
    .filter((sample) => sample.id === widget.id && sample.result)
    .pop();

  expect(final.startsWith(what), `the "${widget.label}" widget shows a ${what}`).toBe(true);
  expect(finalLook, `the "${widget.label}" widget was never seen with its result`).toBeDefined();
  const complete = (await loadStats(page)).widgetComplete[widget.id] ?? Number.POSITIVE_INFINITY;
  const looks = (await readPageRecord(page)).samples.filter((sample) => sample.id === widget.id && sample.t < complete);
  const partial = looks.filter(
    (sample) => !sample.loading && sample.result !== (finalLook as { result: string }).result
  );

  expect(looks.length, `looks at the "${widget.label}" widget while its rows loaded`).toBeGreaterThan(0);
  expect(
    partial.map(
      (sample) =>
        `${sample.result || (sample.empty ? 'empty' : 'nothing')} at ${sample.t} (header ${sample.header}, placeholder ${
          sample.placeholder
        }, loading ${sample.loading}, data ${sample.hasData}, complete at ${complete})`
    ),
    `the "${widget.label}" widget showed another result before its rows finished loading`
  ).toEqual([]);
}

/** Neither widget said "No data" before its rows finished loading. */
export async function expectNoNoDataBeforeComplete(page: Page, widgets: LoadingWidget[]) {
  const stats = await loadStats(page);
  const { samples } = await readPageRecord(page);

  for (const widget of widgets) {
    const complete = stats.widgetComplete[widget.id];

    expect(complete, `the "${widget.label}" widget never completed`).toBeDefined();
    expect(
      samples
        .filter((sample) => sample.id === widget.id && sample.t < complete && sample.empty)
        .map((s) => s.t),
      `the "${widget.label}" widget said "No data" before its rows finished loading`
    ).toEqual([]);
    expect(stats.emptyStateSamples[widget.id] ?? 0, `empty states of the "${widget.label}" widget (the app)`).toBe(0);
  }
}

// ---------------------------------------------------------------------------
// Boards, calendars and timelines (M27)
// ---------------------------------------------------------------------------

/** The database of the date views. */
export const DATED = 'Dated';

/**
 * A small database whose rows have a Date (and an End date) in the current
 * month, with a board by Status, a calendar and a timeline view.
 */
export async function addDatedDatabaseWithViews(page: Page, request: APIRequestContext) {
  await prepareLoadingWorkspace(page, request);
  const today = new Date();
  const offsets = [0, 1, 2, -1, 3, -2].map((offset) => {
    // Stay inside this month, whatever the day.
    const day = today.getDate() + offset;
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

    return day < 1 || day > last ? -offset : offset;
  });
  const spec = {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect },
      { name: 'Date', type: FieldType.DateTime },
      { name: 'End', type: FieldType.DateTime },
    ],
    rows: offsets.map((offset, index) => ({
      Name: `${DATED} ${index + 1}`,
      Status: PAGED_STATUS[index % PAGED_STATUS.length],
      Date: { dayOffset: offset },
      End: { dayOffset: offset + 1 },
    })),
  };

  // The server's template rows have no date: they go, so every row has a card, an event and a bar.
  await addFixtureDatabases(page, request, [DATED], { [DATED]: spec });
  const database = fixtureDatabase(page, DATED);
  const views: [string, ViewLayout, ViewConfig][] = [
    [
      'Board',
      ViewLayout.Board,
      {
        layout: DatabaseViewLayout.Board,
        filters: [],
        sorts: [],
        group: {
          fieldId: database.fieldIds.Status,
          fieldType: FieldType.SingleSelect,
          columnIds: [database.fieldIds.Status, ...PAGED_STATUS.map(statusOptionId)],
        },
      },
    ],
    [
      'Calendar',
      ViewLayout.Calendar,
      { layout: DatabaseViewLayout.Calendar, filters: [], sorts: [], calendarFieldId: database.fieldIds.Date },
    ],
    [
      'Timeline',
      ViewLayout.Timeline,
      {
        layout: DatabaseViewLayout.Timeline,
        filters: [],
        sorts: [],
        timeline: { fieldId: database.fieldIds.Date, endFieldId: database.fieldIds.End },
      },
    ],
  ];

  await openDatabasePage(page, DATED);
  const created: { viewId: string; config: ViewConfig }[] = [];

  for (const [name, layout, config] of views) {
    const viewId = await createDatabaseViewThroughApi(page, request, { database: DATED, name, folderLayout: layout });

    await configureView(page, database.databaseId, viewId, config);
    created.push({ viewId, config });
    nameView(page, `${DATED} ${name}`, DATED, viewId);
  }

  await waitForViewSync(
    page,
    request,
    DATED,
    created.map(({ viewId }) => viewId),
    async () => {
      for (const { viewId, config } of created) await configureView(page, database.databaseId, viewId, config);
    }
  );
  return views.map(([name]) => `${DATED} ${name}`);
}

/** Until its rows arrived, each widget showed a loading state or its rows: never an empty board, month or lane. */
export async function expectLoadingNeverEmpty(page: Page) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);

  await waitForWidgetData(page, widgets);
  const { data, samples } = await readPageRecord(page);

  for (const widget of widgets) {
    const looks = samples.filter((sample) => sample.id === widget.id && sample.t < data[widget.id]);

    expect(looks.length, `looks at the "${widget.label}" widget before its rows arrived`).toBeGreaterThan(0);
    expect(
      looks
        .filter((sample) => !sample.loading || sample.empty)
        .map(
          (sample) =>
            `${sample.t - (scenario.openedAt ?? 0)} ms (header ${sample.header}, placeholder ${sample.placeholder}, loading ${
              sample.loading
            }, empty ${sample.empty}, data ${sample.hasData})`
        ),
      `the "${widget.label}" widget looked empty (no loading state) before its rows arrived`
    ).toEqual([]);
  }
}

/** Each widget ends with every row of its database: a card, an event or a bar per row. */
export async function expectEveryRowShown(page: Page, request: APIRequestContext) {
  const total = (await serverRowIds(page, request, DATED)).length;
  const selectors: Record<string, string> = {
    Board: '.board-card',
    Calendar: '.fc-event',
    Timeline: '[data-testid^="timeline-bar-"]:not([data-testid="timeline-bar-hover-card"])',
  };

  for (const widget of loadingWidgets(page)) {
    const kind = widget.label.slice(`${DATED} `.length);

    await expect(
      widgetLocatorOf(page, widget).locator(selectors[kind]),
      `rows the "${widget.label}" widget shows`
    ).toHaveCount(total, { timeout: LOAD_TIMEOUT_MS });
  }
}

// ---------------------------------------------------------------------------
// The version-history preview (M23)
// ---------------------------------------------------------------------------

/** The server reads these on history requests (`version-history-restore.spec.ts`). */
const HISTORY_CLIENT_HEADERS = { 'client-version': '0.18.10', 'x-platform': 'web' };
const SAVED_VERSION_NAME = 'Before the loading check';

async function historyData<T>(response: { ok(): boolean; status(): number; text(): Promise<string> }, what: string) {
  const text = await response.text();
  const body = JSON.parse(text || '{}') as { code?: number; data?: T };

  if (!response.ok() || body.code !== 0) throw new Error(`${what} failed: HTTP ${response.status()} ${text}`);
  return body.data as T;
}

/** Save a named version of the dashboard's database through the history API. */
export async function saveHostVersion(page: Page, request: APIRequestContext) {
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const headers = { ...HISTORY_CLIENT_HEADERS, Authorization: `Bearer ${world.owner.accessToken}` };
  const capabilities = await historyData<{ enable_database_history?: boolean }>(
    await request.get(`${TestConfig.apiUrl}/api/server-info`, { headers: HISTORY_CLIENT_HEADERS }),
    'Reading the server capabilities'
  );

  expect(capabilities.enable_database_history, 'database version history needs the server capability').toBe(true);
  const base = `${TestConfig.apiUrl}/api/workspace/${world.workspaceId}/database/${host.databaseId}`;

  await historyData(await request.get(`${base}/blob/generate`, { headers }), 'Generating the database snapshot source');
  await historyData(
    await request.post(`${base}/history`, { headers, data: { name: SAVED_VERSION_NAME } }),
    'Saving a version'
  );
}

const historyModal = (page: Page) => page.getByTestId('database-version-history-modal');

/**
 * Open the dashboard's database on its grid view with nothing cached, then
 * its version history, and preview the dashboard view of the saved version.
 */
export async function previewDashboardInHistory(page: Page) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);
  const world = dashboardWorld(page);
  const host = hostDatabase(page);

  await clearCachedDatabaseStorage(viewer);
  // A development build reports version 0.0.0, to which the server offers no database history:
  // ask as the released client the history API calls above name.
  await viewer.route('**/api/server-info', (route) =>
    route.continue({ headers: { ...route.request().headers(), ...HISTORY_CLIENT_HEADERS } })
  );
  scenario.openedAt = Date.now();
  await viewer.goto(`/app/${world.workspaceId}/${host.pageId}?v=${host.views.Grid}`, { waitUntil: 'domcontentloaded' });
  await expect(DatabaseViewSelectors.viewTab(viewer, host.views.Grid)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(HeaderSelectors.moreActionsButton(viewer)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  // The menu offers the history once the app knows the server keeps database history: open it again until then.
  const historyItem = viewer.getByTestId('more-page-database-history');

  await expect
    .poll(
      async () => {
        if (!(await historyItem.isVisible())) {
          await viewer.keyboard.press('Escape');
          await HeaderSelectors.moreActionsButton(viewer).click();
        }

        return historyItem
          .waitFor({ state: 'visible', timeout: 2_000 })
          .then(() => true)
          .catch(() => false);
      },
      { timeout: 60_000, intervals: [1_000], message: 'the More menu offers no version history' }
    )
    .toBe(true);
  await historyItem.click();
  const history = historyModal(viewer);

  await expect(history).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await history.getByTestId('database-history-version').filter({ hasText: SAVED_VERSION_NAME }).first().click();
  const tab = history.getByTestId(`view-tab-${dashboardViewId(page)}`);

  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
}

/** The preview explains that dashboards are not previewed and mounts no widget. */
export async function expectHistoryPlaceholderWithoutWidgets(page: Page) {
  const history = historyModal(viewerOf(page));
  const placeholder = history.getByTestId('dashboard-history-placeholder');

  await expect(placeholder).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(placeholder).toContainText('Dashboards are not previewed in version history.');
  await expect(history.getByTestId('dashboard-widget')).toHaveCount(0);
}

/** No source database was requested since the database opened, while the preview stayed open; no widget started. */
export async function expectNoSourceRequestDuringPreview(page: Page) {
  const scenario = loadingScenario(page);

  // Room for a widget that would load late.
  await viewerOf(page).waitForTimeout(2 * SLOW_SOURCE_DELAY_MS);
  await expect(historyModal(viewerOf(page))).toBeVisible();
  const stats = await loadStats(page);

  expect(
    recorderOf(page)
      .since(scenario.openedAt ?? 0)
      .map((entry) => `${entry.kind} ${entry.url}`),
    'source database requests while the history preview was open'
  ).toEqual([]);
  expect(stats.widgetStarts, 'dashboard widgets that started in the preview').toEqual([]);
}

// ---------------------------------------------------------------------------
// What leaving keeps (M24)
// ---------------------------------------------------------------------------

interface PageWeight {
  nodes: number;
  listeners: number;
}

const firstVisitWeight = new WeakMap<Page, PageWeight>();

/** Open the dashboard tab inside the app, wait until every widget completed, and go back to the grid tab. */
export async function visitDashboardAndLeave(page: Page) {
  const viewer = viewerOf(page);
  const host = hostDatabase(page);
  const widgets = loadingWidgets(page);

  if (!(await DashboardSelectors.view(viewer).isVisible())) {
    await DatabaseViewSelectors.viewTab(viewer, dashboardViewId(page)).click();
  }

  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(widgets.length, WIDGET_TIMEOUT);
  for (const widget of widgets) await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`);
  await DatabaseViewSelectors.viewTab(viewer, host.views.Grid).click();
  await expect(DashboardSelectors.view(viewer)).toHaveCount(0, WIDGET_TIMEOUT);
}

/** The page's live DOM nodes and event listeners after a full garbage collection (Chromium's metrics). */
async function pageWeight(page: Page): Promise<PageWeight> {
  const viewer = viewerOf(page);
  const session = await viewer.context().newCDPSession(viewer);

  try {
    await session.send('Performance.enable');
    // Let the unmount's deferred cleanups run before collecting.
    await viewer.waitForTimeout(2_000);
    await session.send('HeapProfiler.collectGarbage');
    await session.send('HeapProfiler.collectGarbage');
    const { metrics } = await session.send('Performance.getMetrics');
    const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value;
    const nodes = metric('Nodes');
    const listeners = metric('JSEventListeners');

    expect(nodes, 'the Nodes metric').toEqual(expect.any(Number));
    expect(listeners, 'the JSEventListeners metric').toEqual(expect.any(Number));
    return { nodes: nodes as number, listeners: listeners as number };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function rememberFirstVisitWeight(page: Page) {
  firstVisitWeight.set(page, await pageWeight(page));
}

/** After the later visits the page holds at most `percent` more nodes and listeners than after the first. */
export async function expectWeightWithin(page: Page, percent: number) {
  const first = firstVisitWeight.get(page);

  expect(first, 'the page was not measured after the first visit').toBeDefined();
  const now = await pageWeight(page);
  const limit = (value: number) => Math.ceil(value * (1 + percent / 100));

  expect(now.nodes, `DOM nodes after the later visits (first: ${first?.nodes})`).toBeLessThanOrEqual(
    limit((first as PageWeight).nodes)
  );
  expect(now.listeners, `event listeners after the later visits (first: ${first?.listeners})`).toBeLessThanOrEqual(
    limit((first as PageWeight).listeners)
  );
}

// ---------------------------------------------------------------------------
// The idle release (M25)
// ---------------------------------------------------------------------------

/** The source databases the app has not released for being idle yet (its counter). */
async function sourcesNotReleasedIdle(page: Page): Promise<string[]> {
  const stats = await loadStats(page);
  const released = new Set(
    stats.sourcesReleased.filter((entry) => entry.reason === 'idle').map((entry) => entry.sourceId)
  );

  return sourceDatabaseNames(page).filter((name) => !released.has(fixtureDatabase(page, name).databaseId));
}

/** Room past `sourceIdleReleaseMs` for the release timers to fire. */
const IDLE_RELEASE_SLACK_MS = 30_000;

/**
 * Leave the dashboard for the host's grid tab (inside the app) and stay
 * there until the app released every source database for being idle: not
 * before `sourceIdleReleaseMs`, and not much later.
 */
export async function stayAwayUntilIdleRelease(page: Page) {
  const viewer = viewerOf(page);
  const idleMs = DASHBOARD_LOADING.sourceIdleReleaseMs;

  await DatabaseViewSelectors.viewTab(viewer, fixtureDatabase(page, HOST).views.Grid).click();
  await expect(DashboardSelectors.view(viewer)).toHaveCount(0, WIDGET_TIMEOUT);
  const leftAt = Date.now();

  expect(await sourcesNotReleasedIdle(page), 'source databases released for being idle at once').toEqual(
    sourceDatabaseNames(page)
  );
  await expect
    .poll(() => sourcesNotReleasedIdle(page), {
      timeout: idleMs + IDLE_RELEASE_SLACK_MS,
      intervals: [1_000],
      message: 'source databases not released for being idle',
    })
    .toEqual([]);
  // The poll saw the release no earlier than it happened.
  expect(Date.now() - leftAt, 'ms until every source database was released for being idle').toBeGreaterThanOrEqual(
    idleMs
  );
}

/**
 * Open the dashboard tab again inside the app, every response of its source
 * databases held back 3 s, and record the open from the start.
 */
export async function returnToDashboardWhileSlow(page: Page) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);

  await slowDownSources(
    page,
    Object.fromEntries(sourceDatabaseNames(page).map((name) => [name, SLOW_SOURCE_DELAY_MS] as const))
  );
  await resetPageRecorder(page);
  scenario.openedAt = Date.now();
  await DatabaseViewSelectors.viewTab(viewer, dashboardViewId(page)).click();
  await expect(DashboardSelectors.view(viewer)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(viewer));
}

/** Every source database took a load slot again after the return, and the recorder saw it load. */
export async function expectEverySourceTookASlot(page: Page) {
  const scenario = loadingScenario(page);

  await waitForWidgetData(page, loadingWidgets(page));
  const stats = await loadStats(page);
  const ids = sourceDatabaseNames(page).map((name) => fixtureDatabase(page, name).databaseId);
  const loaded = new Set(
    stats.sourceLoads.filter((load) => load.start >= (scenario.openedAt ?? 0)).map((load) => load.sourceId)
  );

  expect(
    sourceDatabaseNames(page).filter((name) => !loaded.has(fixtureDatabase(page, name).databaseId)),
    'source databases that loaded without a slot after the idle release'
  ).toEqual([]);
  expectRequestsSeenFor(page, ids);
}

// ---------------------------------------------------------------------------
// A phone (M29)
// ---------------------------------------------------------------------------

export const PHONE_VIEWPORT = { width: 390, height: 844 };

/** Open the dashboard at phone size, with nothing cached and every source slow. */
export async function openOnPhoneWhileSlow(page: Page) {
  await viewerOf(page).setViewportSize(PHONE_VIEWPORT);
  await openDashboardCold(page, sourceDatabaseNames(page));
}

/** Every widget spans the width of the dashboard, one per line. */
export async function expectStackedOnePerLine(page: Page) {
  const viewer = viewerOf(page);
  const boxes = await DashboardSelectors.widgets(viewer).evaluateAll((widgets) =>
    widgets.map((widget) => {
      const rect = widget.getBoundingClientRect();

      return { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) };
    })
  );

  expect(boxes.length, 'widgets').toBe(loadingWidgets(page).length);
  expect(new Set(boxes.map((box) => box.top)).size, 'widgets sharing a line').toBe(boxes.length);
  expect(new Set(boxes.map((box) => box.left)).size, 'widget columns').toBe(1);
  expect(await widgetsInViewport(viewer), 'widgets in view at the open').not.toHaveLength(boxes.length);
}
