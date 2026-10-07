/* eslint-disable import/no-named-as-default-member -- protobufjs is CommonJS; its named runtime exports are unavailable in Node ESM. */
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
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Locator, Page, Request, Route } from '@playwright/test';
// eslint-disable-next-line import/default -- Node ESM exposes this CommonJS module through its default export.
import protobuf, { type Type as ProtobufType } from 'protobufjs';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import { mockProSubscription } from './chart-test-helpers';
import { apiGet, apiPost, browserAccessToken, clearCachedDatabaseStorage, WIDGET_TIMEOUT } from './dashboard-shared-helpers';
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
  inviteDashboardMember,
  leaveEditMode,
  listFolderViews,
  openDashboard,
  openDatabasePage,
  peekDashboardWorld,
  prepareDashboardFixture,
  registerDashboardWorld,
  seedDashboardWidgets,
  signBrowserInWithSession,
  statusOptionId,
  waitForDashboardSync,
  waitForDatabaseContext,
} from './dashboard-test-helpers';
import { configureView, ViewConfig, waitForViewSync } from './dashboard-usecase-helpers';
import { EMPLOYEE_FIELDS, seededEmployeesDatabase } from './employees-database';
import { expandSpaceByName } from './page-utils';
import { DatabaseViewSelectors, PageSelectors } from './selectors';
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
export const HOST = 'Host';
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

export interface LeaveRecord {
  /** Node clock when the dashboard was left. */
  at: number;
  startCount: number;
  startedSources: Set<string>;
}

export interface LoadingScenario {
  /** A separate, empty document in the fixture space for full-page warm returns. */
  awayDocumentId?: string;
  /** In layout order: top to bottom, left to right. */
  widgets: LoadingWidget[];
  recorder?: SourceRequestRecorder;
  /**
   * The page the dashboard is open on, when it is not the scenario's own
   * page (a read-only member's browser). Every recorder and check reads it.
   */
  viewer?: Page;
  /** Node clock when the dashboard was opened. */
  openedAt?: number;
  /** Node clock when the last row was scrolled into view. */
  scrolledAt?: number;
  /** Widget ids that intersected the viewport when the dashboard opened. */
  visibleAtOpen?: Set<string>;
  /** Widget ids that intersected the viewport after the last scroll. */
  visibleAfterScroll?: Set<string>;
  /** Response delay by database name, of "loads slowly" and "loads with a delay of". */
  slowDelays?: Record<string, number>;
  left?: LeaveRecord;
  /** The widget removed from the dashboard, and the node clock when it was. */
  removed?: { widget: LoadingWidget; at: number };
  /** The dashboard's counters before comparisons navigate into its source views. */
  completedStats?: DashboardLoadStatsSnapshot;
}

const scenarios = new WeakMap<Page, LoadingScenario>();

export function loadingScenario(page: Page): LoadingScenario {
  let scenario = scenarios.get(page);

  if (!scenario) {
    scenario = { widgets: [] };
    scenarios.set(page, scenario);
  }

  return scenario;
}

/** The page the scenario's dashboard is open on: the member's, once a member opened it. */
export function viewerOf(page: Page): Page {
  return loadingScenario(page).viewer ?? page;
}

export function recorderOf(page: Page): SourceRequestRecorder {
  const recorder = loadingScenario(page).recorder;

  if (!recorder) throw new Error('Dashboard load counters are not being recorded in this scenario');
  return recorder;
}

export function loadingWidgets(page: Page): LoadingWidget[] {
  const { widgets } = loadingScenario(page);

  if (widgets.length === 0) throw new Error('No dashboard has been built in this scenario');
  return widgets;
}

export function widgetLocatorOf(page: Page, widget: LoadingWidget): Locator {
  return DashboardSelectors.widget(viewerOf(page), widget.id);
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
export function nameView(page: Page, label: string, database: string, viewId: string) {
  const world = dashboardWorld(page);

  world.viewsByName = { ...world.viewsByName, [label]: { viewId, database } };
}

// ---------------------------------------------------------------------------
// Small databases
// ---------------------------------------------------------------------------

const SMALL_STATUS = ['Todo', 'Doing', 'Done'];

export function smallDatabaseSpec(name: string, rows: number): DatabaseSpec {
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
export async function addSmallDatabases(page: Page, request: APIRequestContext, sizes: Record<string, number>) {
  const names = Object.keys(sizes);

  // A few databases at a time: the server's storage write queue fills up under twelve at once.
  for (let index = 0; index < names.length; index += SMALL_DATABASE_BATCH) {
    const batch = names.slice(index, index + SMALL_DATABASE_BATCH);
    const specs = Object.fromEntries(batch.map((name) => [name, smallDatabaseSpec(name, sizes[name])]));

    await addFixtureDatabases(page, request, batch, specs, { prune: false, rowConcurrency: 8 });
  }

  for (const name of names) nameView(page, `${name} Grid`, name, fixtureDatabase(page, name).views.Grid);
}

/** Small databases created at the same time. */
const SMALL_DATABASE_BATCH = 4;

/** `count` small databases, `Source1` to `Source<count>`, each with its grid view. */
export async function addSmallSourceDatabases(page: Page, request: APIRequestContext, count: number) {
  await addSmallDatabases(
    page,
    request,
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`Source${index + 1}`, 4 + index]))
  );
}

/** Eight small databases, `Source1` to `Source8`, each with its grid view. */
export async function addEightSmallDatabases(page: Page, request: APIRequestContext) {
  await addSmallSourceDatabases(page, request, 8);
}

/**
 * Three small databases, `Pair1` to `Pair3`, each with two views for
 * dashboard widgets: its grid and a second grid sorted by Points.
 */
