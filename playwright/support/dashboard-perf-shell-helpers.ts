/**
 * A dashboard inside its own source database (`dashboard-perf-shell.spec.ts`,
 * performance report W2 and W25): a Dashboard view of the 5,000-row employees
 * database holding its 12 loading views in 4 rows of 3, so its widgets are
 * all widgets of the host database.
 *
 * The world, the recorders and the counters are those of the loading
 * scenarios (`dashboard-loading-helpers.ts`); this file adds the dashboard
 * view inside the employees database, the view-meta request recorder and the
 * checks of the two fixes:
 *
 * - W2: the host's widgets start visible first, like any other source, and
 *   take no load slot;
 * - W25: the widget headers read their folder metadata from what the app
 *   holds, or ask for it in one batched request, never one
 *   `GET /view/{id}?depth=1` per widget.
 *
 * And, on the production preview only (`isDashboardPerfMode`), the time
 * budgets of that cold open (PERFORMANCE-REPORT 4.3 B, targets after W2).
 */
import { APIRequestContext, expect, Page, Request } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { ViewLayout } from '../../src/application/types';

import {
  adoptEmployeesWorkspace,
  EMPLOYEES,
  ensureEmployeesViews,
  LOAD_TIMEOUT_MS,
  LoadingWidget,
  loadingScenario,
  loadingWidgets,
  loadStats,
  visibleWidgets,
  widgetsBelowTheFold,
  widgetsInViewport,
} from './dashboard-loading-helpers';
import { LongTaskSummary, readLongTasks, startLongTasks } from './dashboard-perf-probe';
import { apiGet, clearCachedDatabaseStorage } from './dashboard-shared-helpers';
import {
  createDatabaseViewThroughApi,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  fixtureDatabase,
  leaveEditMode,
  listFolderViews,
  openDashboard,
  seedDashboardWidgets,
  waitForDashboardSync,
} from './dashboard-test-helpers';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from './employees-database';

import type { DashboardLoadStatsSnapshot } from '../../src/application/database-yjs/dashboard-load-stats';

/** The Dashboard view inside the employees database. Reused by name, so runs do not add views to the shared database. */
export const HOSTED_DASHBOARD_NAME = 'Perf shell dashboard';
/** Widgets per dashboard row: 12 views in 4 rows of 3. */
const WIDGETS_PER_ROW = 3;
/** Seeding or reusing the employees database, its 12 views and the dashboard. */
export const HOSTED_DASHBOARD_SETUP_TIMEOUT_MS = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// The dashboard inside the employees database
// ---------------------------------------------------------------------------

/** The folder view new employees views go under: the database container when the page has one. */
async function employeesViewParent(page: Page, request: APIRequestContext): Promise<string> {
  type FolderView = { parent_view_id?: string; extra?: unknown };
  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);
  const base = `/api/workspace/${world.workspaceId}`;
  const isContainer = (view: FolderView) => {
    const extra = typeof view.extra === 'string' ? JSON.parse(view.extra || '{}') : view.extra;

    return Boolean((extra as { is_database_container?: boolean } | undefined)?.is_database_container);
  };

  const view = await apiGet<FolderView>(request, world.owner.accessToken, `${base}/view/${employees.pageId}?depth=0`);
  const parentId = view.parent_view_id;

  if (!parentId) return employees.pageId;
  const parent = await apiGet<FolderView>(request, world.owner.accessToken, `${base}/view/${parentId}?depth=0`);

  return isContainer(parent) ? parentId : employees.pageId;
}

/**
 * The employees database open as the scenario world, with its 12 loading
 * views and a Dashboard view of its own holding them in 4 rows of 3, open in
 * View mode with the layout saved on the server. The scenario's widgets are
 * recorded in layout order (`loadingWidgets`).
 */
