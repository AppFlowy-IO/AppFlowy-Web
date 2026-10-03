/**
 * Dashboard multi-source loading (`dashboard-loading.feature`, addendum A9):
 * the scenario worlds (small databases, the employees database and its
 * views, a host database with a dashboard), the recorders and the checks.
 *
 * Three sources of evidence, the same names as on desktop:
 *
 * - the app's load counters, `window.__DASHBOARD_LOAD_STATS__`
 *   (`src/application/database-yjs/dashboard-load-stats.ts`): source opens,
 *   row passes, widget starts and first data, empty-state samples and the
 *   high-water mark of sources loading at once;
 * - Playwright request events: the document and blob/diff requests of each
 *   source database, when they start and finish;
 * - a page recorder (an init script): when each widget frame and its first
 *   data appeared, and a look at every widget every 100 ms (the sampler of
 *   `dashboard-large-source.steps.ts`).
 *
 * "Loads slowly" holds every response of a database back 3 s with a route.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { APIRequestContext, expect, Locator, Page, Request, Route } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import { mockProSubscription } from './chart-test-helpers';
import { apiGet, browserAccessToken, clearCachedDatabaseStorage, WIDGET_TIMEOUT } from './dashboard-shared-helpers';
import {
  addFixtureDatabases,
  AuthSession,
  createDatabaseViewThroughApi,
  createSpace,
  DashboardSelectors,
  dashboardViewId,
  DashboardWorld,
  dashboardWorld,
  DatabaseSpec,
  FieldType,
  fixtureDatabase,
  gridDataRows,
  hostDatabase,
  installDashboardTestBridge,
  leaveEditMode,
  listFolderViews,
  openDashboard,
  openDatabasePage,
  peekDashboardWorld,
  prepareDashboardFixture,
  registerDashboardWorld,
  seedDashboardWidgets,
  statusOptionId,
  waitForDashboardSync,
  waitForDatabaseContext,
} from './dashboard-test-helpers';
import { configureView, ViewConfig, waitForViewSync } from './dashboard-usecase-helpers';
import { EMPLOYEE_FIELDS, seededEmployeesDatabase } from './employees-database';
import { DatabaseViewSelectors } from './selectors';
import { grantWorkspaceProSubscription } from './subscription-test-helpers';

import type { DashboardLoadStatsSnapshot } from '../../src/application/database-yjs/dashboard-load-stats';

/** How long a large source may take to load completely. */
export const LOAD_TIMEOUT_MS = 180_000;
/** "Loads slowly": every response of the database arrives this much later. */
export const SLOW_SOURCE_DELAY_MS = 3_000;
/** The page recorder's state, on `window`. */
const RECORDER_KEY = '__DASHBOARD_LOADING_RECORDER__';

/** The fixture name of the employees database in the scenario world. */
export const EMPLOYEES = 'Employees';
/** The host database of the scenario's dashboard. */
const HOST = 'Host';
/** A blob/diff page holds up to this many rows (LOADING-DESIGN 4.2: at most ceil(rows / 256) + 1 requests). */
const BLOB_PAGE_ROWS = 256;

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

export interface LoadingWidget {
  id: string;
  label: string;
  database: string;
  viewId: string;
  /** 1-based dashboard row. */
  row: number;
}

interface LeaveRecord {
  /** Node clock when the dashboard was left. */
  at: number;
  startCount: number;
  startedSources: Set<string>;
}

interface LoadingScenario {
  /** In layout order: top to bottom, left to right. */
  widgets: LoadingWidget[];
  recorder?: SourceRequestRecorder;
  /** Node clock when the dashboard was opened. */
  openedAt?: number;
  /** Node clock when the last row was scrolled into view. */
  scrolledAt?: number;
  /** Widget ids that intersected the viewport when the dashboard opened. */
  visibleAtOpen?: Set<string>;
  left?: LeaveRecord;
}

const scenarios = new WeakMap<Page, LoadingScenario>();

function loadingScenario(page: Page): LoadingScenario {
  let scenario = scenarios.get(page);

  if (!scenario) {
    scenario = { widgets: [] };
    scenarios.set(page, scenario);
  }

  return scenario;
}

function recorderOf(page: Page): SourceRequestRecorder {
  const recorder = loadingScenario(page).recorder;

  if (!recorder) throw new Error('Dashboard load counters are not being recorded in this scenario');
  return recorder;
}

export function loadingWidgets(page: Page): LoadingWidget[] {
  const { widgets } = loadingScenario(page);

  if (widgets.length === 0) throw new Error('No dashboard has been built in this scenario');
  return widgets;
}

function widgetLocatorOf(page: Page, widget: LoadingWidget): Locator {
  return DashboardSelectors.widget(page, widget.id);
}

/** The source databases of the dashboard (the host never needs a load slot). */
export function sourceDatabaseNames(page: Page): string[] {
  return [...new Set(loadingWidgets(page).map((widget) => widget.database))];
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/** A fresh account with an empty private space (the small-database scenarios). */
export async function prepareLoadingWorkspace(page: Page, request: APIRequestContext) {
  if (!peekDashboardWorld(page)) await prepareDashboardFixture(page, request, []);
}

/** The ids of the database the app exposes last, and the page it is shown on. */
export async function readOpenDatabase(page: Page) {
  const pageId = new URL(page.url()).pathname.split('/').filter(Boolean)[2] ?? '';
  const ids = await page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx?.databaseDoc?.getMap('data')?.get('database');

    if (!database) return null;
    return {
      workspaceId: String(ctx.workspaceId),
      databaseId: String(database.get('id') || ctx.databaseDoc.guid),
      activeViewId: String(ctx.activeViewId),
    };
  });

  if (!ids) throw new Error('No database is open');
  return { ...ids, pageId };
}

/**
 * Make the signed-in employees account a dashboard scenario world: the
 * dashboard test bridge, a Pro plan for Dashboard views, a private space for
 * the scenario's own databases, and the employees database as `EMPLOYEES`.
 */