export async function addThreeSmallDatabasesWithTwoViews(page: Page, request: APIRequestContext) {
  const names = ['Pair1', 'Pair2', 'Pair3'];

  await addSmallDatabases(page, request, Object.fromEntries(names.map((name, index) => [name, 5 + index])));
  for (const name of names) {
    const database = fixtureDatabase(page, name);
    const config: ViewConfig = {
      layout: DatabaseViewLayout.Grid,
      filters: [],
      sorts: [{ fieldId: database.fieldIds.Points, condition: 1 }],
    };

    await openDatabasePage(page, name);
    const viewId = await createDatabaseViewThroughApi(page, request, {
      database: name,
      name: 'Sorted',
      folderLayout: ViewLayout.Grid,
    });

    await configureView(page, database.databaseId, viewId, config);
    await waitForViewSync(page, request, name, [viewId], () => configureView(page, database.databaseId, viewId, config));
    nameView(page, `${name} Sorted`, name, viewId);
  }
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
          ? {
              layout: DatabaseViewLayout.Grid,
              filters: [],
              sorts: [{ fieldId: database.fieldIds.Points, condition: 1 }],
            }
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
export const EMPLOYEES_VIEWS: EmployeesView[] = [
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

const EMPLOYEES_EXTRA_VIEWS: EmployeesView[] = [
  {
    name: 'Loading List',
    folderLayout: ViewLayout.List,
    config: { layout: DatabaseViewLayout.List, filters: [], sorts: [] },
  },
  {
    name: 'Loading Gallery',
    folderLayout: ViewLayout.Gallery,
    config: { layout: DatabaseViewLayout.Gallery, filters: [], sorts: [] },
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

  for (const spec of [...EMPLOYEES_VIEWS, ...EMPLOYEES_EXTRA_VIEWS].filter((view) => names.includes(view.name))) {
    let viewId =
      spec.config === null ? employees.views.Grid : folderViews.find((view) => view.name === spec.name)?.view_id;

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
async function createDashboard(page: Page, request: APIRequestContext, rows: string[][], host = HOST) {
  const world = dashboardWorld(page);

  if (host === HOST)
    await addFixtureDatabases(page, request, [HOST], { [HOST]: { fields: [], rows: [] } }, { prune: false });
  await openDatabasePage(page, host);
  world.dashboardViewId = await createDatabaseViewThroughApi(page, request, {
    database: host,
    name: 'Dashboard',
    folderLayout: ViewLayout.Dashboard,
  });
  world.dashboardHost = host;
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
  await createDashboardOverSourceDatabases(page, request, 8, 4);
}

/** One widget per small source database (`Source1` …), `perRow` to a dashboard row. */
export async function createDashboardOverSourceDatabases(
  page: Page,
  request: APIRequestContext,
  count: number,
  perRow: number
) {
  const labels = Array.from({ length: count }, (_, index) => `Source${index + 1} Grid`);
  const rows = Array.from({ length: Math.ceil(count / perRow) }, (_, index) =>
    labels.slice(index * perRow, (index + 1) * perRow)
  );

  await createDashboard(page, request, rows);
}

/** Six widgets over the three `Pair` databases: each database's two views side by side in its own row. */
export async function createDashboardOverDatabasePairs(page: Page, request: APIRequestContext) {
  await createDashboard(
    page,
    request,
    ['Pair1', 'Pair2', 'Pair3'].map((name) => [`${name} Grid`, `${name} Sorted`])
  );
}

/** A dashboard whose rows hold these named views (labels the world knows). */
export async function createDashboardOfViews(page: Page, request: APIRequestContext, rows: string[][]) {
  await createDashboard(page, request, rows);
}

/** Twelve widgets showing the twelve employees views, in three rows of four. */
export async function createDashboardOverEmployeesViews(page: Page, request: APIRequestContext) {
  const labels = EMPLOYEES_VIEWS.map((view) => `${EMPLOYEES} ${view.name}`);

  await createDashboard(page, request, [labels.slice(0, 4), labels.slice(4, 8), labels.slice(8)]);
}

/** The same twelve views, hosted by their source database, in four rows of three. */
export async function createDashboardInsideEmployees(page: Page, request: APIRequestContext) {
  const labels = EMPLOYEES_VIEWS.map((view) => `${EMPLOYEES} ${view.name}`);

  await createDashboard(
    page,
    request,
    Array.from({ length: 4 }, (_, index) => labels.slice(index * 3, index * 3 + 3)),
    EMPLOYEES
  );
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

export type SourceRequestKind = 'document' | 'blob';

/**
 * What a blob/diff request asks for: every row from the start (`full`, one
 * pass over the database), the rows changed since a cursor the tab holds
 * (`delta`), or the next page of a walk (`page`).
 */
export type BlobRequestKind = 'full' | 'delta' | 'page';

export interface SourceRequest {
  sourceId: string;
  kind: SourceRequestKind;
  url: string;
  /** Node clock. */
  start: number;
  end?: number;
  /** The request failed (aborted, refused, offline) instead of answering. */
  failed?: boolean;
  body?: string;
  /** For a blob/diff request: what it asks for. */
  blob?: BlobRequestKind;
}

let blobDiffRequestType: ProtobufType | null = null;

/** Read a blob/diff request body with the protocol's schema (the generated module is built for the app bundler). */
function classifyBlobRequest(body: Buffer | null | undefined): BlobRequestKind {
  if (!blobDiffRequestType) {
    const schema = fileURLToPath(new URL('../../src/proto/database_blob.proto', import.meta.url));

    blobDiffRequestType = protobuf.loadSync(schema).lookupType('database_blob.DatabaseBlobDiffRequest');
  }

  const request = blobDiffRequestType.decode(new Uint8Array(body ?? Buffer.alloc(0))) as unknown as {
    maxKnownRid?: unknown;
    page?: { cursor?: Uint8Array };
  };

  // Every request of a walk carries its page limits; only a continuation carries the server's cursor.
  if ((request.page?.cursor?.length ?? 0) > 0) return 'page';
  return request.maxKnownRid ? 'delta' : 'full';
}

/**
 * Records the document and blob/diff requests of each source database: the
 * database collab, the page-view of one of its views (which carries the
 * database collab) and its blob walk. Permission probes and row requests do
 * not count.
 */
export class SourceRequestRecorder {
  readonly requests: SourceRequest[] = [];
  /**
   * Other requests that name a source database, its page or one of its views
   * (permission probes, view metadata, row documents): not a load, but the
   * first thing to read when a load was recorded without a request.
   */
  readonly others: { sourceId: string; url: string; start: number }[] = [];
  private readonly open = new Map<Request, SourceRequest>();

  constructor(page: Page, private readonly sources: { databaseId: string; viewIds: string[] }[]) {
    page.on('request', (request) => this.onRequest(request));
    page.on('requestfinished', (request) => this.onEnd(request, false));
    page.on('requestfailed', (request) => this.onEnd(request, true));
  }

  /** The source database a URL names (its id, its page or one of its views), if any. */
  private sourceNamedBy(url: string): string | null {
    const source = this.sources.find(
      ({ databaseId, viewIds }) => url.includes(databaseId) || viewIds.some((viewId) => url.includes(viewId))
    );

    return source?.databaseId ?? null;
  }

  private classify(url: URL, method: string): { sourceId: string; kind: SourceRequestKind } | null {
    const path = url.pathname;

    for (const { databaseId, viewIds } of this.sources) {
      if (new RegExp(`/database/${databaseId}/blob(?:/|$)`).test(path)) return { sourceId: databaseId, kind: 'blob' };
      // The database document as binary: a POST of the full-sync endpoint with
      // no update (`getDatabaseCollabBinary`), the app's first choice.
      if (method === 'POST' && new RegExp(`/collab/${databaseId}/full-sync$`).test(path)) {
        return { sourceId: databaseId, kind: 'document' };
      }

      // Reading the document as JSON: a write (a rename, an owner marker) loads nothing.
      if (method !== 'GET') continue;
      if (new RegExp(`/collab/${databaseId}$`).test(path)) return { sourceId: databaseId, kind: 'document' };
      if (viewIds.some((viewId) => path.endsWith(`/page-view/${viewId}`))) {
        return { sourceId: databaseId, kind: 'document' };
      }
    }

    return null;
  }

  private onRequest(request: Request) {
    const match = this.classify(new URL(request.url()), request.method());

    if (!match) {
      const sourceId = this.sourceNamedBy(request.url());

      if (sourceId) this.others.push({ sourceId, url: `${request.method()} ${request.url()}`, start: Date.now() });
      return;
    }

    const body = match.kind === 'blob' ? request.postDataBuffer() : null;
    const entry: SourceRequest = {
      ...match,
      url: request.url(),
      start: Date.now(),
      body: body?.toString('base64'),
      blob: match.kind === 'blob' ? classifyBlobRequest(body) : undefined,
    };

    this.requests.push(entry);
    this.open.set(request, entry);
  }

  private onEnd(request: Request, failed: boolean) {
    const entry = this.open.get(request);

    if (!entry) return;
    entry.end = Date.now();
    entry.failed = failed;
    this.open.delete(request);
  }

  since(from: number) {
    return this.requests.filter((entry) => entry.start >= from);
  }

  /** The requests of one source database since `from`. */
  ofSource(sourceId: string, from = 0) {
    return this.since(from).filter((entry) => entry.sourceId === sourceId);
  }

  /** When the first request of each source database since `from` started. */
  firstRequestAt(from: number): Map<string, number> {
    const first = new Map<string, number>();

    this.since(from).forEach((entry) => {
      if (!first.has(entry.sourceId) || entry.start < (first.get(entry.sourceId) as number)) {
        first.set(entry.sourceId, entry.start);
      }
    });
    return first;
  }

  /** The most distinct sources that had a request in flight at the same time. */
  maxConcurrentSources(from: number): number {
    return this.peak(from).sources;
  }

  /**
   * The moment the most distinct sources had a request in flight: how many,
   * when, and the requests in flight then (for a failure message).
   */
  peak(from: number): { sources: number; at: number; inFlight: SourceRequest[] } {
    const entries = this.since(from);
    const events = entries.flatMap((entry) => [
      { at: entry.start, entry, delta: 1 },
      { at: entry.end ?? Number.POSITIVE_INFINITY, entry, delta: -1 },
    ]);
    // Ends before starts at the same instant: a slot handed over is not an overlap.
    const ordered = events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    const open = new Set<SourceRequest>();
    let best = { sources: 0, at: from, inFlight: [] as SourceRequest[] };

    for (const event of ordered) {
      if (event.delta > 0) open.add(event.entry);
      else open.delete(event.entry);
      const sources = new Set([...open].map((entry) => entry.sourceId)).size;

      if (sources > best.sources) best = { sources, at: event.at, inFlight: [...open] };
    }

    return best;
  }

  /** The peak as text: when, and each request in flight with its times relative to `from`. */
  describePeak(from: number, nameOf: (sourceId: string) => string = (id) => id): string {
    const { sources, at, inFlight } = this.peak(from);
    const rel = (t: number | undefined) => (t === undefined ? 'open' : `${t - from} ms`);

    return [
      `${sources} sources in flight at ${rel(at)}:`,
      ...inFlight.map(
        (entry) =>
          `  ${nameOf(entry.sourceId)} ${entry.kind} ${rel(entry.start)} → ${rel(entry.end)} ${
            new URL(entry.url).pathname
          }`
      ),
    ].join('\n');
  }
}

interface PageRecorderOptions {
  key: string;
  /** Forget what was recorded so far (the dashboard opens again in this document). */
  reset: boolean;
}

/**
 * The page side: when each widget frame, its waiting look and its first data
 * appeared (at every DOM change), and a look at every widget every 100 ms.
 *
 * - waiting: the widget shows its header and the loading placeholder, which
 *   is what a widget waiting for a load slot shows (and a started widget
 *   while its source document opens);
 * - loading: the placeholder or a loading row (`role="status"`), a chart's
 *   loading state, the board's skeleton or a grid still reading its rows;
 * - empty: a mounted view with nothing in it and nothing loading, what a
 *   user reads as "no results": an empty grid, board, list, month or lane;
 * - error: a placeholder that is not the loading one (not found, no access,
 *   offline) or an alert.
 */
function recordWidgetsInPage({ key, reset }: PageRecorderOptions) {
  const win = window as unknown as Record<string, any>;
  const scanKey = `${key}:scan`;
  const ROWS_NOT_LOADED = "Some rows haven't loaded yet";

  if (win[key]) {
    if (!reset) return;
    Object.assign(win[key], { since: Date.now(), frames: {}, data: {}, waiting: {}, ready: {}, samples: [] });
    win[scanKey]?.();
    return;
  }

  const state: {
    since: number;
    frames: Record<string, number>;
    data: Record<string, number>;
    waiting: Record<string, number>;
    ready: Record<string, number>;
    samples: Record<string, unknown>[];
  } = { since: Date.now(), frames: {}, data: {}, waiting: {}, ready: {}, samples: [] };

  win[key] = state;
  const count = (widget: Element, selector: string) => widget.querySelectorAll(selector).length;
  const read = (widget: Element) => {
    const grid = widget.querySelector('[data-testid="database-grid"]');
    const placeholder = widget.querySelector('[data-testid="dashboard-widget-placeholder"]');
    const number = widget.querySelector('[data-testid="number-chart"]');
    const rows = count(widget, '[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
    const cards = count(widget, '.board-card');
    const listRows = count(widget, '[data-testid^="list-primary-cell-"]');
    const chartRows = count(widget, '[data-testid="chart-data-table"] tr[data-label]');
    const events = count(widget, '.fc-event');
    const bars = count(widget, '[data-testid^="timeline-bar-"]:not([data-testid="timeline-bar-hover-card"])');
    const numberShown = number?.getAttribute('data-empty') === 'false';
    const galleryCards = count(widget, '[data-testid^="gallery-tile-"]');
    const hasData =
      galleryCards > 0 ||
      rows > 0 ||
      cards > 0 ||
      listRows > 0 ||
      chartRows > 0 ||
      events > 0 ||
      bars > 0 ||
      numberShown;
    const reason = placeholder?.getAttribute('data-reason') ?? null;
    const loading =
      reason === 'loading' ||
      Boolean(
        widget.querySelector(
          [
            '[data-testid="grid-loading-indicator"]',
            '[data-testid="chart-loading"]',
            // The board's columns before its first row grouping (`Group.tsx`).
            '[data-testid="kanban-skeleton"]',
            '[role="status"]',
            '[aria-busy="true"]',
          ].join(', ')
        )
      ) ||
      grid?.getAttribute('data-hydrating') === 'true';
    const content = Boolean(
      grid ||
        widget.querySelector(
          [
            '.database-board',
            '[data-testid="database-list"]',
            '[data-testid="database-gallery"]',
            '[data-testid="database-chart"]',
            '[data-testid="number-chart"]',
            '[data-testid="calendar-toolbar"]',
            '.fc',
            '[data-testid="timeline-view"]',
          ].join(', ')
        )
    );
    const chartValues = Array.from(widget.querySelectorAll('[data-testid="chart-data-table"] tr[data-label]'))
      .map((row) => `${row.getAttribute('data-key') ?? ''}=${row.getAttribute('data-value') ?? ''}`)
      .sort()
      .join(' ');
    const numberValue = numberShown
      ? (widget.querySelector('[data-testid="number-chart-value"]')?.textContent ?? '').trim()
      : '';
    // A real failure says so (LOADING-DESIGN R8); it is neither empty nor still loading.
    const failed = (widget.textContent ?? '').includes(ROWS_NOT_LOADED);

    return {
      header: Boolean(
        widget.querySelector('[data-testid="dashboard-widget-header"], [data-testid="dashboard-widget-tool-capsule"]')
      ),
      placeholder: reason,
      hasData,
      loading,
      failed,
      // A mounted view with nothing in it and nothing loading: what a user reads as "no results".
      empty:
        !hasData &&
        !loading &&
        !failed &&
        (content || Boolean(widget.querySelector('[data-testid="chart-no-data"], [data-testid="number-chart-empty"]'))),
      error: (reason !== null && reason !== 'loading') || Boolean(widget.querySelector('[role="alert"]')),
      // What a chart or a Number chart shows: its value, or its value per category.
      result: numberValue ? `number ${numberValue}` : chartValues ? `chart ${chartValues}` : '',
    };
  };

  const scan = () => {
    const now = Date.now();
    const current = win[key] as typeof state;

    document.querySelectorAll('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.getAttribute('data-widget-id');

      if (!id || current.data[id] !== undefined) return;
      const look = read(widget);

      if (look.header && current.frames[id] === undefined) current.frames[id] = now;
      if (look.header && look.placeholder === 'loading' && current.waiting[id] === undefined) {
        current.waiting[id] = now;
      }

      if (look.header && look.placeholder === null && current.ready[id] === undefined) current.ready[id] = now;

      if (look.hasData) current.data[id] = now;
    });
  };

  win[scanKey] = scan;
  new MutationObserver(scan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-row-count', 'data-hydrating', 'data-empty', 'data-reason'],
  });
  window.setInterval(() => {
    const t = Date.now();
    const current = win[key] as typeof state;

    document.querySelectorAll('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.getAttribute('data-widget-id');

      if (id) current.samples.push({ t, id, ...read(widget) });
    });
  }, 100);
  scan();
}

export interface WidgetSample {
  /** ms since the epoch (the browser and Node share the clock). */
  t: number;
  id: string;
  header: boolean;
  placeholder: string | null;
  hasData: boolean;
  loading: boolean;
  empty: boolean;
  error: boolean;
  /** The widget says "Some rows haven't loaded yet". */
  failed: boolean;
  /** A chart's values or a Number chart's value; empty for other views. */
  result: string;
}

export interface PageRecord {
  /** When the recording started (or was reset). */
  since: number;
  frames: Record<string, number>;
  data: Record<string, number>;
  /** When each widget was first seen with its header and the loading placeholder. */
  waiting: Record<string, number>;
  /** When each widget was first seen with its header and no placeholder: its source document is open. */
  ready: Record<string, number>;
  samples: WidgetSample[];
}

export async function readPageRecord(page: Page): Promise<PageRecord> {
  const record = await viewerOf(page).evaluate((key) => (window as any)[key] ?? null, RECORDER_KEY);

  if (!record) throw new Error('The dashboard was not opened while its load counters were recorded');
  return record as PageRecord;
}

/** Forget the page recorder's looks: the dashboard opens again in this document. */
export async function resetPageRecorder(page: Page) {
  await viewerOf(page).evaluate(recordWidgetsInPage, { key: RECORDER_KEY, reset: true });
}

/** The app's load counters (`window.__DASHBOARD_LOAD_STATS__`) of `page`, or of the scenario's viewer. */
export async function loadStats(page: Page): Promise<DashboardLoadStatsSnapshot> {
  const stats = await viewerOf(page).evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.snapshot() ?? null);

  expect(stats, 'the app exposes no dashboard load counters (window.__DASHBOARD_LOAD_STATS__)').not.toBeNull();
  return stats as DashboardLoadStatsSnapshot;
}

/** What the request recorder watches: each source database and the views it is loaded through. */
function recordedSources(page: Page) {
  const scenario = loadingScenario(page);

  return sourceDatabaseNames(page).map((name) => {
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
}

/** Record on `viewer` from its next document on: its requests, its widgets and the app's counters. */
export async function recordLoadsOn(page: Page, viewer: Page) {
  const scenario = loadingScenario(page);

  scenario.recorder = new SourceRequestRecorder(viewer, recordedSources(page));
  await viewer.addInitScript(recordWidgetsInPage, { key: RECORDER_KEY, reset: false });
}

/**
 * Record the next dashboard open: the page recorder starts with the next
 * document (and in this one, for a reopen inside the app), the request
 * recorder now; the app's counters start empty.
 */
export async function startLoadRecording(page: Page) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);

  scenario.recorder ??= new SourceRequestRecorder(viewer, recordedSources(page));
  await viewer.addInitScript(recordWidgetsInPage, { key: RECORDER_KEY, reset: false });
  await viewer.evaluate(recordWidgetsInPage, { key: RECORDER_KEY, reset: true });
  await viewer.evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.reset());
}

// ---------------------------------------------------------------------------
// Opening and leaving
// ---------------------------------------------------------------------------

/** The ids a request of `name` names in its URL: the database, its page and its views. */
export function databaseUrlIds(page: Page, name: string): string[] {
  const database = fixtureDatabase(page, name);
  const widgetViews = loadingScenario(page)
    .widgets.filter((widget) => widget.database === name)
    .map((widget) => widget.viewId);

  return [...new Set([database.databaseId, database.pageId, ...Object.values(database.views), ...widgetViews])];
}

/** Hold every response of these databases back by their delay (ms). */
export async function slowDownSources(page: Page, delays: Record<string, number>) {
  const byId = new Map<string, number>();

  Object.entries(delays).forEach(([name, delay]) => {
    databaseUrlIds(page, name).forEach((id) => byId.set(id, Math.max(delay, byId.get(id) ?? 0)));
    if (name === EMPLOYEES) {
      seededEmployeesDatabase().rowIds.forEach((id) => byId.set(id, Math.max(delay, byId.get(id) ?? 0)));
    }
  });
  const batchType = protobuf
    .loadSync(fileURLToPath(new URL('../../src/proto/collab.proto', import.meta.url)))
    .lookupType('collab.CollabBatchSyncRequest');
  const delayOf = (request: Request) => {
    const ids: string[] = request.url().match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi) ?? [];

    if (request.url().endsWith('/collab/full-sync/batch')) {
      const body = request.postDataBuffer();

      if (body) {
        const batch = batchType.decode(body) as unknown as { items?: { objectId?: string }[] };

        ids.push(...(batch.items ?? []).map((item) => item.objectId ?? ''));
      }
    }

    return Math.max(0, ...ids.map((id) => byId.get(id) ?? 0));
  };

  loadingScenario(page).slowDelays = { ...delays };
  await viewerOf(page).route('**/api/**', async (route: Route) => {
    const delay = delayOf(route.request());

    if (!delay) {
      await route.fallback();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    // The page may have left (or closed) while the response was held back.
    await route.continue().catch(() => undefined);
  });
}

/**
 * Open the scenario's dashboard in a new document with nothing cached; with
 * `slow`, every response of those databases is held back (3 s, or the delay
 * given per database), also with nothing cached, so the delay holds the load.
 */
export async function openDashboardCold(page: Page, slow: string[] | Record<string, number> = []) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const url = new URL(`/app/${world.workspaceId}/${host.pageId}?v=${dashboardViewId(page)}`, viewer.url()).toString();
  const delays = Array.isArray(slow)
    ? Object.fromEntries(slow.map((name) => [name, SLOW_SOURCE_DELAY_MS] as const))
    : slow;

  await clearCachedDatabaseStorage(viewer);
  if (Object.keys(delays).length > 0) await slowDownSources(page, delays);
  scenario.openedAt = Date.now();
  await viewer.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(viewer)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(viewer));
}