export async function prepareHostedEmployeesDashboard(page: Page, request: APIRequestContext) {
  const seeded = await openSeededEmployeesDatabase(page, request);

  // Earlier scenarios may have filtered or sorted its views.
  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
  await ensureEmployeesViews(page, request);

  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);
  const labels = Object.keys(world.viewsByName ?? {}).filter((label) => label.startsWith(`${EMPLOYEES} `));

  expect(labels, 'the 12 employees loading views').toHaveLength(12);
  const folderViews = await listFolderViews(request, world.owner.accessToken, world.workspaceId, employees.databaseId);
  const existing = folderViews.find(
    (view) => view.name === HOSTED_DASHBOARD_NAME && view.layout === ViewLayout.Dashboard
  );

  world.dashboardViewId =
    existing?.view_id ??
    (await createDatabaseViewThroughApi(page, request, {
      database: EMPLOYEES,
      name: HOSTED_DASHBOARD_NAME,
      folderLayout: ViewLayout.Dashboard,
      parentViewId: await employeesViewParent(page, request),
    }));
  world.dashboardHost = EMPLOYEES;
  await openDashboard(page);

  const rows = Array.from({ length: labels.length / WIDGETS_PER_ROW }, (_, index) =>
    labels.slice(index * WIDGETS_PER_ROW, (index + 1) * WIDGETS_PER_ROW)
  );

  await seedDashboardWidgets(
    page,
    rows.flatMap((rowLabels, index) => rowLabels.map((label) => ({ row: index + 1, label })))
  );
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);

  loadingScenario(page).widgets = rows.flatMap((rowLabels, index) =>
    rowLabels.map((label): LoadingWidget => {
      const known = world.widgets[label];
      const named = world.viewsByName?.[label];

      if (!known || !named) throw new Error(`The dashboard has no "${label}" widget`);
      return { id: known.id, label, database: named.database, viewId: named.viewId, row: index + 1 };
    })
  );
}

// ---------------------------------------------------------------------------
// View-meta requests (W25)
// ---------------------------------------------------------------------------

export interface ViewMetaRequests {
  /** `GET /api/workspace/{workspace}/view/{view}?depth=1`: one view's folder metadata. */
  perView: string[];
  /** `GET` or `POST /api/workspace/{workspace}/views` naming at least one widget view: the batched read. */
  batched: string[];
  /** Stops recording. */
  stop: () => void;
}

const PER_VIEW_META_PATH = /^\/api\/workspace\/[^/]+\/view\/[^/]+$/;
const BATCHED_VIEWS_PATH = /^\/api\/workspace\/[^/]+\/views$/;
/** No new view-meta request for this long: the page asked for everything it shows. */
const VIEW_META_QUIET_MS = 1_500;