export async function adoptEmployeesWorkspace(page: Page, request: APIRequestContext) {
  const employees = await readOpenDatabase(page);
  const accessToken = await browserAccessToken(page);
  const { tokenData, refreshToken } = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('token') ?? '{}') as Record<string, unknown>;

    return {
      tokenData: stored,
      refreshToken: String(stored.refresh_token ?? localStorage.getItem('af_refresh_token') ?? ''),
    };
  });
  const owner: AuthSession = { accessToken, refreshToken, tokenData };

  await installDashboardTestBridge(page.context());
  await mockProSubscription(page);
  grantWorkspaceProSubscription(employees.workspaceId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForDatabaseContext(page, employees.databaseId);
  const runId = Math.random().toString(36).slice(2, 10);
  const world: DashboardWorld = {
    runId,
    owner,
    workspaceId: employees.workspaceId,
    spaceId: await createSpace(request, accessToken, employees.workspaceId, `Dashboard loading ${runId}`, true),
    spaceName: `Dashboard loading ${runId}`,
    databases: {
      [EMPLOYEES]: {
        name: EMPLOYEES,
        spaceId: '',
        pageId: employees.pageId,
        databaseId: employees.databaseId,
        fieldIds: { ...EMPLOYEE_FIELDS },
        rowIds: {},
        views: { Grid: employees.activeViewId },
      },
    },
    widgets: {},
    viewsByName: {},
  };

  registerDashboardWorld(page, world);
}

/** Remember a view under the label the dashboard steps use for it. */
function nameView(page: Page, label: string, database: string, viewId: string) {
  const world = dashboardWorld(page);

  world.viewsByName = { ...world.viewsByName, [label]: { viewId, database } };
}

// ---------------------------------------------------------------------------
// Small databases
// ---------------------------------------------------------------------------

const SMALL_STATUS = ['Todo', 'Doing', 'Done'];

function smallDatabaseSpec(name: string, rows: number): DatabaseSpec {
  return {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect },
      { name: 'Points', type: FieldType.Number },
    ],
    rows: Array.from({ length: rows }, (_, index) => ({
      Name: `${name} ${index + 1}`,
      Status: SMALL_STATUS[index % SMALL_STATUS.length],
      Points: (index * 7) % 50,
    })),
  };
}

/**
 * Create small databases through the API, all at once. Their template rows
 * stay (the checks compare each widget with its source view, whatever it
 * holds), and their rows are created in parallel, in no particular order.
 */
async function addSmallDatabases(page: Page, request: APIRequestContext, sizes: Record<string, number>) {
  const specs = Object.fromEntries(Object.entries(sizes).map(([name, rows]) => [name, smallDatabaseSpec(name, rows)]));

  await addFixtureDatabases(page, request, Object.keys(sizes), specs, { prune: false, rowConcurrency: 8 });
  for (const name of Object.keys(sizes)) nameView(page, `${name} Grid`, name, fixtureDatabase(page, name).views.Grid);
}

/** Eight small databases, `Source1` to `Source8`, each with its grid view. */
export async function addEightSmallDatabases(page: Page, request: APIRequestContext) {
  await addSmallDatabases(
    page,
    request,
    Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`Source${index + 1}`, 4 + index]))
  );
}

/** The three small databases of LOADING-DESIGN 4.2, in their dashboard rows (2, 3 and 4). */
export const SMALL_DATABASES = { Small300: 300, Small60: 60, Small20: 20 } as const;

/** The views each small database offers: its grid, a sorted grid and a filtered grid. */
const SMALL_VIEWS = ['Grid', 'Sorted', 'Todo'] as const;

/** Three small databases of 300, 60 and 20 rows, each with three views for dashboard widgets. */
export async function addThreeSmallDatabasesWithViews(page: Page, request: APIRequestContext) {
  await addSmallDatabases(page, request, SMALL_DATABASES);
  for (const name of Object.keys(SMALL_DATABASES)) {
    const database = fixtureDatabase(page, name);
    const views: { viewId: string; config: ViewConfig }[] = [];

    await openDatabasePage(page, name);
    for (const viewName of SMALL_VIEWS.slice(1)) {
      const viewId = await createDatabaseViewThroughApi(page, request, {
        database: name,
        name: viewName,
        folderLayout: ViewLayout.Grid,
      });
      const config: ViewConfig =
        viewName === 'Sorted'
          ? { layout: DatabaseViewLayout.Grid, filters: [], sorts: [{ fieldId: database.fieldIds.Points, condition: 1 }] }
          : {
              layout: DatabaseViewLayout.Grid,
              filters: [
                {
                  fieldId: database.fieldIds.Status,
                  fieldType: FieldType.SingleSelect,
                  // `SelectOptionFilterCondition.OptionIs`.
                  condition: 0,
                  content: statusOptionId('Todo'),
                },
              ],
              sorts: [],
            };

      await configureView(page, database.databaseId, viewId, config);
      views.push({ viewId, config });
      nameView(page, `${name} ${viewName}`, name, viewId);
    }

    await waitForViewSync(
      page,
      request,
      name,
      views.map(({ viewId }) => viewId),
      async () => {
        for (const { viewId, config } of views) await configureView(page, database.databaseId, viewId, config);
      }
    );
  }
}

// ---------------------------------------------------------------------------
// The employees views
// ---------------------------------------------------------------------------

const DEPARTMENTS = ['engr', 'mktg', 'prod', 'dsgn', 'sale', 'supp', 'hr01', 'fnce'];
const OFFICES = ['sfo1', 'nyc1', 'lon1', 'ber1', 'tok1', 'syd1', 'rmt1'];

interface EmployeesView {
  name: string;
  folderLayout: ViewLayout;
  /** `null`: the database's own grid, as it is. */
  config: ViewConfig | null;
}

function selectFilter(fieldId: string, optionId: string) {
  return { fieldId, fieldType: FieldType.SingleSelect, condition: 0, content: optionId };
}

function chart(chartType: number, xFieldId: string, aggregationType = 0, yFieldId = '') {
  return { chartType, xFieldId, aggregationType, yFieldId };
}

/**
 * The 12 employees views of LOADING-DESIGN 4.2: a plain grid, 4 filtered or
 * sorted grids, 2 boards, a bar, donut and line chart, and a Number chart
 * counting and one summing. Named, so a later scenario (or run) reuses them.
 */