/** Widget ids whose box intersects the viewport. */
export async function widgetsInViewport(viewer: Page): Promise<string[]> {
  return DashboardSelectors.widgets(viewer).evaluateAll((widgets) =>
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
  const viewer = viewerOf(page);
  const total = loadingWidgets(page).length;
  const deadline = Date.now() + LOAD_TIMEOUT_MS;

  for (;;) {
    const starts = (await loadStats(page)).widgetStarts.length;

    // Every widget started before the step could leave: there is no queue left to cancel.
    if (starts >= total) throw new Error(`all ${total} widgets started before the dashboard could be left`);
    if (starts >= 2) break;
    if (Date.now() > deadline) throw new Error(`only ${starts} widgets started in ${LOAD_TIMEOUT_MS} ms`);
    await viewer.waitForTimeout(50);
  }

  await DatabaseViewSelectors.viewTab(viewer, hostDatabase(page).views.Grid).click();
  await expect(DashboardSelectors.view(viewer)).toHaveCount(0, WIDGET_TIMEOUT);
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
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);

  await DashboardSelectors.rows(viewer).last().scrollIntoViewIfNeeded();
  scenario.scrolledAt = Date.now();
  scenario.visibleAfterScroll = new Set(await widgetsInViewport(viewer));
}

/**
 * Open the scenario's dashboard and wait until every widget completed its
 * load, so every source's rows are resident in the tab.
 */