/** The view ids a batched views request names (`view_ids` in the query, or in a POST body). */
function batchedViewIds(request: Request, url: URL): string[] {
  const query = url.searchParams.get('view_ids');

  if (query) return query.split(',');
  try {
    const viewIds = (request.postDataJSON() as { view_ids?: unknown } | null)?.view_ids;

    return Array.isArray(viewIds) ? viewIds.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Records the view-meta requests of `page` from now on: every per-view
 * metadata read, and the batched reads of the scenario's widget views.
 */
export function recordViewMetaRequests(page: Page): ViewMetaRequests {
  const onRequest = (request: Request) => {
    const url = new URL(request.url());

    if (request.method() === 'GET' && PER_VIEW_META_PATH.test(url.pathname) && url.searchParams.get('depth') === '1') {
      record.perView.push(`${url.pathname}${url.search}`);
      return;
    }

    if (!BATCHED_VIEWS_PATH.test(url.pathname)) return;
    const widgetViews = new Set(loadingScenario(page).widgets.map((widget) => widget.viewId));

    if (batchedViewIds(request, url).some((viewId) => widgetViews.has(viewId))) {
      record.batched.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  };
  const record: ViewMetaRequests = { perView: [], batched: [], stop: () => page.off('request', onRequest) };

  page.on('request', onRequest);
  return record;
}

/** Resolves once `record` has seen no new request for `VIEW_META_QUIET_MS`. */
async function viewMetaQuiet(page: Page, record: ViewMetaRequests) {
  let seen = -1;
  let quietSince = Date.now();

  await expect
    .poll(
      () => {
        const count = record.perView.length + record.batched.length;

        if (count !== seen) {
          seen = count;
          quietSince = Date.now();
        }

        return Date.now() - quietSince >= VIEW_META_QUIET_MS;
      },
      { timeout: 30_000, intervals: [250], message: 'waiting for the view-meta requests to stop' }
    )
    .toBe(true);
}

/**
 * The view-meta requests of the host page without its dashboard: its grid
 * tab opened in a new document with nothing cached. The app's own page load
 * (the page and its breadcrumb) asks for these whatever the page shows.
 */
export async function hostPageViewMetaBaseline(page: Page): Promise<ViewMetaRequests> {
  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);
  const record = recordViewMetaRequests(page);

  await clearCachedDatabaseStorage(page);
  await page.goto(`/app/${world.workspaceId}/${employees.pageId}?v=${employees.views.Grid}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('database-grid')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await viewMetaQuiet(page, record);
  record.stop();
  return record;
}

/**
 * The widgets of one dashboard open asked for their views' metadata at most
 * once: no per-view request beyond those of the host page's own load
 * (`baseline`), and at most 1 batched read of the widget views.
 */
export async function expectAtMostOneViewMetaRequest(
  page: Page,
  dashboard: ViewMetaRequests,
  baseline: ViewMetaRequests
) {
  await viewMetaQuiet(page, dashboard);
  dashboard.stop();
  const pageLoad = [...baseline.perView];
  const byWidgets = dashboard.perView.filter((request) => {
    const index = pageLoad.indexOf(request);

    if (index === -1) return true;
    pageLoad.splice(index, 1);
    return false;
  });

  expect(byWidgets, 'per-view metadata requests (GET .../view/{id}?depth=1) beyond the host page load').toEqual([]);
  expect(
    dashboard.batched.length,
    `batched reads of the widget views in one dashboard open: ${dashboard.batched.join(', ')}`
  ).toBeLessThanOrEqual(1);
  expect(byWidgets.length + dashboard.batched.length, 'view-meta requests of the widgets').toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// Visible widgets first (W2)
// ---------------------------------------------------------------------------

/** The load counters once every widget started and every visible widget reported its first data. */
export async function statsOnceEveryWidgetStarted(page: Page): Promise<DashboardLoadStatsSnapshot> {
  const widgets = loadingWidgets(page);
  const visible = visibleWidgets(page);
  let stats: DashboardLoadStatsSnapshot | null = null;

  await expect
    .poll(
      async () => {
        stats = await loadStats(page);
        const started = new Set(stats.widgetStarts.map((start) => start.widgetId));
        const firstData = stats.widgetFirstData;

        return [
          ...widgets.filter((widget) => !started.has(widget.id)).map((widget) => `${widget.label}: not started`),
          ...visible.filter((widget) => firstData[widget.id] === undefined).map((widget) => `${widget.label}: no data`),
        ];
      },
      {
        timeout: LOAD_TIMEOUT_MS + DASHBOARD_LOADING.deferredStartTimeoutMs,
        message: 'waiting for every widget to start and every visible widget to show its first data',
      }
    )
    .toEqual([]);
  return stats as unknown as DashboardLoadStatsSnapshot;
}

/**
 * The widgets of the host database started visible first: the first start is
 * a visible widget, every widget on screen at the open started as visible
 * before any widget below the fold, no widget below the fold started before
 * every visible widget had its first data or `deferredStartTimeoutMs` after
 * the first visible start, and the host never took a load slot.
 */
export function expectHostWidgetsVisibleFirst(page: Page, stats: DashboardLoadStatsSnapshot) {
  const visible = visibleWidgets(page);
  const below = widgetsBelowTheFold(page);
  const { databaseId } = fixtureDatabase(page, EMPLOYEES);
  const startOf = (widget: LoadingWidget) => stats.widgetStarts.find((start) => start.widgetId === widget.id);

  expect(visible.length, 'widgets on screen at the open').toBeGreaterThan(0);
  expect(below.length, 'widgets below the fold at the open').toBeGreaterThan(0);
  expect(
    loadingWidgets(page).filter((widget) => widget.database !== EMPLOYEES),
    'every widget shows a view of the host database'
  ).toEqual([]);

  const order = stats.widgetStarts.map((start) => start.widgetId);
  const lastVisible = Math.max(...visible.map((widget) => order.indexOf(widget.id)));
  const firstBelow = Math.min(...below.map((widget) => order.indexOf(widget.id)));

  expect(stats.widgetStarts[0]?.visibleAtStart, 'the first widget to start was visible').toBe(true);
  expect(
    visible.filter((widget) => startOf(widget)?.visibleAtStart !== true).map((widget) => widget.label),
    'widgets on screen at the open that did not start as visible'
  ).toEqual([]);
  expect(
    below.filter((widget) => startOf(widget)?.visibleAtStart !== false).map((widget) => widget.label),
    'widgets below the fold that started as visible'
  ).toEqual([]);
  expect(lastVisible, 'a widget below the fold started before a visible one').toBeLessThan(firstBelow);

  const firstVisibleStart = Math.min(...visible.map((widget) => startOf(widget)?.at ?? Number.POSITIVE_INFINITY));
  const lastFirstData = Math.max(...visible.map((widget) => stats.widgetFirstData[widget.id]));
  const deferralEnds = Math.min(lastFirstData, firstVisibleStart + DASHBOARD_LOADING.deferredStartTimeoutMs);
  const early = below
    .map((widget) => ({ label: widget.label, msEarly: deferralEnds - (startOf(widget)?.at ?? deferralEnds) }))
    .filter(({ msEarly }) => msEarly > 0);

  expect(
    early,
    'widgets below the fold that started before every visible widget had its first data (or the deferred timeout)'
  ).toEqual([]);
  expect(
    stats.sourceLoads.filter((load) => load.sourceId === databaseId),
    'load slots taken by the host database'
  ).toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'source databases loading cold at once').toBeLessThanOrEqual(
    DASHBOARD_LOADING.maxConcurrentSources
  );
}

/** The counts this lane reports: rows bound and row passes of the host database. */
export function hostLoadCounts(page: Page, stats: DashboardLoadStatsSnapshot) {
  const { databaseId } = fixtureDatabase(page, EMPLOYEES);

  return {
    rowsBound: stats.rowsBound[databaseId] ?? 0,
    rowLoadPasses: stats.rowLoadPasses[databaseId] ?? 0,
    sourceOpens: stats.sourceOpens[databaseId] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Time budgets (production preview, `isDashboardPerfMode`)
// ---------------------------------------------------------------------------

/** PERFORMANCE-REPORT 4.3 B, after W2: the longest main-thread task of the cold open (606 to 794 ms before). */
export const HOSTED_COLD_OPEN_LONGEST_TASK_MS = 500;
/** PERFORMANCE-REPORT 4.3 B, after W2: the widgets on screen complete, from the navigation start (6.05 to 6.90 s before). */
export const HOSTED_COLD_OPEN_VISIBLE_COMPLETE_MS = 5_500;

export interface HostedColdOpen {
  /** The navigation start of the dashboard's document, in ms since the epoch (`performance.timeOrigin`). */
  timeOrigin: number;
}

/**
 * Opens the dashboard in a new document with nothing cached, as
 * `openDashboardCold` does, and records long tasks from the moment the
 * navigation commits: the open's whole main-thread work, the app's start
 * included.
 */
export async function openHostedDashboardColdMeasured(page: Page): Promise<HostedColdOpen> {
  const scenario = loadingScenario(page);
  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);

  await clearCachedDatabaseStorage(page);
  scenario.openedAt = Date.now();
  await page.goto(`/app/${world.workspaceId}/${employees.pageId}?v=${dashboardViewId(page)}`, { waitUntil: 'commit' });
  await startLongTasks(page);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(loadingWidgets(page).length, { timeout: LOAD_TIMEOUT_MS });
  scenario.visibleAtOpen = new Set(await widgetsInViewport(page));
  return { timeOrigin };
}

export interface HostedColdOpenTimes {
  longTasks: LongTaskSummary;
  /** From the navigation start until the last widget on screen at the open completed. */
  visibleCompleteMs: number;
  /** From the navigation start until the last widget completed. */
  allCompleteMs: number;
}

/** Waits until every widget completed, then reads the long tasks and the completion times of the open. */
export async function hostedColdOpenTimes(page: Page, open: HostedColdOpen): Promise<HostedColdOpenTimes> {
  const widgets = loadingWidgets(page);
  let stats: DashboardLoadStatsSnapshot | null = null;

  await expect
    .poll(
      async () => {
        stats = await loadStats(page);
        const complete = stats.widgetComplete;

        return widgets.filter((widget) => complete[widget.id] === undefined).map((widget) => widget.label);
      },
      { timeout: LOAD_TIMEOUT_MS, message: 'waiting for every widget to complete' }
    )
    .toEqual([]);
  const complete = (stats as unknown as DashboardLoadStatsSnapshot).widgetComplete;
  const since = (at: number) => Math.round(at - open.timeOrigin);

  return {
    longTasks: await readLongTasks(page),
    visibleCompleteMs: since(Math.max(...visibleWidgets(page).map((widget) => complete[widget.id]))),
    allCompleteMs: since(Math.max(...widgets.map((widget) => complete[widget.id]))),
  };
}