const EMPLOYEES_VIEWS: EmployeesView[] = [
  { name: 'Grid', folderLayout: ViewLayout.Grid, config: null },
  {
    name: 'Loading HR',
    folderLayout: ViewLayout.Grid,
    config: {
      layout: DatabaseViewLayout.Grid,
      filters: [selectFilter(EMPLOYEE_FIELDS.Department, 'hr01')],
      sorts: [],
    },
  },
  {
    name: 'Loading Engineering',
    folderLayout: ViewLayout.Grid,
    config: {
      layout: DatabaseViewLayout.Grid,
      filters: [selectFilter(EMPLOYEE_FIELDS.Department, 'engr')],
      sorts: [],
    },
  },
  {
    name: 'Loading Salary',
    folderLayout: ViewLayout.Grid,
    config: { layout: DatabaseViewLayout.Grid, filters: [], sorts: [{ fieldId: EMPLOYEE_FIELDS.Salary, condition: 1 }] },
  },
  {
    name: 'Loading Active',
    folderLayout: ViewLayout.Grid,
    config: {
      layout: DatabaseViewLayout.Grid,
      // `CheckboxFilterCondition.IsChecked`.
      filters: [{ fieldId: EMPLOYEE_FIELDS.Active, fieldType: FieldType.Checkbox, condition: 0, content: '' }],
      sorts: [],
    },
  },
  {
    name: 'Loading Departments',
    folderLayout: ViewLayout.Board,
    config: {
      layout: DatabaseViewLayout.Board,
      filters: [],
      sorts: [],
      group: {
        fieldId: EMPLOYEE_FIELDS.Department,
        fieldType: FieldType.SingleSelect,
        columnIds: [EMPLOYEE_FIELDS.Department, ...DEPARTMENTS],
      },
    },
  },
  {
    name: 'Loading Offices',
    folderLayout: ViewLayout.Board,
    config: {
      layout: DatabaseViewLayout.Board,
      filters: [],
      sorts: [],
      group: {
        fieldId: EMPLOYEE_FIELDS.Office,
        fieldType: FieldType.SingleSelect,
        columnIds: [EMPLOYEE_FIELDS.Office, ...OFFICES],
      },
    },
  },
  {
    name: 'Loading Bar',
    folderLayout: ViewLayout.Chart,
    config: { layout: DatabaseViewLayout.Chart, filters: [], sorts: [], chart: chart(0, EMPLOYEE_FIELDS.Department) },
  },
  {
    name: 'Loading Donut',
    folderLayout: ViewLayout.Chart,
    config: { layout: DatabaseViewLayout.Chart, filters: [], sorts: [], chart: chart(3, EMPLOYEE_FIELDS.Office) },
  },
  {
    name: 'Loading Line',
    folderLayout: ViewLayout.Chart,
    config: { layout: DatabaseViewLayout.Chart, filters: [], sorts: [], chart: chart(1, EMPLOYEE_FIELDS.Department) },
  },
  {
    name: 'Loading Count',
    folderLayout: ViewLayout.Chart,
    config: { layout: DatabaseViewLayout.Chart, filters: [], sorts: [], chart: chart(4, '') },
  },
  {
    name: 'Loading Sum',
    folderLayout: ViewLayout.Chart,
    config: {
      layout: DatabaseViewLayout.Chart,
      filters: [],
      sorts: [],
      chart: chart(4, '', 1, EMPLOYEE_FIELDS.Salary),
    },
  },
];

/** The views of the employees database in row 1 of the four-database dashboard: no row-reading chart. */
const EMPLOYEES_ROW_VIEWS = ['Grid', 'Loading HR', 'Loading Count'];

/** The folder view new employees views go under: the database container when the page has one. */
async function employeesViewParent(page: Page, request: APIRequestContext): Promise<string> {
  type FolderView = { parent_view_id?: string; extra?: unknown };
  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);
  const isContainer = (view: FolderView) => {
    const extra = typeof view.extra === 'string' ? JSON.parse(view.extra || '{}') : view.extra;

    return Boolean((extra as { is_database_container?: boolean } | undefined)?.is_database_container);
  };

  const base = `/api/workspace/${world.workspaceId}`;
  const view = await apiGet<FolderView>(request, world.owner.accessToken, `${base}/view/${employees.pageId}?depth=0`);
  const parentId = view.parent_view_id;

  if (!parentId) return employees.pageId;
  const parent = await apiGet<FolderView>(request, world.owner.accessToken, `${base}/view/${parentId}?depth=0`);

  return isContainer(parent) ? parentId : employees.pageId;
}

/**
 * Make sure the employees database has `names` (default: all 12 views),
 * reusing the views an earlier scenario created, and write their settings
 * again (the employees step clears every view's filters and sorts).
 */