export async function openDashboardUntilLoaded(page: Page) {
  await openDashboardCold(page);
  const widgets = loadingWidgets(page);

  await expect
    .poll(
      async () => {
        const { widgetComplete } = await loadStats(page);

        return widgets.filter((widget) => widgetComplete[widget.id] === undefined).map((widget) => widget.label);
      },
      { timeout: LOAD_TIMEOUT_MS, message: 'waiting for every widget to complete its load' }
    )
    .toEqual([]);
  for (const widget of widgets) await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`);
}

/**
 * Leave the dashboard for the host's grid tab, wait `awayMs`, and open the
 * dashboard tab again: inside the app, so what the tab holds stays. Returns
 * how long the dashboard was gone.
 */
export async function leaveAndReturnInApp(page: Page, awayMs = 0): Promise<number> {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);

  await DatabaseViewSelectors.viewTab(viewer, hostDatabase(page).views.Grid).click();
  await expect(DashboardSelectors.view(viewer)).toHaveCount(0, WIDGET_TIMEOUT);
  const leftAt = Date.now();

  if (awayMs > 0) await viewer.waitForTimeout(awayMs);
  await resetPageRecorder(page);
  scenario.openedAt = Date.now();
  await DatabaseViewSelectors.viewTab(viewer, dashboardViewId(page)).click();
  await expect(DashboardSelectors.view(viewer)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(viewer));
  return scenario.openedAt - leftAt;
}

/** Leave the database page entirely, retaining the same browser document and its resident cache. */
export async function leaveForDocumentAndReturn(page: Page, request: APIRequestContext, awayMs = 0): Promise<number> {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);
  const world = dashboardWorld(page);

  if (!scenario.awayDocumentId) {
    const created = await apiPost<{ view_id: string }>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/page-view`,
      { parent_view_id: world.spaceId, layout: ViewLayout.Document, name: 'Warm-return destination' }
    );

    scenario.awayDocumentId = created.view_id;
  }

  await expandSpaceByName(viewer, world.spaceName);
  const destination = PageSelectors.pageByViewId(viewer, scenario.awayDocumentId);

  await expect(destination).toBeVisible(WIDGET_TIMEOUT);
  const dashboardUrl = viewer.url();
  const timeOrigin = await viewer.evaluate(() => performance.timeOrigin);

  await destination.click();
  await expect(DashboardSelectors.view(viewer)).toHaveCount(0, WIDGET_TIMEOUT);
  const leftAt = Date.now();

  await expect(viewer).toHaveURL(new RegExp(`/app/${world.workspaceId}/${scenario.awayDocumentId}(?:[?#]|$)`));
  await expect(viewer.locator(`#editor-${scenario.awayDocumentId}`)).toBeVisible(WIDGET_TIMEOUT);
  if (awayMs > 0) await viewer.waitForTimeout(awayMs);
  await resetPageRecorder(page);
  scenario.openedAt = Date.now();
  await viewer.goBack();
  await expect(viewer).toHaveURL(dashboardUrl);
  await expect(DashboardSelectors.view(viewer)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  expect(await viewer.evaluate(() => performance.timeOrigin), 'warm return stays in the same browser document').toBe(timeOrigin);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(viewer));
  return scenario.openedAt - leftAt;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** A derived result must read the same this long after it first showed. */
const STABLE_RESULT_MS = 1_000;

/**
 * What a view shows once it has loaded, read the same way in a widget and on
 * the view's own page: a grid's row count and first row, a board's cards per
 * column, a chart's value per category, a Number chart's value. `null` while
 * it still loads.
 */
export async function readResult(scope: Locator): Promise<string | null> {
  return scope.evaluate((element) => {
    if (element.querySelector('[data-testid="dashboard-widget-placeholder"], [data-testid="chart-loading"]'))
      return null;
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

    for (const kind of ['list', 'gallery']) {
      const surface = element.querySelector(`[data-testid="database-${kind}"]`);

      if (!surface) continue;
      if (surface.querySelector('[data-testid="gallery-loading"], [role="status"]')) return null;
      const selector =
        kind === 'list' ? '[data-testid^="list-row-"][data-row-id]' : '[data-testid^="gallery-tile-"][data-row-id]';
      const rows = Array.from(surface.querySelectorAll(selector)).map(
        (row) => row.getAttribute('data-row-id') ?? row.getAttribute('data-testid')!.replace('gallery-card-', '')
      );

      return rows.length ? `${kind} first rows ${rows.slice(0, 5).join(',')}` : null;
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

/**
 * The result `scope` shows once it finished loading: the first result that
 * still reads the same `STABLE_RESULT_MS` later (a derived result that is
 * still being completed changes in between).
 */
export async function settledResult(scope: Locator, what: string, timeout = LOAD_TIMEOUT_MS): Promise<string> {
  const deadline = Date.now() + timeout;
  let previous: string | null = null;

  for (;;) {
    const result = await readResult(scope).catch(() => null);

    if (result !== null && result === previous) return result;
    if (Date.now() > deadline) {
      throw new Error(`${what} did not settle in ${timeout} ms (last read: ${String(result)})`);
    }

    previous = result;
    await scope.page().waitForTimeout(result === null ? 250 : STABLE_RESULT_MS);
  }
}

/** Open a widget's source view on the viewer's page: the owner's fixture navigation, or the member's URL. */
async function openSourceView(page: Page, widget: LoadingWidget) {
  const viewer = viewerOf(page);

  if (viewer === page) {
    await openDatabasePage(page, widget.database, widget.viewId);
    return;
  }

  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, widget.database);

  await viewer.goto(`/app/${world.workspaceId}/${database.pageId}?v=${widget.viewId}`, {
    waitUntil: 'domcontentloaded',
  });
  const tab = DatabaseViewSelectors.viewTab(viewer, widget.viewId);

  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
}

/** Each widget, once loaded, shows what its source view shows on the view's own page. */
export async function expectWidgetsMatchTheirSourceViews(
  page: Page,
  widgets: LoadingWidget[],
  beforeSourceComparison?: () => Promise<void>
) {
  const shown: { widget: LoadingWidget; result: string }[] = [];

  for (const widget of widgets) {
    shown.push({ widget, result: await settledResult(widgetLocatorOf(page, widget), `the "${widget.label}" widget`) });
  }

  loadingScenario(page).completedStats = await loadStats(page);
  await beforeSourceComparison?.();

  for (const { widget, result } of shown) {
    await openSourceView(page, widget);
    const source = await settledResult(viewerOf(page).locator('body'), `the "${widget.label}" view`);

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

/**
 * Wait until each of `widgets` is done: it shows data, or its latest look is
 * a placeholder for good (not found, no access, offline) or a failure.
 * Resolves to the page record of that moment.
 */
export async function waitForWidgetsSettled(
  page: Page,
  widgets: LoadingWidget[],
  timeout = LOAD_TIMEOUT_MS
): Promise<PageRecord> {
  let record: PageRecord | null = null;

  await expect
    .poll(
      async () => {
        record = await readPageRecord(page);
        const { data, samples } = record;
        const latest = new Map(samples.map((sample) => [sample.id, sample]));

        return widgets
          .filter((widget) => {
            const look = latest.get(widget.id);

            return data[widget.id] === undefined && !(look?.error || look?.failed);
          })
          .map((widget) => widget.label);
      },
      { timeout, message: 'waiting for the widgets to show data, a placeholder or a failure' }
    )
    .toEqual([]);
  return record as unknown as PageRecord;
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

  // Every visible widget is done: it shows data, or it ended on a placeholder or a failure.
  const { data } = await waitForWidgetsSettled(page, visibleWidgets(page));
  const stats = await loadStats(page);
  const started = new Set(stats.widgetStarts.map((start) => start.sourceId));
  const loaded = new Set(stats.sourceLoads.map((load) => load.sourceId));
  const delivered = new Set(
    loadingWidgets(page)
      .filter((widget) => data[widget.id] !== undefined)
      .map((widget) => fixtureDatabase(page, widget.database).databaseId)
  );

  // The counters were recorded: every started source took a slot (the host needs none).
  expect(stats.widgetStarts.length, 'no widget start was recorded').toBeGreaterThan(0);
  expect(
    [...started].filter((id) => id !== host && !loaded.has(id)),
    'started sources without a slot'
  ).toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'sources loading at once (the app counter)').toBeLessThanOrEqual(cap);
  // The network record is evidence only if it saw the loads: every source
  // that took a slot and delivered rows sent a request the recorder saw (a
  // source that ended on a placeholder may have stopped before any).
  expect(delivered.size, 'source databases whose widgets showed data').toBeGreaterThan(0);
  expectRequestsSeenFor(
    page,
    [...loaded].filter((id) => id !== host && delivered.has(id))
  );
  expect(
    recorderOf(page).maxConcurrentSources(scenario.openedAt ?? 0),
    `source databases with a document or blob/diff request in flight at once\n${describeRequestPeak(page, stats)}`
  ).toBeLessThanOrEqual(cap);
}

/** The request recorder saw at least one document or blob/diff request of each of these databases since the open. */
export function expectRequestsSeenFor(page: Page, databaseIds: string[]) {
  const scenario = loadingScenario(page);
  const recorder = recorderOf(page);
  const from = scenario.openedAt ?? 0;
  const nameOf = (id: string) =>
    sourceDatabaseNames(page).find((name) => fixtureDatabase(page, name).databaseId === id) ?? id;
  const unseen = databaseIds.filter((id) => recorder.ofSource(id, from).length === 0);
  const others = recorder.others
    .filter((entry) => unseen.includes(entry.sourceId) && entry.start >= from)
    .map((entry) => `  ${nameOf(entry.sourceId)} ${entry.start - from} ms ${entry.url}`);

  expect(
    unseen.map(nameOf),
    [
      'source databases that loaded without a request the recorder saw (the recorder matched none of their URLs)',
      ...(others.length > 0 ? ['other requests naming them:', ...others] : []),
    ].join('\n')
  ).toEqual([]);
}

/**
 * The cap was reached: at the peak exactly `maxConcurrentSources` (2) source
 * databases loaded at once, by the app's counter and by the requests in
 * flight, and the recorder saw requests of every source database.
 */
export async function expectPeakOfTwoSources(page: Page) {
  const scenario = loadingScenario(page);
  const cap = DASHBOARD_LOADING.maxConcurrentSources;
  const ids = sourceDatabaseNames(page).map((name) => fixtureDatabase(page, name).databaseId);

  await waitForWidgetData(page, loadingWidgets(page));
  expectRequestsSeenFor(page, ids);
  const stats = await loadStats(page);

  expect(stats.maxConcurrentSourceLoads, 'sources loading at once at the peak (the app counter)').toBe(cap);
  expect(
    recorderOf(page).maxConcurrentSources(scenario.openedAt ?? 0),
    `source databases with a document or blob/diff request in flight at once, at the peak\n${describeRequestPeak(
      page,
      stats
    )}`
  ).toBe(cap);
}

/**
 * What happened to one widget's source, for a failure message: the widget's
 * frame, waiting look, start and first data, its source's slot and every
 * request naming the source, in ms since the open.
 */
export async function sourceTimeline(page: Page, widget: LoadingWidget): Promise<string> {
  const from = loadingScenario(page).openedAt ?? 0;
  const { databaseId } = fixtureDatabase(page, widget.database);
  const recorder = recorderOf(page);
  const stats = await loadStats(page);
  const record = await readPageRecord(page);
  const rel = (t: number | null | undefined) => (t === undefined || t === null ? '-' : `${t - from} ms`);
  const start = stats.widgetStarts.find((entry) => entry.widgetId === widget.id);
  const slots = stats.sourceLoads.filter((load) => load.sourceId === databaseId);

  return [
    `  ${widget.label}: frame ${rel(record.frames[widget.id])}, waiting ${rel(record.waiting[widget.id])}, start ${rel(
      start?.at
    )}, data ${rel(record.data[widget.id])}`,
    ...slots.map((slot) => `  slot ${rel(slot.start)} → ${rel(slot.end)}`),
    ...recorder
      .ofSource(databaseId, from)
      .map(
        (entry) =>
          `  ${entry.kind}${entry.blob ? ` ${entry.blob}` : ''} ${rel(entry.start)} → ${rel(entry.end)} ${entry.url}`
      ),
    ...recorder.others
      .filter((entry) => entry.sourceId === databaseId && entry.start >= from)
      .map((entry) => `  other ${rel(entry.start)} ${entry.url}`),
  ].join('\n');
}

/** The request peak and the app's slot intervals, for a failure message. */
export function describeRequestPeak(page: Page, stats?: DashboardLoadStatsSnapshot): string {
  const from = loadingScenario(page).openedAt ?? 0;
  const nameOf = (id: string) =>
    sourceDatabaseNames(page).find((name) => fixtureDatabase(page, name).databaseId === id) ?? id;
  const slots = (stats?.sourceLoads ?? []).map(
    (load) =>
      `  ${nameOf(load.sourceId)} slot ${load.start - from} ms → ${load.end === null ? 'open' : `${load.end - from} ms`}`
  );

  return [recorderOf(page).describePeak(from, nameOf), ...(slots.length > 0 ? ['app slots:', ...slots] : [])].join('\n');
}

/**
 * The widgets that waited for a source (those of the third and later source
 * databases to send a request) were each seen with their header and the
 * loading placeholder before their database's first request, at a DOM change
 * and in the 100 ms looks, and never empty or in error while they waited.
 */
export async function expectWaitersSeenWaiting(page: Page) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);
  const cap = DASHBOARD_LOADING.maxConcurrentSources;

  await waitForWidgetData(page, widgets);
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const waited = new Set(order.slice(cap));
  const { waiting, samples } = await readPageRecord(page);
  const waiters = widgets.filter((widget) => waited.has(fixtureDatabase(page, widget.database).databaseId));

  expect(order.length, 'source databases whose requests the recorder saw').toBe(sourceDatabaseNames(page).length);
  expect(waiters.length, 'widgets that had to wait for a source').toBeGreaterThan(0);
  const { widgetStarts } = await loadStats(page);

  for (const widget of waiters) {
    const requestedAt = first.get(fixtureDatabase(page, widget.database).databaseId) as number;
    // The wait ends with the source's first request, or earlier when the app started the
    // widget first (a source whose document stayed open sends its first row request later).
    const startedAt = widgetStarts.find((start) => start.widgetId === widget.id)?.at ?? Number.POSITIVE_INFINITY;
    const waitEnded = Math.min(requestedAt, startedAt);
    const looks = samples.filter((sample) => sample.id === widget.id && sample.t < waitEnded);
    const timeline = await sourceTimeline(page, widget);

    expect(
      waiting[widget.id],
      `the "${widget.label}" widget was never seen waiting with its header and placeholder\n${timeline}`
    ).toBeDefined();
    expect(
      waiting[widget.id],
      `the "${widget.label}" widget was first seen waiting after its source was requested (or it started)\n${timeline}`
    ).toBeLessThan(waitEnded);
    expect(looks.length, `looks at the "${widget.label}" widget while it waited`).toBeGreaterThan(0);
    expect(
      looks
        .filter((sample) => !sample.header || sample.placeholder !== 'loading' || sample.empty || sample.error)
        .map(
          (sample) =>
            `${sample.t - (scenario.openedAt ?? 0)} ms (header ${sample.header}, placeholder ${
              sample.placeholder
            }, empty ${sample.empty}, error ${sample.error})`
        ),
      `the "${widget.label}" widget waited without its header and loading placeholder\n${timeline}`
    ).toEqual([]);
  }
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

  // Independent of the app's start order: a widget whose database was the
  // third or later to be requested waited for a slot, and the page saw it
  // waiting (header and loading placeholder) before that request.
  const scenario = loadingScenario(page);
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const { waiting } = await readPageRecord(page);

  for (const sourceId of order.slice(DASHBOARD_LOADING.maxConcurrentSources)) {
    const requestedAt = first.get(sourceId) as number;

    for (const widget of widgets.filter(
      (candidate) => fixtureDatabase(page, candidate.database).databaseId === sourceId
    )) {
      expect(
        (waiting[widget.id] ?? Number.POSITIVE_INFINITY) < requestedAt,
        `the "${widget.label}" widget waited for its source without being seen with its header and loading placeholder`
      ).toBe(true);
    }
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

  await waitForWidgetData(
    page,
    loadingWidgets(page).filter((widget) => widget.database === name)
  );
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

  expect(
    firstData.every((at) => at !== undefined),
    'a visible widget never reported its first data'
  ).toBe(true);
  // Off-screen widgets may start once every visible one showed data, or
  // `deferredStartTimeoutMs` after the first visible one started, whichever
  // comes first: a slow visible source must not hold them back for good.
  const firstVisibleStart = Math.min(
    ...stats.widgetStarts.filter((start) => start.visibleAtStart).map((start) => start.at)
  );
  const deferralEnds = Math.min(Math.max(...firstData), firstVisibleStart + DASHBOARD_LOADING.deferredStartTimeoutMs);
  const requests = recorderOf(page).since(scenario.openedAt ?? 0);

  expect(Number.isFinite(firstVisibleStart), 'no visible widget start was recorded').toBe(true);
  for (const name of belowOnly) {
    const { databaseId } = fixtureDatabase(page, name);
    const early = requests.filter((entry) => entry.sourceId === databaseId && entry.start < deferralEnds);
    const earlyStarts = stats.widgetStarts.filter((start) => start.sourceId === databaseId && start.at < deferralEnds);

    expect(
      early.map((entry) => entry.url),
      `"${name}" requests before the visible widgets showed data (or the deferred timeout)`
    ).toEqual([]);
    expect(
      earlyStarts.length,
      `"${name}" widgets started before the visible widgets showed data (or the deferred timeout)`
    ).toBe(0);
  }
}

/** Each widget of the last row shows its rows, within `withinMs` of the scroll when given. */
export async function expectLastRowShowsRows(page: Page, withinMs?: number) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);
  const lastRow = Math.max(...widgets.map((widget) => widget.row));
  const timeout =
    withinMs === undefined
      ? LOAD_TIMEOUT_MS
      : Math.max(0, withinMs - (Date.now() - (scenario.scrolledAt ?? Date.now())));

  await Promise.all(
    widgets
      .filter((widget) => widget.row === lastRow)
      .map((widget) =>
        expect(
          gridDataRows(widgetLocatorOf(page, widget)).first(),
          `the "${widget.label}" widget shows no rows`
        ).toBeVisible({ timeout })
      )
  );
}

/** Each of `widgets` shows its rows within `withinMs` of the dashboard opening. */
export async function expectWidgetsShowRowsWithin(page: Page, widgets: LoadingWidget[], withinMs: number) {
  const openedAt = loadingScenario(page).openedAt ?? Date.now();

  expect(widgets.length, 'no widget to check').toBeGreaterThan(0);
  await Promise.all(
    widgets.map((widget) =>
      expect(
        gridDataRows(widgetLocatorOf(page, widget)).first(),
        `the "${widget.label}" widget shows no rows`
      ).toBeVisible({ timeout: Math.max(0, withinMs - (Date.now() - openedAt)) })
    )
  );
  const { data } = await readPageRecord(page);

  for (const widget of widgets) {
    expect(data[widget.id] - openedAt, `ms until the "${widget.label}" widget showed rows`).toBeLessThanOrEqual(
      withinMs
    );
  }
}

/** Nothing starts loading after the dashboard was left: no new widget start, no request for a source not started. */
export async function expectNothingStartsAfterLeaving(page: Page) {
  const left = loadingScenario(page).left;

  expect(left, 'the dashboard was not left in this scenario').toBeDefined();
  const { at, startCount, startedSources } = left as LeaveRecord;

  // Watch longer than two slow responses: a slot freed by a load that was in
  // flight when the dashboard was left would start a queued widget in it.
  await viewerOf(page).waitForTimeout(Math.max(0, at + 2 * SLOW_SOURCE_DELAY_MS + 1_000 - Date.now()));
  const stats = await loadStats(page);
  const late = recorderOf(page)
    .since(at)
    .filter((entry) => !startedSources.has(entry.sourceId));

  expect(stats.widgetStarts.slice(startCount), 'widgets that started after the dashboard was left').toEqual([]);
  expect(
    late.map((entry) => entry.url),
    'requests for sources that had not started when the dashboard was left'
  ).toEqual([]);
}

export function employeesWidgets(page: Page): LoadingWidget[] {
  return loadingWidgets(page).filter((widget) => widget.database === EMPLOYEES);
}

export function otherVisibleWidgets(page: Page): LoadingWidget[] {
  return visibleWidgets(page).filter((widget) => widget.database !== EMPLOYEES);
}

// ---------------------------------------------------------------------------
// Shared slots, reopening and leaving (missing-dashboard-tests M3, M4, M5)
// ---------------------------------------------------------------------------

/** Widgets of one database, started this close together, did not wait for a slot of their own. */
const SAME_PLAN_MS = 1_000;

/**
 * Both widgets of each source database started together (its second widget
 * took no slot of its own), by the app's start times and by when the page
 * showed their data, and every source database was requested once.
 */
export async function expectSharedSourceWidgetsStartedTogether(page: Page) {
  const widgets = loadingWidgets(page);

  await waitForWidgetData(page, widgets);
  const stats = await loadStats(page);
  const { ready } = await readPageRecord(page);

  for (const name of sourceDatabaseNames(page)) {
    const pair = widgets.filter((widget) => widget.database === name);
    const starts = pair.map((widget) => stats.widgetStarts.find((start) => start.widgetId === widget.id)?.at);

    expect(pair.length, `widgets of the "${name}" database`).toBe(2);
    expect(
      starts.every((at) => at !== undefined),
      `both "${name}" widgets started`
    ).toBe(true);
    expect(
      Math.abs((starts[0] as number) - (starts[1] as number)),
      `ms between the starts of the two "${name}" widgets (one waited for a slot of its own)`
    ).toBeLessThanOrEqual(SAME_PLAN_MS);
    // The page's evidence: both left the loading placeholder when the one load of their database opened it.
    expect(
      pair.map((widget) => ready[widget.id]).every((at) => at !== undefined),
      `both "${name}" widgets left the loading placeholder`
    ).toBe(true);
    expect(
      Math.abs(ready[pair[0].id] - ready[pair[1].id]),
      `ms between the two "${name}" widgets leaving the loading placeholder (one waited for a load of its own)`
    ).toBeLessThanOrEqual(SAME_PLAN_MS);
  }
}

/** The rows of every source database were read in one pass each. */
export async function expectRowsOfEverySourceLoadedInOnePass(page: Page) {
  for (const name of sourceDatabaseNames(page)) await expectRowsLoadedInOnePass(page, name);
}

/**
 * No widget waited for a load slot after the return: every widget started,
 * and no source database took a slot (resident sources need none).
 */
export async function expectNoWidgetWaited(page: Page) {
  const widgets = loadingWidgets(page);

  await waitForWidgetData(page, widgets);
  const stats = await loadStats(page);

  expect(
    widgets
      .filter((widget) => !stats.widgetStarts.some((start) => start.widgetId === widget.id))
      .map((widget) => widget.label),
    'widgets that never started after the return'
  ).toEqual([]);
  expect(
    stats.sourceLoads.map((load) => load.sourceId),
    'source databases that took a load slot after the return'
  ).toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'sources loading at once after the return').toBe(0);
}