export async function ensureEmployeesViews(
  page: Page,
  request: APIRequestContext,
  names: string[] = EMPLOYEES_VIEWS.map((view) => view.name)
) {
  const world = dashboardWorld(page);
  const employees = fixtureDatabase(page, EMPLOYEES);
  const folderViews = await listFolderViews(request, world.owner.accessToken, world.workspaceId, employees.databaseId);

  // Views are written through the browser's copy of the database.
  await openDatabasePage(page, EMPLOYEES);
  const configured: { viewId: string; config: ViewConfig }[] = [];
  let parentViewId: string | undefined;

  for (const spec of EMPLOYEES_VIEWS.filter((view) => names.includes(view.name))) {
    let viewId = spec.config === null ? employees.views.Grid : folderViews.find((view) => view.name === spec.name)?.view_id;

    if (!viewId) {
      parentViewId ??= await employeesViewParent(page, request);
      viewId = await createDatabaseViewThroughApi(page, request, {
        database: EMPLOYEES,
        name: spec.name,
        folderLayout: spec.folderLayout,
        parentViewId,
      });
    }

    if (spec.config) {
      await configureView(page, employees.databaseId, viewId, spec.config);
      configured.push({ viewId, config: spec.config });
    }

    nameView(page, `${EMPLOYEES} ${spec.name}`, EMPLOYEES, viewId);
  }

  if (configured.length === 0) return;
  await waitForViewSync(
    page,
    request,
    EMPLOYEES,
    configured.map(({ viewId }) => viewId),
    async () => {
      for (const { viewId, config } of configured) await configureView(page, employees.databaseId, viewId, config);
    }
  );
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

/**
 * A new database with a dashboard showing `rows` (labels of named views, one
 * array per dashboard row), open in View mode with every widget mounted and
 * the layout saved on the server.
 */
async function createDashboard(page: Page, request: APIRequestContext, rows: string[][]) {
  const world = dashboardWorld(page);

  await addFixtureDatabases(page, request, [HOST], { [HOST]: { fields: [], rows: [] } }, { prune: false });
  await openDatabasePage(page, HOST);
  world.dashboardViewId = await createDatabaseViewThroughApi(page, request, {
    database: HOST,
    name: 'Dashboard',
    folderLayout: ViewLayout.Dashboard,
  });
  world.dashboardHost = HOST;
  await openDashboard(page);
  await seedDashboardWidgets(
    page,
    rows.flatMap((labels, index) => labels.map((label) => ({ row: index + 1, label })))
  );
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);

  const scenario = loadingScenario(page);

  scenario.widgets = rows.flatMap((labels, index) =>
    labels.map((label) => {
      const known = world.widgets[label];
      const named = world.viewsByName?.[label];

      if (!known || !named) throw new Error(`The dashboard has no "${label}" widget`);
      return { id: known.id, label, database: named.database, viewId: named.viewId, row: index + 1 };
    })
  );
}

/** Eight widgets, one per small database, in two rows of four. */
export async function createDashboardOverEightDatabases(page: Page, request: APIRequestContext) {
  const labels = Array.from({ length: 8 }, (_, index) => `Source${index + 1} Grid`);

  await createDashboard(page, request, [labels.slice(0, 4), labels.slice(4)]);
}

/** Twelve widgets showing the twelve employees views, in three rows of four. */
export async function createDashboardOverEmployeesViews(page: Page, request: APIRequestContext) {
  const labels = EMPLOYEES_VIEWS.map((view) => `${EMPLOYEES} ${view.name}`);

  await createDashboard(page, request, [labels.slice(0, 4), labels.slice(4, 8), labels.slice(8)]);
}

/**
 * Twelve widgets over four databases in four rows of three: the employees
 * database in row 1 (a plain grid, a filtered grid and a count), then the
 * 300-, 60- and 20-row databases. Rows 3 and 4 start below the fold.
 */
export async function createDashboardOverFourDatabases(page: Page, request: APIRequestContext) {
  await ensureEmployeesViews(page, request, EMPLOYEES_ROW_VIEWS);
  await createDashboard(page, request, [
    EMPLOYEES_ROW_VIEWS.map((name) => `${EMPLOYEES} ${name}`),
    ...Object.keys(SMALL_DATABASES).map((name) => SMALL_VIEWS.map((view) => `${name} ${view}`)),
  ]);
}

// ---------------------------------------------------------------------------
// Recorders
// ---------------------------------------------------------------------------

type SourceRequestKind = 'document' | 'blob';

interface SourceRequest {
  sourceId: string;
  kind: SourceRequestKind;
  url: string;
  /** Node clock. */
  start: number;
  end?: number;
  body?: string;
}

/**
 * Records the document and blob/diff requests of each source database: the
 * database collab, the page-view of one of its views (which carries the
 * database collab) and its blob walk. Permission probes and row requests do
 * not count.
 */
export class SourceRequestRecorder {
  readonly requests: SourceRequest[] = [];
  private readonly open = new Map<Request, SourceRequest>();

  constructor(
    page: Page,
    private readonly sources: { databaseId: string; viewIds: string[] }[]
  ) {
    page.on('request', (request) => this.onRequest(request));
    page.on('requestfinished', (request) => this.onEnd(request));
    page.on('requestfailed', (request) => this.onEnd(request));
  }

  private classify(url: URL): { sourceId: string; kind: SourceRequestKind } | null {
    const path = url.pathname;

    for (const { databaseId, viewIds } of this.sources) {
      if (new RegExp(`/database/${databaseId}/blob(?:/|$)`).test(path)) return { sourceId: databaseId, kind: 'blob' };
      if (new RegExp(`/collab/${databaseId}$`).test(path)) return { sourceId: databaseId, kind: 'document' };
      if (viewIds.some((viewId) => path.endsWith(`/page-view/${viewId}`))) {
        return { sourceId: databaseId, kind: 'document' };
      }
    }

    return null;
  }

  private onRequest(request: Request) {
    const match = this.classify(new URL(request.url()));

    if (!match) return;
    const entry: SourceRequest = {
      ...match,
      url: request.url(),
      start: Date.now(),
      body: match.kind === 'blob' ? request.postDataBuffer()?.toString('base64') : undefined,
    };

    this.requests.push(entry);
    this.open.set(request, entry);
  }

  private onEnd(request: Request) {
    const entry = this.open.get(request);

    if (!entry) return;
    entry.end = Date.now();
    this.open.delete(request);
  }

  since(from: number) {
    return this.requests.filter((entry) => entry.start >= from);
  }

  /** The most distinct sources that had a request in flight at the same time. */
  maxConcurrentSources(from: number): number {
    const events = this.since(from).flatMap((entry) => [
      { at: entry.start, sourceId: entry.sourceId, delta: 1 },
      { at: entry.end ?? Number.POSITIVE_INFINITY, sourceId: entry.sourceId, delta: -1 },
    ]);
    // Ends before starts at the same instant: a slot handed over is not an overlap.
    const ordered = events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    const inFlight = new Map<string, number>();
    let max = 0;

    for (const event of ordered) {
      inFlight.set(event.sourceId, (inFlight.get(event.sourceId) ?? 0) + event.delta);
      max = Math.max(max, [...inFlight.values()].filter((count) => count > 0).length);
    }

    return max;
  }
}