/**
 * Nothing was opened or loaded again after the return: no document or
 * blob/diff request of a source database, and no row pass over one.
 */
export async function expectNoSourceLoadedAgain(page: Page) {
  const scenario = loadingScenario(page);

  await waitForWidgetData(page, loadingWidgets(page));
  // Room for a load that would start late.
  await viewerOf(page).waitForTimeout(SLOW_SOURCE_DELAY_MS);
  const stats = await loadStats(page);
  const ids = sourceDatabaseNames(page).map((name) => fixtureDatabase(page, name).databaseId);

  const requests = recorderOf(page).since(scenario.openedAt ?? 0);

  // A delta request (the rows changed since the cursor the tab holds) reads no row it holds already.
  expect(
    requests.filter((entry) => entry.blob !== 'delta').map((entry) => `${entry.blob ?? entry.kind} ${entry.url}`),
    'source database documents opened or row walks started after the return'
  ).toEqual([]);
  expect(
    ids.filter((id) => (stats.rowLoadPasses[id] ?? 0) > 0),
    'source databases whose rows were read again (the app counter)'
  ).toEqual([]);
  expect(
    ids.filter((id) => (stats.sourceOpens[id] ?? 0) > 0),
    'source databases opened again (the app counter)'
  ).toEqual([]);
}