/** The page side: frame and first-data times by widget, and a look at every widget every 100 ms. */
function recordWidgetsInPage(key: string) {
  const win = window as unknown as Record<string, unknown>;

  if (win[key]) return;
  const state: {
    frames: Record<string, number>;
    data: Record<string, number>;
    samples: Record<string, unknown>[];
  } = { frames: {}, data: {}, samples: [] };

  win[key] = state;
  const read = (widget: Element) => {
    const grid = widget.querySelector('[data-testid="database-grid"]');
    const placeholder = widget.querySelector('[data-testid="dashboard-widget-placeholder"]');
    const number = widget.querySelector('[data-testid="number-chart"]');
    const rows = widget.querySelectorAll('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])').length;
    const cards = widget.querySelectorAll('.board-card').length;
    const listRows = widget.querySelectorAll('[data-testid^="list-primary-cell-"]').length;
    const chartRows = widget.querySelectorAll('[data-testid="chart-data-table"] tr[data-label]').length;
    const hasData = rows > 0 || cards > 0 || listRows > 0 || chartRows > 0 || number?.getAttribute('data-empty') === 'false';
    const loading =
      placeholder?.getAttribute('data-reason') === 'loading' ||
      Boolean(widget.querySelector('[data-testid="grid-loading-indicator"], [data-testid="chart-loading"]')) ||
      grid?.getAttribute('data-hydrating') === 'true';
    const content = Boolean(
      grid ||
        widget.querySelector(
          '.database-board, [data-testid="database-list"], [data-testid="database-chart"], [data-testid="number-chart"]'
        )
    );

    return {
      header: Boolean(
        widget.querySelector('[data-testid="dashboard-widget-header"], [data-testid="dashboard-widget-tool-capsule"]')
      ),
      placeholder: placeholder?.getAttribute('data-reason') ?? null,
      hasData,
      loading,
      // A mounted view with nothing in it and nothing loading: what a user reads as "no results".
      empty:
        !hasData &&
        !loading &&
        (content || Boolean(widget.querySelector('[data-testid="chart-no-data"], [data-testid="number-chart-empty"]'))),
    };
  };

  const scan = () => {
    const now = Date.now();

    document.querySelectorAll('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.getAttribute('data-widget-id');

      if (!id || (state.frames[id] !== undefined && state.data[id] !== undefined)) return;
      const look = read(widget);

      if (look.header && state.frames[id] === undefined) state.frames[id] = now;
      if (look.hasData && state.data[id] === undefined) state.data[id] = now;
    });
  };

  new MutationObserver(scan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-row-count', 'data-hydrating', 'data-empty', 'data-reason'],
  });
  window.setInterval(() => {
    const t = Date.now();

    document.querySelectorAll('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.getAttribute('data-widget-id');

      if (id) state.samples.push({ t, id, ...read(widget) });
    });
  }, 100);
}

interface WidgetSample {
  /** ms since the epoch (the browser and Node share the clock). */
  t: number;
  id: string;
  header: boolean;
  placeholder: string | null;
  hasData: boolean;
  loading: boolean;
  empty: boolean;
}

interface PageRecord {
  frames: Record<string, number>;
  data: Record<string, number>;
  samples: WidgetSample[];
}

async function readPageRecord(page: Page): Promise<PageRecord> {
  const record = await page.evaluate((key) => (window as any)[key] ?? null, RECORDER_KEY);

  if (!record) throw new Error('The dashboard was not opened while its load counters were recorded');
  return record as PageRecord;
}

/** The app's load counters (`window.__DASHBOARD_LOAD_STATS__`). */
export async function loadStats(page: Page): Promise<DashboardLoadStatsSnapshot> {
  const stats = await page.evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.snapshot() ?? null);

  expect(stats, 'the app exposes no dashboard load counters (window.__DASHBOARD_LOAD_STATS__)').not.toBeNull();
  return stats as DashboardLoadStatsSnapshot;
}

/**
 * Record the next dashboard open: the page recorder starts with the next
 * document, the request recorder now; the app's counters start empty with
 * the new document.
 */
export async function startLoadRecording(page: Page) {
  const scenario = loadingScenario(page);
  const sources = sourceDatabaseNames(page).map((name) => {
    const database = fixtureDatabase(page, name);

    return {
      databaseId: database.databaseId,
      viewIds: [
        database.pageId,
        ...Object.values(database.views),
        ...scenario.widgets.filter((widget) => widget.database === name).map((widget) => widget.viewId),
      ],
    };
  });

  scenario.recorder ??= new SourceRequestRecorder(page, sources);
  await page.addInitScript(recordWidgetsInPage, RECORDER_KEY);
  await page.evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.reset());
}

// ---------------------------------------------------------------------------
// Opening and leaving
// ---------------------------------------------------------------------------

/** Hold every response of these databases back `SLOW_SOURCE_DELAY_MS`. */
async function slowDownSources(page: Page, names: string[]) {
  const ids = names.flatMap((name) => {
    const database = fixtureDatabase(page, name);

    return [database.databaseId, database.pageId, ...Object.values(database.views)];
  });
  const widgetViews = loadingWidgets(page)
    .filter((widget) => names.includes(widget.database))
    .map((widget) => widget.viewId);
  const all = [...new Set([...ids, ...widgetViews])];

  await page.route(
    (url) => all.some((id) => url.pathname.includes(id)),
    async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_SOURCE_DELAY_MS));
      await route.continue().catch(() => undefined);
    }
  );
}

/**
 * Open the scenario's dashboard in a new document with nothing cached; with
 * `slow`, every response of those databases is held back 3 s (also with
 * nothing cached, so the delay holds the load).
 */
export async function openDashboardCold(page: Page, slow: string[] = []) {
  const scenario = loadingScenario(page);
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const url = new URL(`/app/${world.workspaceId}/${host.pageId}?v=${dashboardViewId(page)}`, page.url()).toString();

  await clearCachedDatabaseStorage(page);
  if (slow.length > 0) await slowDownSources(page, slow);
  scenario.openedAt = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(page));
}

/** Widget ids whose box intersects the viewport. */
async function widgetsInViewport(page: Page): Promise<string[]> {
  return DashboardSelectors.widgets(page).evaluateAll((widgets) =>
    widgets
      .filter((widget) => {
        const rect = widget.getBoundingClientRect();

        return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      })
      .map((widget) => widget.getAttribute('data-widget-id') ?? '')
  );
}