/** Every widget showed its data within `withinMs` of the (re)open. */
export async function expectEveryWidgetDataWithin(page: Page, withinMs: number) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);
  const openedAt = scenario.openedAt ?? Date.now();

  await waitForWidgetData(page, widgets, Math.max(0, withinMs - (Date.now() - openedAt)) + 1_000);
  const { data } = await readPageRecord(page);

  expect(
    widgets
      .filter((widget) => data[widget.id] - openedAt > withinMs)
      .map((widget) => `${widget.label} after ${data[widget.id] - openedAt} ms`),
    `widgets that showed their data later than ${withinMs} ms after the open`
  ).toEqual([]);
}

/**
 * Nothing starts loading for `windowMs` after the dashboard was left: no new
 * widget start, and no request of a source database that had not started.
 */
export async function expectNoStartWithinAfterLeaving(page: Page, windowMs: number) {
  const left = loadingScenario(page).left;

  expect(left, 'the dashboard was not left in this scenario').toBeDefined();
  const { at, startCount, startedSources } = left as LeaveRecord;

  expect(windowMs, 'the window is longer than two slow responses').toBeGreaterThan(2 * SLOW_SOURCE_DELAY_MS);
  await viewerOf(page).waitForTimeout(Math.max(0, at + windowMs - Date.now()));
  const stats = await loadStats(page);
  const late = recorderOf(page)
    .since(at)
    .filter((entry) => !startedSources.has(entry.sourceId));

  expect(stats.widgetStarts.slice(startCount), 'widgets that started after the dashboard was left').toEqual([]);
  expect(
    late.map((entry) => entry.url),
    'requests for sources that had not started when the dashboard was left'
  ).toEqual([]);
}

/** At most the request in flight when the dashboard was left completes: nothing new starts after this. */
const LEAVE_GRACE_MS = 1_000;

/**
 * The source databases that were loading when the dashboard was left send no
 * new document or row request after it (the request in flight may finish).
 */
export async function expectStartedSourcesStopLoading(page: Page) {
  const left = loadingScenario(page).left;

  expect(left, 'the dashboard was not left in this scenario').toBeDefined();
  const { at, startedSources } = left as LeaveRecord;

  expect(startedSources.size, 'source databases that had started when the dashboard was left').toBeGreaterThan(0);
  await viewerOf(page).waitForTimeout(Math.max(0, at + 2 * SLOW_SOURCE_DELAY_MS + LEAVE_GRACE_MS - Date.now()));
  const late = recorderOf(page)
    .since(at + LEAVE_GRACE_MS)
    .filter((entry) => startedSources.has(entry.sourceId));

  expect(
    late.map((entry) => `${entry.kind} ${entry.url}`),
    'requests of the source databases that were loading, sent after the dashboard was left'
  ).toEqual([]);
}

/**
 * Nothing of the dashboard is left: no widget in the page, every load slot
 * the app recorded was given back, and no source database request is still
 * in flight.
 */
export async function expectNoWidgetSessionLeftOpen(page: Page) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);

  await expect(DashboardSelectors.widgets(viewer)).toHaveCount(0);
  const stats = await loadStats(page);

  expect(
    stats.sourceLoads.filter((load) => load.end === null).map((load) => load.sourceId),
    'source databases that still hold a load slot'
  ).toEqual([]);
  await expect
    .poll(
      () =>
        recorderOf(page)
          .since(scenario.openedAt ?? 0)
          .filter((entry) => entry.end === undefined)
          .map((entry) => entry.url),
      { timeout: 2 * SLOW_SOURCE_DELAY_MS, message: 'source database requests still in flight' }
    )
    .toEqual([]);
}

// ---------------------------------------------------------------------------
// Slow sources holding the slots (M8)
// ---------------------------------------------------------------------------

/** The first `count` source databases, in layout order. */
export function firstSourceDatabases(page: Page, count: number): string[] {
  return sourceDatabaseNames(page).slice(0, count);
}

/** When the last request of a source database since the open ended (its load answered). */
function lastRequestEnd(page: Page, name: string): number {
  const scenario = loadingScenario(page);
  const requests = recorderOf(page).ofSource(fixtureDatabase(page, name).databaseId, scenario.openedAt ?? 0);
  const ends = requests.map((entry) => entry.end ?? Number.POSITIVE_INFINITY);

  expect(requests.length, `requests of the "${name}" database`).toBeGreaterThan(0);
  return Math.max(...ends);
}

/**
 * The widgets of the databases that do not load slowly waited, with their
 * header and a loading state, until a slow database finished: none of their
 * databases was requested before then.
 */
export async function expectOthersWaitForSlowSources(page: Page) {
  const scenario = loadingScenario(page);
  const slow = Object.keys(scenario.slowDelays ?? {});
  const others = loadingWidgets(page).filter((widget) => !slow.includes(widget.database));

  expect(slow.length, 'slow source databases').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  expect(others.length, 'widgets of the other databases').toBeGreaterThan(0);
  await waitForWidgetData(page, loadingWidgets(page));
  const slowFinished = Math.min(...slow.map((name) => lastRequestEnd(page, name)));
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const { waiting, samples } = await readPageRecord(page);
  const since = (t: number) => `${t - (scenario.openedAt ?? 0)} ms`;

  for (const widget of others) {
    const requestedAt = first.get(fixtureDatabase(page, widget.database).databaseId) ?? Number.POSITIVE_INFINITY;
    const looks = samples.filter((sample) => sample.id === widget.id && sample.t < slowFinished);

    expect(
      requestedAt >= slowFinished,
      `the "${widget.label}" database was requested at ${since(requestedAt)}, before a slow database finished at ${since(
        slowFinished
      )}`
    ).toBe(true);
    expect(waiting[widget.id], `the "${widget.label}" widget was never seen waiting`).toBeDefined();
    expect(looks.length, `looks at the "${widget.label}" widget while the slow databases loaded`).toBeGreaterThan(0);
    expect(
      looks.filter((sample) => !sample.header || !sample.loading).map((sample) => since(sample.t)),
      `the "${widget.label}" widget showed no loading state while it waited`
    ).toEqual([]);
  }
}

/** No widget showed an error or an empty view before it showed its data. */
export async function expectNoErrorOrEmptyWhileWaiting(page: Page) {
  const scenario = loadingScenario(page);
  const widgets = loadingWidgets(page);

  await waitForWidgetData(page, widgets);
  const stats = await loadStats(page);
  const { data, samples } = await readPageRecord(page);

  expect(
    widgets.filter((widget) => (stats.emptyStateSamples[widget.id] ?? 0) > 0).map((widget) => widget.label),
    'widgets the app saw in an empty state before they completed'
  ).toEqual([]);
  for (const widget of widgets) {
    const bad = samples.filter(
      (sample) => sample.id === widget.id && sample.t < data[widget.id] && (sample.error || sample.empty)
    );

    expect(
      bad.map((sample) => `${sample.error ? 'error' : 'empty'} at ${sample.t - (scenario.openedAt ?? 0)} ms`),
      `the "${widget.label}" widget looked empty or failed while it waited`
    ).toEqual([]);
  }
}

// ---------------------------------------------------------------------------
// Scroll promotion and the deferral (M9)
// ---------------------------------------------------------------------------

function lastRowWidget(page: Page): LoadingWidget {
  const widgets = loadingWidgets(page);
  const lastRow = Math.max(...widgets.map((widget) => widget.row));
  const inLastRow = widgets.filter((widget) => widget.row === lastRow);

  expect(inLastRow.length, 'widgets in the last dashboard row').toBe(1);
  return inLastRow[0];
}

/** Scroll to the last row at once, and check that no widget visible at the open showed data before. */
export async function scrollToLastRowBeforeVisibleData(page: Page) {
  await scrollToLastRow(page);
  const scenario = loadingScenario(page);
  const { data } = await readPageRecord(page);
  const stats = await loadStats(page);
  const shown = visibleWidgets(page).filter(
    (widget) => (data[widget.id] ?? Number.POSITIVE_INFINITY) <= (scenario.scrolledAt as number)
  );

  expect(
    shown.map((widget) => widget.label),
    'visible widgets that showed data before the scroll'
  ).toEqual([]);
  expect(
    stats.widgetStarts.some((start) => start.widgetId === lastRowWidget(page).id),
    'the last-row widget had started before the scroll'
  ).toBe(false);
  expect(
    scenario.visibleAfterScroll?.has(lastRowWidget(page).id),
    'the last-row widget is in view after the scroll'
  ).toBe(true);
}