export function visibleWidgets(page: Page): LoadingWidget[] {
  const visible = loadingScenario(page).visibleAtOpen;

  if (!visible) throw new Error('The dashboard has not been opened in this scenario');
  return loadingWidgets(page).filter((widget) => visible.has(widget.id));
}

export function widgetsBelowTheFold(page: Page): LoadingWidget[] {
  const visible = loadingScenario(page).visibleAtOpen;

  if (!visible) throw new Error('The dashboard has not been opened in this scenario');
  return loadingWidgets(page).filter((widget) => !visible.has(widget.id));
}

/**
 * Leave the dashboard for the host's grid tab as soon as at least 2 and at
 * most 7 widgets have started, and remember what had started once it is gone.
 */
export async function leaveBeforeEveryWidgetStarted(page: Page) {
  const scenario = loadingScenario(page);
  const total = loadingWidgets(page).length;
  const deadline = Date.now() + LOAD_TIMEOUT_MS;

  for (;;) {
    const starts = (await loadStats(page)).widgetStarts.length;

    // Every widget started before the step could leave: there is no queue left to cancel.
    if (starts >= total) throw new Error(`all ${total} widgets started before the dashboard could be left`);
    if (starts >= 2) break;
    if (Date.now() > deadline) throw new Error(`only ${starts} widgets started in ${LOAD_TIMEOUT_MS} ms`);
    await page.waitForTimeout(50);
  }

  await DatabaseViewSelectors.viewTab(page, fixtureDatabase(page, HOST).views.Grid).click();
  await expect(DashboardSelectors.view(page)).toHaveCount(0, WIDGET_TIMEOUT);
  const stats = await loadStats(page);

  scenario.left = {
    at: Date.now(),
    startCount: stats.widgetStarts.length,
    startedSources: new Set(stats.widgetStarts.map((start) => start.sourceId)),
  };
  expect(scenario.left.startCount, 'widgets that had started when the dashboard was gone').toBeLessThan(total);
}

/** Scroll the last dashboard row into view. */
export async function scrollToLastRow(page: Page) {
  await DashboardSelectors.rows(page).last().scrollIntoViewIfNeeded();
  loadingScenario(page).scrolledAt = Date.now();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * What a view shows once it has loaded, read the same way in a widget and on
 * the view's own page: a grid's row count and first row, a board's cards per
 * column, a chart's value per category, a Number chart's value. `null` while
 * it still loads.
 */
async function readResult(scope: Locator): Promise<string | null> {
  return scope.evaluate((element) => {
    if (element.querySelector('[data-testid="dashboard-widget-placeholder"], [data-testid="chart-loading"]')) return null;
    const grid = element.querySelector('[data-testid="database-grid"]');

    if (grid) {
      const count = grid.getAttribute('data-row-count');

      if (count === null || grid.getAttribute('data-hydrating') === 'true') return null;
      if (element.querySelector('[data-testid="grid-loading-indicator"]')) return null;
      const first = element.querySelector('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');

      return `grid ${count} rows, first ${(first?.getAttribute('data-testid') ?? '').slice('grid-row-'.length)}`;
    }

    if (element.querySelector('.database-board')) {
      const columns = Array.from(element.querySelectorAll('[data-testid="board-column"]')).map((column) => {
        const count = column.querySelector('[data-testid="board-column-name"]')?.nextElementSibling?.textContent ?? '';

        return `${column.getAttribute('data-column-id')}=${count.trim()}`;
      });

      return columns.length > 0 ? `board ${columns.sort().join(' ')}` : null;
    }

    const number = element.querySelector('[data-testid="number-chart"]');

    if (number) {
      return number.getAttribute('data-empty') === 'false'
        ? `number ${(element.querySelector('[data-testid="number-chart-value"]')?.textContent ?? '').trim()}`
        : null;
    }

    const categories = Array.from(element.querySelectorAll('[data-testid="chart-data-table"] tr[data-label]'))
      .map((row) => ({ key: row.getAttribute('data-key') ?? '', value: Number(row.getAttribute('data-value')) }))
      .filter((row) => row.value > 0)
      .map((row) => `${row.key}=${row.value}`);

    return categories.length > 0 ? `chart ${categories.sort().join(' ')}` : null;
  });
}

async function settledResult(scope: Locator, what: string, timeout = LOAD_TIMEOUT_MS): Promise<string> {
  let result: string | null = null;

  await expect
    .poll(
      async () => {
        result = await readResult(scope).catch(() => null);
        return result;
      },
      { timeout, message: `waiting for ${what} to finish loading` }
    )
    .not.toBeNull();
  // Stable: the same result a moment later (the derived result is complete).
  await expect.poll(() => readResult(scope), { timeout, message: `${what} kept changing` }).toBe(result);
  return result as unknown as string;
}

/** Each widget, once loaded, shows what its source view shows on the view's own page. */
export async function expectWidgetsMatchTheirSourceViews(page: Page, widgets: LoadingWidget[]) {
  const shown: { widget: LoadingWidget; result: string }[] = [];

  for (const widget of widgets) {
    shown.push({ widget, result: await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`) });
  }

  for (const { widget, result } of shown) {
    await openDatabasePage(page, widget.database, widget.viewId);
    const source = await settledResult(page.locator('body'), `the "${widget.label}" view`);

    expect(result, `the "${widget.label}" widget differs from its source view`).toBe(source);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Wait until each of `widgets` shows data (rows, cards or a chart value). */
export async function waitForWidgetData(page: Page, widgets: LoadingWidget[], timeout = LOAD_TIMEOUT_MS) {
  await expect
    .poll(
      async () => {
        const { data } = await readPageRecord(page);

        return widgets.filter((widget) => data[widget.id] === undefined).map((widget) => widget.label);
      },
      { timeout, message: 'waiting for the widgets to show data' }
    )
    .toEqual([]);
}

/** Every widget frame (header and placeholder) was in the page before the first widget showed data. */
export async function expectFramesBeforeData(page: Page) {
  const widgets = loadingWidgets(page);

  await waitForWidgetData(page, visibleWidgets(page));
  const { frames, data } = await readPageRecord(page);
  const missing = widgets.filter((widget) => frames[widget.id] === undefined).map((widget) => widget.label);

  expect(missing, 'widgets whose frame never showed').toEqual([]);
  const lastFrame = Math.max(...widgets.map((widget) => frames[widget.id]));
  const firstData = Math.min(...Object.values(data));

  expect(Number.isFinite(firstData), 'no widget showed data').toBe(true);
  expect(lastFrame, 'a widget frame showed after the first row data arrived').toBeLessThanOrEqual(firstData);
}

/**
 * At most `maxConcurrentSources` (2) source databases loaded at a time: the
 * app's high-water mark, and the requests in flight per source database.
 */
export async function expectAtMostTwoSourcesLoading(page: Page) {
  const scenario = loadingScenario(page);
  const cap = DASHBOARD_LOADING.maxConcurrentSources;
  const host = hostDatabase(page).databaseId;

  await waitForWidgetData(page, visibleWidgets(page));
  const stats = await loadStats(page);
  const started = new Set(stats.widgetStarts.map((start) => start.sourceId));
  const loaded = new Set(stats.sourceLoads.map((load) => load.sourceId));

  // The counters were recorded: every started source took a slot (the host needs none).
  expect(stats.widgetStarts.length, 'no widget start was recorded').toBeGreaterThan(0);
  expect([...started].filter((id) => id !== host && !loaded.has(id)), 'started sources without a slot').toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'sources loading at once (the app counter)').toBeLessThanOrEqual(cap);
  expect(
    recorderOf(page).maxConcurrentSources(scenario.openedAt ?? 0),
    'source databases with a document or blob/diff request in flight at once'
  ).toBeLessThanOrEqual(cap);
}

/**
 * No widget looked empty before it completed: the app's empty-state samples
 * are 0, and every look the page recorder took shows a header with data or a
 * loading state, never an empty view.
 */
export async function expectNoEmptyLooks(page: Page, widgets: LoadingWidget[]) {
  // The whole load: every widget shows data first.
  await waitForWidgetData(page, widgets);
  const stats = await loadStats(page);
  const { samples } = await readPageRecord(page);
  const ids = new Set(widgets.map((widget) => widget.id));
  const labelOf = (id: string) => widgets.find((widget) => widget.id === id)?.label ?? id;
  const before = samples.filter(
    (sample) =>
      ids.has(sample.id) && (stats.widgetComplete[sample.id] === undefined || sample.t < stats.widgetComplete[sample.id])
  );

  expect(
    widgets.filter((widget) => (stats.emptyStateSamples[widget.id] ?? 0) > 0).map((widget) => widget.label),
    'widgets the app saw in an empty state before they completed'
  ).toEqual([]);
  for (const widget of widgets) {
    expect(
      samples.some((sample) => sample.id === widget.id),
      `the "${widget.label}" widget was never seen`
    ).toBe(true);
  }

  const empty = before.filter((sample) => sample.empty || !sample.header);

  expect(
    empty.map((sample) => `${labelOf(sample.id)} at ${sample.t - (loadingScenario(page).openedAt ?? 0)} ms`),
    'widgets that looked empty (or had no header) while they loaded'
  ).toEqual([]);
}

/**
 * Every widget waiting for its source showed its header and the loading
 * placeholder until it started, and no widget ever looked empty.
 */
export async function expectWaitingWidgetsShowLoading(page: Page, widgets: LoadingWidget[]) {
  await expectNoEmptyLooks(page, widgets);
  const stats = await loadStats(page);
  const { samples } = await readPageRecord(page);

  for (const widget of widgets) {
    const startedAt = stats.widgetStarts.find((start) => start.widgetId === widget.id)?.at ?? Number.POSITIVE_INFINITY;
    const waiting = samples.filter((sample) => sample.id === widget.id && sample.t < startedAt);

    expect(
      waiting.filter((sample) => !sample.header || sample.placeholder !== 'loading').map((sample) => sample.t),
      `the "${widget.label}" widget waited without its header and loading placeholder (sample times)`
    ).toEqual([]);
  }
}

/** Each widget showed a loading state (the placeholder or a loading row) at least once before its data. */
export async function expectLoadingStateShown(page: Page, widgets: LoadingWidget[]) {
  await expectWaitingWidgetsShowLoading(page, widgets);
  const { samples } = await readPageRecord(page);

  for (const widget of widgets) {
    expect(
      samples.some((sample) => sample.id === widget.id && sample.loading && sample.header),
      `the "${widget.label}" widget never showed a loading state`
    ).toBe(true);
  }
}

/** Every source database was opened once: one open by the app and one document request. */
export async function expectEachSourceOpenedOnce(page: Page, names: string[] = sourceDatabaseNames(page)) {
  const scenario = loadingScenario(page);

  await waitForWidgetData(
    page,
    loadingWidgets(page).filter((widget) => names.includes(widget.database))
  );
  const stats = await loadStats(page);
  const requests = recorderOf(page).since(scenario.openedAt ?? 0);

  for (const name of names) {
    const { databaseId } = fixtureDatabase(page, name);

    expect(stats.sourceOpens[databaseId], `times the "${name}" database was opened (the app counter)`).toBe(1);
    expect(
      requests.filter((entry) => entry.sourceId === databaseId && entry.kind === 'document').map((entry) => entry.url),
      `document requests of the "${name}" database`
    ).toHaveLength(1);
  }
}

/** The rows of `name` were read in one pass: one pass counted by the app, and a blob walk of distinct pages. */
export async function expectRowsLoadedInOnePass(page: Page, name: string) {
  const scenario = loadingScenario(page);
  const { databaseId } = fixtureDatabase(page, name);

  await waitForWidgetData(page, loadingWidgets(page).filter((widget) => widget.database === name));
  for (const widget of loadingWidgets(page).filter((candidate) => candidate.database === name)) {
    await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`);
  }

  const stats = await loadStats(page);
  const rows = name === EMPLOYEES ? seededEmployeesDatabase().rowIds.length : 0;
  const pages = recorderOf(page)
    .since(scenario.openedAt ?? 0)
    .filter((entry) => entry.sourceId === databaseId && entry.kind === 'blob');
  const bodies = pages.map((entry) => entry.body ?? '');

  expect(stats.rowLoadPasses[databaseId], `row passes over the "${name}" database (the app counter)`).toBe(1);
  expect(pages.length, `blob/diff requests of the "${name}" database`).toBeLessThanOrEqual(
    Math.ceil(rows / BLOB_PAGE_ROWS) + 1
  );
  expect(new Set(bodies).size, `repeated blob/diff requests of the "${name}" database`).toBe(bodies.length);
}

/** Every visible widget started before any widget below the fold (the app's start order). */
export async function expectVisibleWidgetsStartedFirst(page: Page) {
  const visible = visibleWidgets(page);
  const below = widgetsBelowTheFold(page);

  expect(below.length, 'the dashboard has no widget below the fold').toBeGreaterThan(0);
  await waitForWidgetData(page, visible);
  const starts = (await loadStats(page)).widgetStarts.map((start) => start.widgetId);
  const lastVisible = Math.max(...visible.map((widget) => starts.indexOf(widget.id)));
  const firstBelow = Math.min(
    ...below.map((widget) => starts.indexOf(widget.id)).filter((index) => index !== -1),
    Number.POSITIVE_INFINITY
  );

  expect(
    visible.filter((widget) => !starts.includes(widget.id)).map((widget) => widget.label),
    'visible widgets that never started'
  ).toEqual([]);
  expect(lastVisible, 'a widget below the fold started before a visible one').toBeLessThan(firstBelow);
}

/** A database that only widgets below the fold use was not opened before every visible widget showed data. */
export async function expectBelowFoldDatabasesWaited(page: Page) {
  const scenario = loadingScenario(page);
  const visible = visibleWidgets(page);
  const visibleDatabases = new Set(visible.map((widget) => widget.database));
  const belowOnly = [...new Set(widgetsBelowTheFold(page).map((widget) => widget.database))].filter(
    (name) => !visibleDatabases.has(name)
  );

  expect(belowOnly.length, 'no database is used only below the fold').toBeGreaterThan(0);
  await waitForWidgetData(page, visible);
  // The page can show a widget's data a moment before the widget reports it
  // (a count shows before the row pass ends): wait for the reports.
  await expect
    .poll(
      async () => {
        const reported = (await loadStats(page)).widgetFirstData;

        return visible.filter((widget) => reported[widget.id] === undefined).map((widget) => widget.label);
      },
      { timeout: LOAD_TIMEOUT_MS, message: 'a visible widget never reported its first data' }
    )
    .toEqual([]);
  const stats = await loadStats(page);
  const firstData = visible.map((widget) => stats.widgetFirstData[widget.id]);

  expect(firstData.every((at) => at !== undefined), 'a visible widget never reported its first data').toBe(true);
  const visibleShowedData = Math.max(...(firstData));
  const requests = recorderOf(page).since(scenario.openedAt ?? 0);

  for (const name of belowOnly) {
    const { databaseId } = fixtureDatabase(page, name);
    const early = requests.filter((entry) => entry.sourceId === databaseId && entry.start < visibleShowedData);
    const earlyStarts = stats.widgetStarts.filter(
      (start) => start.sourceId === databaseId && start.at < visibleShowedData
    );

    expect(early.map((entry) => entry.url), `"${name}" requests before the visible widgets showed data`).toEqual([]);
    expect(earlyStarts.length, `"${name}" widgets started before the visible widgets showed data`).toBe(0);
  }
}

/** Each widget of the last row shows its rows, within `withinMs` of the scroll when given. */
export async function expectLastRowShowsRows(page: Page, withinMs?: number) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);
  const lastRow = Math.max(...widgets.map((widget) => widget.row));
  const timeout =
    withinMs === undefined ? LOAD_TIMEOUT_MS : Math.max(0, withinMs - (Date.now() - (scenario.scrolledAt ?? Date.now())));

  await Promise.all(
    widgets
      .filter((widget) => widget.row === lastRow)
      .map((widget) =>
        expect(gridDataRows(widgetLocatorOf(page, widget)).first(), `the "${widget.label}" widget shows no rows`).toBeVisible(
          { timeout }
        )
      )
  );
}