/**
 * The last-row widget started before every widget that was never in view:
 * its database was requested first, and the app started it first.
 */
export async function expectLastRowStartedBeforeNeverScrolled(page: Page) {
  const scenario = loadingScenario(page);
  const last = lastRowWidget(page);
  const seen = new Set([...(scenario.visibleAtOpen ?? []), ...(scenario.visibleAfterScroll ?? [])]);
  const never = loadingWidgets(page).filter((widget) => !seen.has(widget.id));

  expect(never.length, 'widgets that were never scrolled into view').toBeGreaterThan(0);
  await waitForWidgetData(page, [last]);
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const lastRequested = first.get(fixtureDatabase(page, last.database).databaseId) as number;
  const starts = (await loadStats(page)).widgetStarts.map((start) => start.widgetId);

  expect(lastRequested, 'the last-row database was requested').toBeDefined();
  for (const widget of never) {
    const requestedAt = first.get(fixtureDatabase(page, widget.database).databaseId) ?? Number.POSITIVE_INFINITY;
    const startIndex = starts.indexOf(widget.id);

    expect(lastRequested < requestedAt, `"${widget.label}" was requested before the last-row widget`).toBe(true);
    expect(
      startIndex === -1 || startIndex > starts.indexOf(last.id),
      `"${widget.label}" started before the last-row widget`
    ).toBe(true);
  }
}

/** The last-row widget was in view when it started: the app says so, and its database was requested after the scroll. */
export async function expectLastRowVisibleAtStart(page: Page) {
  const scenario = loadingScenario(page);
  const last = lastRowWidget(page);

  await waitForWidgetData(page, [last]);
  const start = (await loadStats(page)).widgetStarts.find((entry) => entry.widgetId === last.id);
  const requestedAt = recorderOf(page)
    .firstRequestAt(scenario.openedAt ?? 0)
    .get(fixtureDatabase(page, last.database).databaseId);

  expect(start?.visibleAtStart, 'the last-row widget was visible when it started (the app counter)').toBe(true);
  expect(requestedAt, 'the last-row database was requested').toBeDefined();
  expect(requestedAt as number, 'the last-row database was requested before the scroll').toBeGreaterThanOrEqual(
    scenario.scrolledAt as number
  );
}

/**
 * No widget below the fold started in the first `seconds`: by the app's
 * start times (from the first visible start) and by its database's first
 * request (from the open, which is earlier).
 */
export async function expectNoBelowFoldStartWithin(page: Page, seconds: number) {
  const scenario = loadingScenario(page);
  const below = widgetsBelowTheFold(page);
  const windowMs = seconds * 1000;

  expect(windowMs, 'tokens.json loading.deferredStartTimeoutMs').toBe(DASHBOARD_LOADING.deferredStartTimeoutMs);
  expect(below.length, 'widgets below the fold').toBeGreaterThan(0);
  // Until a widget below the fold started, or long past the window.
  await expect
    .poll(async () => (await loadStats(page)).widgetStarts.some((start) => !start.visibleAtStart), {
      timeout: windowMs + LOAD_TIMEOUT_MS,
      message: 'waiting for a widget below the fold to start',
    })
    .toBe(true);
  const stats = await loadStats(page);
  const firstVisibleStart = Math.min(
    ...stats.widgetStarts.filter((start) => start.visibleAtStart).map((start) => start.at)
  );
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const openedAt = scenario.openedAt as number;

  for (const widget of below) {
    const start = stats.widgetStarts.find((entry) => entry.widgetId === widget.id);
    const requestedAt = first.get(fixtureDatabase(page, widget.database).databaseId);

    if (start) {
      expect(
        start.at - firstVisibleStart,
        `ms after the first visible start that "${widget.label}" started`
      ).toBeGreaterThanOrEqual(windowMs);
    }

    if (requestedAt !== undefined) {
      expect(requestedAt - openedAt, `ms after the open that "${widget.label}" was requested`).toBeGreaterThanOrEqual(
        windowMs
      );
    }
  }
}

/** A widget below the fold started (its database was requested) before the first source database showed data. */
export async function expectBelowFoldStartedBeforeFirstSourceData(page: Page) {
  const scenario = loadingScenario(page);
  const firstSource = sourceDatabaseNames(page)[0];
  const firstWidgets = loadingWidgets(page).filter((widget) => widget.database === firstSource);

  await waitForWidgetData(
    page,
    firstWidgets,
    LOAD_TIMEOUT_MS + Math.max(0, ...Object.values(scenario.slowDelays ?? {})) * 3
  );
  const { data } = await readPageRecord(page);
  const firstData = Math.min(...firstWidgets.map((widget) => data[widget.id]));
  const first = recorderOf(page).firstRequestAt(scenario.openedAt ?? 0);
  const belowRequests = widgetsBelowTheFold(page)
    .map((widget) => first.get(fixtureDatabase(page, widget.database).databaseId))
    .filter((at): at is number => at !== undefined);

  expect(belowRequests.length, 'databases below the fold that were requested').toBeGreaterThan(0);
  expect(
    Math.min(...belowRequests),
    'the first request below the fold came after the first database showed data'
  ).toBeLessThan(firstData);
}

// ---------------------------------------------------------------------------
// Removed while queued (M16)
// ---------------------------------------------------------------------------

/** In Edit mode, remove the last widget through its header menu while it still waits for a slot. */
export async function removeLastWidgetBeforeStart(page: Page) {
  const scenario = loadingScenario(page);
  const viewer = viewerOf(page);
  const widgets = loadingWidgets(page);
  const last = widgets[widgets.length - 1];
  const box = widgetLocatorOf(page, last);
  const started = async () => (await loadStats(page)).widgetStarts.some((start) => start.widgetId === last.id);

  expect(await started(), `the "${last.label}" widget started before it could be removed`).toBe(false);
  await DashboardSelectors.editButton(viewer).click();
  await expect(DashboardSelectors.doneButton(viewer)).toBeVisible();
  // A waiting widget's header works without its source (WidgetPlaceholderFrame).
  await box.getByTestId('dashboard-widget-title-button').click();
  await expect(DashboardSelectors.widgetMenu(viewer)).toBeVisible();
  await DashboardSelectors.widgetMenuItem(viewer, 'delete').click();
  await expect(box).toHaveCount(0, WIDGET_TIMEOUT);
  scenario.removed = { widget: last, at: Date.now() };
  scenario.widgets = widgets.slice(0, -1);
  expect(await started(), `the "${last.label}" widget started before it was removed`).toBe(false);
}

/** The removed widget's database was never opened: no request, no open, no start. */
export async function expectRemovedSourceNeverOpened(page: Page) {
  const scenario = loadingScenario(page);
  const removed = scenario.removed;

  expect(removed, 'no widget was removed in this scenario').toBeDefined();
  const { widget } = removed as { widget: LoadingWidget; at: number };
  const { databaseId } = fixtureDatabase(page, widget.database);

  await waitForWidgetData(page, loadingWidgets(page));
  // Room for a start that would come late.
  await viewerOf(page).waitForTimeout(2 * SLOW_SOURCE_DELAY_MS);
  const stats = await loadStats(page);

  expect(
    recorderOf(page)
      .ofSource(databaseId, scenario.openedAt ?? 0)
      .map((entry) => entry.url),
    `requests of the "${widget.database}" database`
  ).toEqual([]);
  expect(stats.sourceOpens[databaseId] ?? 0, `times the "${widget.database}" database was opened`).toBe(0);
  expect(
    stats.widgetStarts.filter((start) => start.widgetId === widget.id),
    'starts of the removed widget'
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// A read-only member (M20)
// ---------------------------------------------------------------------------

/**
 * Invite a read-only member and open the scenario's dashboard in the
 * member's own browser (nothing cached), recording its requests, its widgets
 * and the app's counters there. The member's page becomes the viewer.
 */
export async function openDashboardAsReadOnlyMember(page: Page, request: APIRequestContext) {
  const scenario = loadingScenario(page);
  const world = dashboardWorld(page);
  const member = await inviteDashboardMember(page, request, 'read-only');
  const browser = page.context().browser();

  if (!browser) throw new Error('The scenario page has no browser');
  member.context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 1440, height: 900 },
  });
  await installDashboardTestBridge(member.context);
  member.page = await member.context.newPage();
  await mockProSubscription(member.page);
  await signBrowserInWithSession(member.page, member.session);
  scenario.viewer = member.page;
  await recordLoadsOn(page, member.page);
  const host = hostDatabase(page);
  const url = `/app/${world.workspaceId}/${host.pageId}?v=${dashboardViewId(page)}`;

  scenario.openedAt = Date.now();
  await member.page.goto(url, { waitUntil: 'domcontentloaded' });
  const tab = DatabaseViewSelectors.viewTab(member.page, dashboardViewId(page));

  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
  await expect(DashboardSelectors.view(member.page)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(member.page)).toHaveCount(loadingWidgets(page).length, WIDGET_TIMEOUT);
  // A member cannot edit a read-only dashboard.
  await expect(DashboardSelectors.editButton(member.page)).toHaveCount(0);
  scenario.visibleAtOpen = new Set(await widgetsInViewport(member.page));
}