/** Each of `widgets` shows its rows within `withinMs` of the dashboard opening. */
export async function expectWidgetsShowRowsWithin(page: Page, widgets: LoadingWidget[], withinMs: number) {
  const openedAt = loadingScenario(page).openedAt ?? Date.now();

  expect(widgets.length, 'no widget to check').toBeGreaterThan(0);
  await Promise.all(
    widgets.map((widget) =>
      expect(gridDataRows(widgetLocatorOf(page, widget)).first(), `the "${widget.label}" widget shows no rows`).toBeVisible(
        { timeout: Math.max(0, withinMs - (Date.now() - openedAt)) }
      )
    )
  );
  const { data } = await readPageRecord(page);

  for (const widget of widgets) {
    expect(data[widget.id] - openedAt, `ms until the "${widget.label}" widget showed rows`).toBeLessThanOrEqual(withinMs);
  }
}

/** Nothing starts loading after the dashboard was left: no new widget start, no request for a source not started. */
export async function expectNothingStartsAfterLeaving(page: Page) {
  const left = loadingScenario(page).left;

  expect(left, 'the dashboard was not left in this scenario').toBeDefined();
  const { at, startCount, startedSources } = left as LeaveRecord;

  // Watch a 2 s window: anything queued would have started by then.
  await page.waitForTimeout(2_000);
  const stats = await loadStats(page);
  const late = recorderOf(page)
    .since(at)
    .filter((entry) => !startedSources.has(entry.sourceId));

  expect(stats.widgetStarts.slice(startCount), 'widgets that started after the dashboard was left').toEqual([]);
  expect(late.map((entry) => entry.url), 'requests for sources that had not started when the dashboard was left').toEqual(
    []
  );
}

export function employeesWidgets(page: Page): LoadingWidget[] {
  return loadingWidgets(page).filter((widget) => widget.database === EMPLOYEES);
}

export function otherVisibleWidgets(page: Page): LoadingWidget[] {
  return visibleWidgets(page).filter((widget) => widget.database !== EMPLOYEES);
}
