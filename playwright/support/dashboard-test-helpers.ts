/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * Dashboard view (DatabaseViewLayout.Dashboard = 9) BDD helpers.
 *
 * Fixtures are seeded through the AppFlowy Cloud API (spaces, database pages,
 * fields, rows) so every scenario starts from known data, then the browser
 * signs in with the same session. Dashboard layout state lives in the host
 * database doc under `views[dashboardId].layout_settings['9']`, and is read or
 * seeded through a test bridge that remembers every database context the app
 * exposes (widgets mount their own `<Database>`, so `__TEST_DATABASE_CONTEXT__`
 * alone would point at whichever widget mounted last).
 */
import { APIRequestContext, BrowserContext, expect, Locator, Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { FieldType } from '../../src/application/database-yjs/database.type';
import { DatabaseViewLayout, Types } from '../../src/application/types';

import { AuthTestUtils } from './auth-utils';
import { mockProSubscription } from './chart-test-helpers';
import { grantWorkspaceProSubscription } from './subscription-test-helpers';
import { ensurePageExpandedByViewId, expandSpaceByName } from './page-utils';
import { ChartSettingsSelectors, DatabaseViewSelectors, SidebarSelectors, TimelineSelectors } from './selectors';
import { setupPageErrorHandling, TestConfig } from './test-config';

export { DatabaseViewLayout, FieldType };

/** `layout_settings` key of the dashboard layout. */
export const DASHBOARD_LAYOUT_KEY = '9';
export const DASHBOARD_MAX_WIDGETS = 12;
export const DASHBOARD_MAX_WIDGETS_PER_ROW = 4;
export const DASHBOARD_GRID_COLUMNS = 12;
export const DASHBOARD_DEFAULT_ROW_HEIGHT = 360;
export const DASHBOARD_STACK_BREAKPOINT = 768;

const FIXTURE_TIMEOUT_MS = 45_000;
const WIDGET_TIMEOUT_MS = 30_000;
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL = 50;
const SPACE_PERMISSION_PUBLIC = 0;
const SPACE_PERMISSION_PRIVATE = 1;
/** Folder `ViewLayout.Grid`; database pages are created as grids and get extra views through the tab bar. */
const FOLDER_LAYOUT_GRID = 1;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const DashboardSelectors = {
  view: (page: Page) => page.getByTestId('dashboard-view'),
  emptyState: (page: Page) => page.getByTestId('dashboard-empty-state'),
  editButton: (page: Page) => page.getByTestId('dashboard-edit-button'),
  doneButton: (page: Page) => page.getByTestId('dashboard-done-button'),
  rows: (page: Page) => page.getByTestId('dashboard-row'),
  row: (page: Page, rowId: string) => page.locator(`[data-testid="dashboard-row"][data-row-id="${rowId}"]`),
  widgets: (page: Page) => page.getByTestId('dashboard-widget'),
  widget: (page: Page, widgetId: string) =>
    page.locator(`[data-testid="dashboard-widget"][data-widget-id="${widgetId}"]`),
  widgetsForView: (page: Page, viewId: string) =>
    page.locator(`[data-testid="dashboard-widget"][data-view-id="${viewId}"]`),
  widgetMenu: (page: Page) => page.getByTestId('dashboard-widget-menu'),
  widgetMenuItem: (page: Page, action: WidgetMenuAction) => page.getByTestId(`dashboard-widget-menu-${action}`),
  addWidgetButton: (page: Page) => page.getByTestId('dashboard-add-widget-button'),
  addWidgetRowButton: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-add-widget-row-button"][data-row-id="${rowId}"]`),
  picker: (page: Page) => page.getByTestId('dashboard-widget-picker'),
  pickerSearch: (page: Page) => page.getByTestId('dashboard-widget-picker-search'),
  pickerOption: (page: Page, viewId: string) =>
    page.locator(`[data-testid="dashboard-widget-picker-option"][data-view-id="${viewId}"]`),
  pickerOptions: (page: Page) => page.getByTestId('dashboard-widget-picker-option'),
  pickerNewView: (page: Page) => page.getByTestId('dashboard-widget-picker-new-view'),
  pickerLayoutOption: (page: Page, layout: DatabaseViewLayout) =>
    page.locator(`[data-testid="dashboard-widget-picker-layout-option"][data-layout="${layout}"]`),
  pickerDatabase: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-widget-picker-database"][data-database-id="${databaseId}"]`),
  widthHandle: (page: Page, rowId: string, index: number) =>
    page.locator(`[data-testid="dashboard-width-handle"][data-row-id="${rowId}"][data-index="${index}"]`),
  widthHandles: (page: Page) => page.getByTestId('dashboard-width-handle'),
  heightHandle: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-height-handle"][data-row-id="${rowId}"]`),
  limitMessage: (page: Page) => page.getByTestId('dashboard-limit-message'),
  globalFilterButton: (page: Page) => page.getByTestId('dashboard-global-filter-button'),
  globalFilterBar: (page: Page) => page.getByTestId('dashboard-global-filter-bar'),
  globalFilterChips: (page: Page) => page.getByTestId('dashboard-global-filter-chip'),
  globalFilterMenu: (page: Page) => page.getByTestId('dashboard-global-filter-menu'),
  globalFilterAdd: (page: Page) => page.getByTestId('dashboard-global-filter-add'),
  globalFilterPropertyOption: (page: Page, fieldType: FieldType) =>
    page.locator(`[data-testid="dashboard-global-filter-property-option"][data-field-type="${fieldType}"]`),
  globalFilterName: (page: Page) => page.getByTestId('dashboard-global-filter-name'),
  globalFilterTargets: (page: Page) => page.getByTestId('dashboard-global-filter-target'),
  globalFilterTarget: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-global-filter-target"][data-database-id="${databaseId}"]`),
  globalFilterCondition: (page: Page) => page.getByTestId('dashboard-global-filter-condition'),
  globalFilterContent: (page: Page) => page.getByTestId('dashboard-global-filter-content'),
  globalFilterDelete: (page: Page) => page.getByTestId('dashboard-global-filter-delete'),
  globalFilterDone: (page: Page) => page.getByTestId('dashboard-global-filter-done'),
  globalFilterSaveForEverybody: (page: Page) => page.getByTestId('dashboard-global-filter-save-for-everybody'),
  globalFilterLocalBadge: (page: Page) => page.getByTestId('dashboard-global-filter-local-badge'),
  addDashboardViewOption: (page: Page) => page.getByTestId('add-dashboard-view-button'),
  viewIcon: (scope: Page | Locator) => scope.getByTestId('dashboard-view-icon'),
};

export type WidgetMenuAction =
  | 'open'
  | 'change-view'
  | 'duplicate'
  | 'delete'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down';

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Grid rows rendered inside a scope (a widget, usually). */
export function gridDataRows(scope: Locator): Locator {
  return scope.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

export const LAYOUT_BY_NAME: Record<string, DatabaseViewLayout> = {
  Grid: DatabaseViewLayout.Grid,
  Board: DatabaseViewLayout.Board,
  Calendar: DatabaseViewLayout.Calendar,
  Chart: DatabaseViewLayout.Chart,
  List: DatabaseViewLayout.List,
  Gallery: DatabaseViewLayout.Gallery,
  Timeline: DatabaseViewLayout.Timeline,
  Dashboard: DatabaseViewLayout.Dashboard,
};

export const FIELD_TYPE_BY_NAME: Record<string, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  Date: FieldType.DateTime,
  Select: FieldType.SingleSelect,
  Checkbox: FieldType.Checkbox,
};

/**
 * Select options share ids across every fixture database, so a global select
 * filter's option ids match rows in each mapped source.
 */
export const STATUS_OPTIONS = [
  { id: 'dash-opt-todo', name: 'Todo', color: 'Purple' },
  { id: 'dash-opt-doing', name: 'Doing', color: 'Blue' },
  { id: 'dash-opt-done', name: 'Done', color: 'Green' },
];

export function statusOptionId(name: string): string {
  const option = STATUS_OPTIONS.find((candidate) => candidate.name === name);

  if (!option) throw new Error(`Unknown status option "${name}"`);
  return option.id;
}

export type CellValue = string | number | boolean | { dayOffset: number };

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** Select option names; defaults to `STATUS_OPTIONS`. */
  options?: string[];
}

export interface DatabaseSpec {
  fields: FieldSpec[];
  rows: Record<string, CellValue>[];
  privateSpace?: boolean;
}

const OPTION_COLORS = ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue'];

/**
 * A named select option always gets the same id, in every database, so a
 * global select filter can be mapped across databases that list it.
 */
export function namedOptionId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `uc-opt-${slug}`;
}

function selectOptionsFor(field: FieldSpec) {
  if (!field.options) return STATUS_OPTIONS;
  return field.options.map((name, index) => ({
    id: namedOptionId(name),
    name,
    color: OPTION_COLORS[index % OPTION_COLORS.length],
  }));
}

/**
 * Projects and Tasks share every property type under different names, so a
 * global filter maps one property per source. Notes has only a title and a
 * number, and Backlog has no rows.
 */
export const DASHBOARD_FIXTURE_DATABASES: Record<string, DatabaseSpec> = {
  Projects: {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect },
      { name: 'Estimate', type: FieldType.Number },
      { name: 'Due', type: FieldType.DateTime },
      { name: 'Urgent', type: FieldType.Checkbox },
    ],
    rows: [
      { Name: 'Website launch', Status: 'Doing', Estimate: 3, Due: { dayOffset: 0 }, Urgent: true },
      { Name: 'Mobile app', Status: 'Todo', Estimate: 5, Due: { dayOffset: 10 }, Urgent: false },
      { Name: 'API cleanup', Status: 'Done', Estimate: 8, Due: { dayOffset: -3 }, Urgent: true },
    ],
  },
  Tasks: {
    fields: [
      { name: 'Stage', type: FieldType.SingleSelect },
      { name: 'Points', type: FieldType.Number },
      { name: 'Deadline', type: FieldType.DateTime },
      { name: 'Blocked', type: FieldType.Checkbox },
    ],
    rows: [
      { Name: 'Write launch plan', Stage: 'Doing', Points: 2, Deadline: { dayOffset: 0 }, Blocked: false },
      { Name: 'Review', Stage: 'Todo', Points: 1, Deadline: { dayOffset: 5 }, Blocked: false },
      { Name: 'Ship', Stage: 'Done', Points: 4, Deadline: { dayOffset: -1 }, Blocked: true },
    ],
  },
  Notes: {
    fields: [{ name: 'Words', type: FieldType.Number }],
    rows: [
      { Name: 'Idea board', Words: 120 },
      { Name: 'Reading list', Words: 40 },
    ],
  },
  Backlog: {
    fields: [{ name: 'Points', type: FieldType.Number }],
    rows: [],
  },
  Secrets: {
    fields: [{ name: 'Level', type: FieldType.Number }],
    rows: [{ Name: 'Salary review', Level: 3 }],
    privateSpace: true,
  },
};

function localNoonIso(dayOffset: number) {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

export function startOfTodayUnix() {
  const date = new Date();

  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

// ---------------------------------------------------------------------------
// Scenario world
// ---------------------------------------------------------------------------

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  tokenData: Record<string, unknown> & { access_token?: string; refresh_token?: string; user?: { id?: string } };
}

export interface FixtureDatabase {
  name: string;
  spaceId: string;
  pageId: string;
  databaseId: string;
  fieldIds: Record<string, string>;
  rowIds: Record<string, string>;
  /** Layout name → view id (the first view of that layout). */
  views: Record<string, string>;
}

export interface KnownWidget {
  id: string;
  viewId: string;
  databaseId: string;
}

export interface MemberActor {
  email: string;
  session: AuthSession;
  context?: BrowserContext;
  page?: Page;
}

export interface DashboardWorld {
  runId: string;
  owner: AuthSession;
  workspaceId: string;
  spaceId: string;
  spaceName: string;
  privateSpaceId?: string;
  databases: Record<string, FixtureDatabase>;
  dashboardViewId?: string;
  /** Fixture database that owns the dashboard view. */
  dashboardHost?: string;
  /** Label ("Projects Grid", "Tasks Grid #2") → widget. */
  widgets: Record<string, KnownWidget>;
  /** Views known by their own name (use-case scenarios): name → view id and fixture database name. */
  viewsByName?: Record<string, { viewId: string; database: string }>;
  member?: MemberActor;
  /** Snapshot taken by a step to compare against later (rows JSON, widths, ...). */
  snapshot?: unknown;
  viewCountBefore?: number;
}

const worlds = new WeakMap<Page, DashboardWorld>();

export function dashboardWorld(page: Page): DashboardWorld {
  const world = worlds.get(page);

  if (!world) throw new Error('The dashboard fixture workspace has not been prepared');
  return world;
}

/** Make `world` the scenario world of `page` (for scenarios that build their own fixture). */
export function registerDashboardWorld(page: Page, world: DashboardWorld) {
  worlds.set(page, world);
}

export function peekDashboardWorld(page: Page): DashboardWorld | undefined {
  return worlds.get(page);
}

export function forgetDashboardWorld(page: Page) {
  worlds.delete(page);
}

export function fixtureDatabase(page: Page, name: string): FixtureDatabase {
  const database = dashboardWorld(page).databases[name];

  if (!database) throw new Error(`The fixture has no "${name}" database`);
  return database;
}

export function dashboardViewId(page: Page): string {
  const id = dashboardWorld(page).dashboardViewId;

  if (!id) throw new Error('No dashboard has been added in this scenario');
  return id;
}

/** "Projects Grid" / "Tasks Grid #2" → database + layout name. */
export function parseViewLabel(label: string): { database: string; layout: string } {
  const match = /^(\S+) (\S+)(?: #\d+)?$/.exec(label.trim());

  if (!match) throw new Error(`Widget labels look like "<Database> <Layout>", got "${label}"`);
  return { database: match[1], layout: match[2] };
}

/** The fixture database a widget label ("Projects Grid" or a named view) shows. */
export function databaseForLabel(page: Page, label: string): string {
  const named = dashboardWorld(page).viewsByName?.[label];

  return named ? named.database : parseViewLabel(label).database;
}

export function viewIdForLabel(page: Page, label: string): string {
  const named = dashboardWorld(page).viewsByName?.[label];

  if (named) return named.viewId;
  const { database, layout } = parseViewLabel(label);
  const viewId = fixtureDatabase(page, database).views[layout];

  if (!viewId) throw new Error(`"${database}" has no ${layout} view; add it with a Given step first`);
  return viewId;
}

export function knownWidget(page: Page, label: string): KnownWidget {
  const widget = dashboardWorld(page).widgets[label];

  if (!widget) throw new Error(`No widget labelled "${label}" in this scenario`);
  return widget;
}

export function widgetLocator(page: Page, label: string): Locator {
  const world = dashboardWorld(page);
  const widget = world.widgets[label];

  if (widget) return DashboardSelectors.widget(page, widget.id);
  return DashboardSelectors.widgetsForView(page, viewIdForLabel(page, label)).first();
}

// ---------------------------------------------------------------------------
// Cloud API
// ---------------------------------------------------------------------------

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };

function apiHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseJson<ApiEnvelope<T>>(text);

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API GET ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data;
}

export async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: typeof data === 'string' ? data : JSON.stringify(data),
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseJson<ApiEnvelope<T>>(text);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

export async function apiPatch<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.patch(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: typeof data === 'string' ? data : JSON.stringify(data),
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseJson<ApiEnvelope<T>>(text);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API PATCH ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

export async function signInFixtureAccount(request: APIRequestContext, email: string): Promise<AuthSession> {
  const callbackLink = await new AuthTestUtils().generateSignInUrl(request, email);
  const hashIndex = callbackLink.indexOf('#');

  if (hashIndex === -1) throw new Error(`Sign-in link for ${email} carried no token hash`);
  const params = new URLSearchParams(callbackLink.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) throw new Error(`Sign-in link for ${email} carried no tokens`);
  const verify = await request.get(`${TestConfig.apiUrl}/api/user/verify/${accessToken}`, {
    failOnStatusCode: false,
    timeout: 30_000,
  });

  if (!verify.ok()) throw new Error(`Verifying ${email} failed: HTTP ${verify.status()}`);
  const tokenResponse = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=refresh_token`, {
    data: { refresh_token: refreshToken },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  if (!tokenResponse.ok()) throw new Error(`Refreshing ${email} failed: HTTP ${tokenResponse.status()}`);
  const tokenData = (await tokenResponse.json()) as AuthSession['tokenData'];
  const access = tokenData.access_token || accessToken;
  const refresh = tokenData.refresh_token || refreshToken;

  return {
    accessToken: access,
    refreshToken: refresh,
    tokenData: { ...tokenData, access_token: access, refresh_token: refresh },
  };
}

/**
 * Remember every database context the app exposes, and add lookups by view
 * and database id. Installed on the browser context so reloads and member
 * pages get it too.
 */
export async function installDashboardTestBridge(context: BrowserContext) {
  // A busy dev server sometimes fails a lazy module fetch and the app shows one
  // of its error screens; reload as a user would (a few times per tab). Only a
  // recorded module fetch failure counts: those screens also catch real render
  // errors, which must fail the scenario.
  await context.addInitScript(() => {
    const key = '__dashboard_test_chunk_reloads__';
    const chunkFailure =
      /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/;
    let chunkFailed = false;
    const note = (value: unknown) => {
      const text = value instanceof Error ? value.message : String(value);

      if (chunkFailure.test(text)) chunkFailed = true;
    };

    window.addEventListener('error', (event) => note(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => note(event.reason));
    // The route boundary, the app boundary and the element fallback.
    const errorScreens = ['Couldn’t load this page', 'Something went wrong', 'SomethingError'];
    const timer = window.setInterval(() => {
      if (!chunkFailed) return;
      const text = document.body?.innerText ?? '';

      if (!errorScreens.some((screen) => text.includes(screen))) return;

      window.clearInterval(timer);
      try {
        const reloads = Number(window.sessionStorage.getItem(key) ?? '0');

        if (reloads >= 3) return;
        window.sessionStorage.setItem(key, String(reloads + 1));
      } catch {
        return;
      }

      window.location.reload();
    }, 500);
  });
  await context.addInitScript(() => {
    type BridgeContext = { databaseDoc?: { guid?: string; getMap: (name: string) => any } };
    const win = window as unknown as Record<string, unknown> & { Cypress?: boolean };

    win.Cypress = true;
    if (win.__DASHBOARD_TEST__) return;
    const contexts: BridgeContext[] = [];
    let current: unknown;
    const record = (value: unknown) => {
      const ctx = value as BridgeContext | undefined;

      if (!ctx || !ctx.databaseDoc) return;
      const index = contexts.indexOf(ctx);

      if (index !== -1) contexts.splice(index, 1);
      contexts.push(ctx);
      if (contexts.length > 300) contexts.splice(0, contexts.length - 300);
    };

    const install = () => {
      Object.defineProperty(win, '__TEST_DATABASE_CONTEXT__', {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (value: unknown) => {
          current = value;
          record(value);
        },
      });
    };

    install();
    // `exposeDatabaseTestContext` deletes the global when its owner unmounts;
    // re-arm the accessor so later assignments are still recorded.
    window.setInterval(() => {
      const descriptor = Object.getOwnPropertyDescriptor(win, '__TEST_DATABASE_CONTEXT__');

      if (!descriptor) {
        current = undefined;
        install();
        return;
      }

      if ('value' in descriptor) {
        const value = descriptor.value as unknown;

        delete win.__TEST_DATABASE_CONTEXT__;
        current = value;
        install();
        record(value);
      }
    }, 20);

    const databaseOf = (ctx: BridgeContext) => ctx.databaseDoc?.getMap('data')?.get('database');

    win.__DASHBOARD_TEST__ = {
      contexts,
      byView(viewId: string) {
        for (let index = contexts.length - 1; index >= 0; index -= 1) {
          if (databaseOf(contexts[index])?.get('views')?.get(viewId)) return contexts[index];
        }

        return undefined;
      },
      byDatabase(databaseId: string) {
        for (let index = contexts.length - 1; index >= 0; index -= 1) {
          const database = databaseOf(contexts[index]);

          if (database && (database.get('id') === databaseId || contexts[index].databaseDoc?.guid === databaseId)) {
            return contexts[index];
          }
        }

        return undefined;
      },
      plain(value: unknown) {
        return value && typeof (value as { toJSON?: unknown }).toJSON === 'function'
          ? (value as { toJSON: () => unknown }).toJSON()
          : value;
      },
    };
  });
}

export async function signBrowserInWithSession(page: Page, session: AuthSession) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((tokens) => {
    const stored = {
      ...tokens.tokenData,
      access_token: tokens.tokenData.access_token || tokens.accessToken,
      refresh_token: tokens.tokenData.refresh_token || tokens.refreshToken,
    };

    localStorage.setItem('af_auth_token', stored.access_token);
    localStorage.setItem('af_refresh_token', stored.refresh_token);
    if (stored.user?.id) localStorage.setItem('af_user_id', stored.user.id);
    localStorage.setItem('token', JSON.stringify(stored));
  }, session);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/app/, { timeout: FIXTURE_TIMEOUT_MS });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
}

async function createSpace(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string,
  privateSpace: boolean
): Promise<string> {
  const space = await apiPost<{ view_id: string }>(request, token, `/api/workspace/${workspaceId}/space`, {
    name,
    space_icon: privateSpace ? 'lock' : 'earth',
    space_icon_color: '#555555',
    space_permission: privateSpace ? SPACE_PERMISSION_PRIVATE : SPACE_PERMISSION_PUBLIC,
  });

  return space.view_id;
}

async function createFixtureDatabase(
  request: APIRequestContext,
  world: DashboardWorld,
  name: string,
  spaceId: string,
  spec: DatabaseSpec
): Promise<FixtureDatabase & { defaultRowIds: string[] }> {
  const token = world.owner.accessToken;
  const created = await apiPost<{ view_id: string; database_id?: string }>(
    request,
    token,
    `/api/workspace/${world.workspaceId}/page-view`,
    { parent_view_id: spaceId, layout: FOLDER_LAYOUT_GRID, name }
  );

  if (!created.database_id) throw new Error(`Creating "${name}" returned no database id`);
  const databaseId = created.database_id;
  const base = `/api/workspace/${world.workspaceId}/database/${databaseId}`;
  const defaultRows = await apiGet<{ id: string }[]>(request, token, `${base}/row`);
  const fieldIds: Record<string, string> = {};

  for (const field of spec.fields) {
    const typeOptionData =
      field.type === FieldType.SingleSelect
        ? { content: JSON.stringify({ options: selectOptionsFor(field), disable_color: false }) }
        : {};

    fieldIds[field.name] = await apiPost<string>(request, token, `${base}/fields`, {
      name: field.name,
      field_type: field.type,
      type_option_data: typeOptionData,
    });
  }

  const rowIds: Record<string, string> = {};

  for (const row of spec.rows) {
    const cells: Record<string, string | number | boolean> = {};

    Object.entries(row).forEach(([key, value]) => {
      cells[key] = typeof value === 'object' ? localNoonIso(value.dayOffset) : value;
    });
    rowIds[String(row.Name)] = await apiPost<string>(request, token, `${base}/row`, {
      cells,
      document: null,
      parse_link_as_link_preview: false,
    });
  }

  return {
    name,
    spaceId,
    pageId: created.view_id,
    databaseId,
    fieldIds,
    rowIds,
    views: {},
    defaultRowIds: defaultRows.map((row) => row.id),
  };
}

/**
 * Wait until the browser shows a database page whose doc belongs to
 * `databaseId`. A reload in between (the test bridge reloads after a failed
 * module fetch on a cold dev server) destroys the evaluation context; that
 * only means "not yet".
 */
export async function waitForDatabaseContext(page: Page, databaseId: string) {
  await expect
    .poll(
      () =>
        page
          .evaluate((id) => {
            const bridge = (window as unknown as { __DASHBOARD_TEST__?: { byDatabase: (id: string) => unknown } })
              .__DASHBOARD_TEST__;

            return Boolean(bridge?.byDatabase(id)) && Boolean((window as unknown as { Y?: unknown }).Y);
          }, databaseId)
          .catch(() => false),
      { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for database ${databaseId} to mount` }
    )
    .toBe(true);
}

export interface DatabaseViewSummary {
  id: string;
  layout: number;
  name: string;
}

export async function readDatabaseViews(page: Page, databaseId: string): Promise<DatabaseViewSummary[]> {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const ctx = bridge?.byDatabase(id);
    const views = ctx?.databaseDoc.getMap('data').get('database')?.get('views');
    const result: { id: string; layout: number; name: string }[] = [];

    views?.forEach((view: any, viewId: string) => {
      result.push({ id: viewId, layout: Number(view.get('layout') ?? 0), name: String(view.get('name') ?? '') });
    });
    return result;
  }, databaseId);
}

/**
 * Drop the server's three blank template rows and its "Type" / "Done"
 * template fields so every fixture database holds exactly the seeded data.
 */
async function pruneTemplateData(
  page: Page,
  request: APIRequestContext,
  world: DashboardWorld,
  database: FixtureDatabase,
  defaultRowIds: string[]
) {
  const ownFieldIds = Object.values(database.fieldIds);
  const templateFieldIds = await page.evaluate(
    ({ databaseId, defaultRowIds, ownFieldIds }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge.byDatabase(databaseId);
      const doc = ctx.databaseDoc;
      const db = doc.getMap('data').get('database');
      const fields = db.get('fields');
      const templateFieldIds: string[] = [];

      fields.forEach((field: any, fieldId: string) => {
        const name = field.get('name');
        const ty = Number(field.get('ty'));

        if (ownFieldIds.includes(fieldId) || field.get('is_primary')) return;
        if ((name === 'Type' && ty === 3) || (name === 'Done' && ty === 5)) templateFieldIds.push(fieldId);
      });
      doc.transact(() => {
        db.get('views').forEach((view: any) => {
          const rowOrders = view.get('row_orders');

          for (let index = rowOrders.length - 1; index >= 0; index -= 1) {
            if (defaultRowIds.includes(rowOrders.get(index)?.id)) rowOrders.delete(index, 1);
          }

          const fieldOrders = view.get('field_orders');

          for (let index = fieldOrders.length - 1; index >= 0; index -= 1) {
            if (templateFieldIds.includes(fieldOrders.get(index)?.id)) fieldOrders.delete(index, 1);
          }

          templateFieldIds.forEach((fieldId) => view.get('field_settings')?.delete(fieldId));
        });
        templateFieldIds.forEach((fieldId) => fields.delete(fieldId));
      });
      return templateFieldIds;
    },
    { databaseId: database.databaseId, defaultRowIds, ownFieldIds }
  );

  const base = `/api/workspace/${world.workspaceId}/database/${database.databaseId}`;

  await expect
    .poll(
      async () => {
        const rows = await apiGet<{ id: string }[]>(request, world.owner.accessToken, `${base}/row`);
        const fields = await apiGet<{ id: string }[]>(request, world.owner.accessToken, `${base}/fields`);

        return (
          rows.every((row) => !defaultRowIds.includes(row.id)) &&
          fields.every((field) => !templateFieldIds.includes(field.id))
        );
      },
      { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for "${database.name}" template data removal to sync` }
    )
    .toBe(true);
}

/** Navigate to a database page (optionally a given view tab) and wait for it to mount. */
export async function openDatabasePage(page: Page, name: string, viewId?: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, name);
  const query = viewId ? `?v=${viewId}` : '';

  await page.goto(`/app/${world.workspaceId}/${database.pageId}${query}`, { waitUntil: 'domcontentloaded' });
  await waitForDatabaseContext(page, database.databaseId);
  if (viewId) {
    const tab = DatabaseViewSelectors.viewTab(page, viewId);

    await expect(tab).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
    if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: FIXTURE_TIMEOUT_MS });
  }
}

/** Folder `ViewLayout` values reported by the workspace database list. */
const FOLDER_LAYOUT_NAMES: Record<number, string> = {
  1: 'Grid',
  2: 'Board',
  3: 'Calendar',
  5: 'Chart',
  6: 'List',
  7: 'Gallery',
  8: 'Feed',
  10: 'Timeline',
  11: 'Dashboard',
};

interface WorkspaceDatabaseEntry {
  id: string;
  views: { view_id: string; name: string; layout: number }[];
}

/** The folder views of a database, as the widget picker lists them. */
export async function listFolderViews(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string
) {
  const databases = await apiGet<WorkspaceDatabaseEntry[]>(request, token, `/api/workspace/${workspaceId}/database`);

  return databases.find((database) => database.id === databaseId)?.views ?? [];
}

/**
 * Remember one view id per layout. The ids come from the workspace database
 * list (folder views), not from the database doc: a container-backed database
 * also holds a hidden inline view that no folder view points at, so the picker
 * never offers it and a widget cannot load another database through it.
 */
async function refreshKnownViews(request: APIRequestContext, world: DashboardWorld, database: FixtureDatabase) {
  let views: WorkspaceDatabaseEntry['views'] = [];

  await expect
    .poll(
      async () => {
        views = await listFolderViews(request, world.owner.accessToken, world.workspaceId, database.databaseId);
        return views.some((view) => view.layout === 1);
      },
      { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for "${database.name}" to appear in the workspace database list` }
    )
    .toBe(true);

  for (const view of views) {
    const layoutName = FOLDER_LAYOUT_NAMES[view.layout];

    if (layoutName && layoutName !== 'Dashboard' && !database.views[layoutName]) {
      database.views[layoutName] = view.view_id;
    }
  }
}

export async function prepareDashboardFixture(
  page: Page,
  request: APIRequestContext,
  names: string[] = ['Projects', 'Tasks', 'Notes']
): Promise<DashboardWorld> {
  const runId = uuidv4().slice(0, 8);
  const owner = await signInFixtureAccount(request, `dashboard-owner-${uuidv4()}@appflowy.io`);

  setupPageErrorHandling(page);
  await installDashboardTestBridge(page.context());
  await mockProSubscription(page);
  await signBrowserInWithSession(page, owner);
  const workspaces = await apiGet<{ visiting_workspace: { workspace_id: string } }>(
    request,
    owner.accessToken,
    '/api/user/workspace'
  );
  const workspaceId = workspaces.visiting_workspace.workspace_id;

  // Hosted release servers (CI) refuse Dashboard creation without a Pro plan.
  grantWorkspaceProSubscription(workspaceId);
  const spaceName = `Dashboards ${runId}`;
  const world: DashboardWorld = {
    runId,
    owner,
    workspaceId,
    spaceId: '',
    spaceName,
    databases: {},
    widgets: {},
  };

  // The fixture space is private so member scenarios can grant exact access levels.
  world.spaceId = await createSpace(request, owner.accessToken, workspaceId, spaceName, true);
  worlds.set(page, world);
  for (const name of names) await addFixtureDatabase(page, request, name);
  await openDatabasePage(page, names[0]);
  return world;
}

/**
 * Create one more fixture database (Backlog, Secrets, ... or a use-case
 * database described by `customSpec`) and prune its template data.
 */
export async function addFixtureDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  customSpec?: DatabaseSpec
) {
  const world = dashboardWorld(page);
  const spec = customSpec ?? DASHBOARD_FIXTURE_DATABASES[name];

  if (!spec) throw new Error(`Unknown fixture database "${name}"`);
  let spaceId = world.spaceId;

  if (spec.privateSpace) {
    world.privateSpaceId ??= await createSpace(
      request,
      world.owner.accessToken,
      world.workspaceId,
      `Owner only ${world.runId}`,
      true
    );
    spaceId = world.privateSpaceId;
  }

  const { defaultRowIds, ...database } = await createFixtureDatabase(request, world, name, spaceId, spec);

  world.databases[name] = database;
  await page.goto(`/app/${world.workspaceId}/${database.pageId}`, { waitUntil: 'domcontentloaded' });
  await waitForDatabaseContext(page, database.databaseId);
  await pruneTemplateData(page, request, world, database, defaultRowIds);
  await refreshKnownViews(request, world, database);
  if (!database.views.Grid) throw new Error(`"${name}" did not expose a Grid view`);
}

export async function cleanupDashboardFixture(page: Page, request: APIRequestContext) {
  const world = worlds.get(page);

  if (!world) return;
  await world.member?.context?.close().catch(() => undefined);
  for (const spaceId of [world.spaceId, world.privateSpaceId]) {
    if (!spaceId) continue;
    await apiPost<void>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/page-view/${spaceId}/move-to-trash`,
      {}
    ).catch(() => undefined);
  }

  worlds.delete(page);
}

export async function trashFixtureDatabase(page: Page, request: APIRequestContext, name: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, name);

  await apiPost<void>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/page-view/${database.pageId}/move-to-trash`,
    {}
  );
}

/** Add a view to a fixture database through its tab bar "+" menu and remember its id. */
export async function addViewThroughTabs(page: Page, name: string, layoutName: string) {
  const database = fixtureDatabase(page, name);
  const layout = LAYOUT_BY_NAME[layoutName];

  if (layout === undefined) throw new Error(`Unknown layout "${layoutName}"`);
  await openDatabasePage(page, name);
  const before = new Set((await readDatabaseViews(page, database.databaseId)).map((view) => view.id));

  await DatabaseViewSelectors.addViewButton(page).click();
  if (layout === DatabaseViewLayout.Timeline) {
    await TimelineSelectors.addViewOption(page).click();
  } else if (layout === DatabaseViewLayout.Dashboard) {
    await DashboardSelectors.addDashboardViewOption(page).click();
  } else {
    await DatabaseViewSelectors.viewTypeOption(page, layoutName).first().click();
  }

  let created: DatabaseViewSummary | undefined;

  await expect
    .poll(
      async () => {
        created = (await readDatabaseViews(page, database.databaseId)).find(
          (view) => !before.has(view.id) && view.layout === layout
        );
        return Boolean(created);
      },
      { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for the new ${layoutName} view of "${name}"` }
    )
    .toBe(true);
  const viewId = (created as DatabaseViewSummary).id;

  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveAttribute('data-state', 'active', {
    timeout: FIXTURE_TIMEOUT_MS,
  });
  if (layout !== DatabaseViewLayout.Dashboard) database.views[layoutName] = viewId;
  return viewId;
}

/** Add a dashboard view to a fixture database from the tab bar and remember it as the scenario's dashboard. */
export async function addDashboardView(page: Page, name: string) {
  const viewId = await addViewThroughTabs(page, name, 'Dashboard');
  const world = dashboardWorld(page);

  world.dashboardViewId = viewId;
  world.dashboardHost = name;
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
  return viewId;
}

export async function openDashboard(page: Page) {
  await openDatabasePage(page, hostDatabase(page).name, dashboardViewId(page));
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
}

/** The fixture database that owns the dashboard view. */
export function hostDatabase(page: Page): FixtureDatabase {
  const world = dashboardWorld(page);

  dashboardViewId(page);
  return fixtureDatabase(page, world.dashboardHost ?? 'Projects');
}

export async function reloadDashboard(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
  await waitForDatabaseContext(page, hostDatabase(page).databaseId);
}

// ---------------------------------------------------------------------------
// Dashboard layout state
// ---------------------------------------------------------------------------

export interface PersistedWidget {
  id: string;
  view_id: string;
  database_id: string;
  width: number;
}

export interface PersistedRow {
  id: string;
  height: number;
  widgets: PersistedWidget[];
}

export interface PersistedGlobalFilter {
  id: string;
  name: string;
  ty: number;
  condition: number;
  content: string;
  targets: Record<string, string>;
}

export interface PersistedDashboardSetting {
  exists: boolean;
  rows: PersistedRow[];
  global_filters: PersistedGlobalFilter[];
  show_widget_titles?: boolean;
}

/** The dashboard setting as the browser's host database doc holds it. */
export async function readDashboardSetting(
  page: Page,
  viewId = dashboardViewId(page)
): Promise<PersistedDashboardSetting> {
  const setting = await page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const ctx = bridge?.byView(id);

    if (!ctx) return null;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(id);
    const layout = view.get('layout_settings')?.get('9');

    if (!layout) return { exists: false, rows: [], global_filters: [] };
    return {
      exists: true,
      rows: bridge.plain(layout.get('rows')) ?? [],
      global_filters: bridge.plain(layout.get('global_filters')) ?? [],
      show_widget_titles: layout.get('show_widget_titles'),
    };
  }, viewId);

  if (!setting) throw new Error(`No mounted database doc holds dashboard view ${viewId}`);
  return setting as PersistedDashboardSetting;
}

/** The dashboard setting as the server stores it. */
export async function readServerDashboardSetting(
  page: Page,
  request: APIRequestContext
): Promise<PersistedDashboardSetting> {
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const collab = await apiGet<{ doc_state: number[] }>(
    request,
    world.owner.accessToken,
    `/api/workspace/v1/${world.workspaceId}/collab/${host.databaseId}?collab_type=${Types.Database}`
  );
  const doc = new Y.Doc({ guid: host.databaseId });

  Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
  const database = doc.getMap('data').get('database') as Y.Map<unknown> | undefined;
  const view = (database?.get('views') as Y.Map<Y.Map<unknown>> | undefined)?.get(dashboardViewId(page));
  const layout = (view?.get('layout_settings') as Y.Map<Y.Map<unknown>> | undefined)?.get(DASHBOARD_LAYOUT_KEY);
  const plain = (value: unknown) =>
    value instanceof Y.Map || value instanceof Y.Array ? (value.toJSON() as unknown) : value;

  if (!layout) return { exists: false, rows: [], global_filters: [] };
  return {
    exists: true,
    rows: (plain(layout.get('rows')) as PersistedRow[] | undefined) ?? [],
    global_filters: (plain(layout.get('global_filters')) as PersistedGlobalFilter[] | undefined) ?? [],
    show_widget_titles: layout.get('show_widget_titles') as boolean | undefined,
  };
}

/**
 * JSON with object keys sorted. The server stores these values as Yrs `Any`
 * maps, which re-encode object keys in arbitrary order; arrays keep theirs.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
}

/** Wait until the server holds the same rows and global filters as the browser. */
export async function waitForDashboardSync(page: Page, request: APIRequestContext) {
  const local = await readDashboardSetting(page);

  await expect
    .poll(
      async () => {
        const remote = await readServerDashboardSetting(page, request).catch(() => null);

        return (
          remote !== null &&
          canonicalJson(remote.rows) === canonicalJson(local.rows) &&
          canonicalJson(remote.global_filters) === canonicalJson(local.global_filters)
        );
      },
      { timeout: FIXTURE_TIMEOUT_MS, message: 'waiting for the dashboard layout to reach the server' }
    )
    .toBe(true);
}

export async function writeDashboardSetting(
  page: Page,
  patch: { rows?: PersistedRow[]; global_filters?: PersistedGlobalFilter[] }
) {
  await page.evaluate(
    ({ viewId, patch }) => {
      const win = window as any;
      const ctx = win.__DASHBOARD_TEST__.byView(viewId);

      if (!ctx) throw new Error(`No mounted database doc holds dashboard view ${viewId}`);
      const Yjs = win.Y;
      const doc = ctx.databaseDoc;
      const view = doc.getMap('data').get('database').get('views').get(viewId);

      doc.transact(() => {
        let layouts = view.get('layout_settings');

        if (!layouts) {
          layouts = new Yjs.Map();
          view.set('layout_settings', layouts);
        }

        let setting = layouts.get('9');

        if (!setting) {
          setting = new Yjs.Map();
          layouts.set('9', setting);
        }

        if (patch.rows) setting.set('rows', patch.rows);
        if (patch.global_filters) setting.set('global_filters', patch.global_filters);
      });
    },
    { viewId: dashboardViewId(page), patch }
  );
}

/** Row index (0-based) → labels, as a Given table lists them. */
export async function seedDashboardWidgets(page: Page, layout: { row: number; label: string }[]) {
  const world = dashboardWorld(page);
  const rowsByIndex = new Map<number, PersistedWidget[]>();

  for (const { row, label } of layout) {
    const { database } = parseViewLabel(label);
    const widget: PersistedWidget = {
      id: `w-${uuidv4().slice(0, 12)}`,
      view_id: viewIdForLabel(page, label),
      database_id: fixtureDatabase(page, database).databaseId,
      width: 0,
    };

    world.widgets[label] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
    rowsByIndex.set(row, [...(rowsByIndex.get(row) ?? []), widget]);
  }

  const rows: PersistedRow[] = [...rowsByIndex.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const widgets = rowsByIndex.get(index) ?? [];
      const width = Math.floor(DASHBOARD_GRID_COLUMNS / widgets.length);

      return {
        id: `r-${uuidv4().slice(0, 12)}`,
        height: DASHBOARD_DEFAULT_ROW_HEIGHT,
        widgets: widgets.map((widget, position) => ({
          ...widget,
          width: position === widgets.length - 1 ? DASHBOARD_GRID_COLUMNS - width * (widgets.length - 1) : width,
        })),
      };
    });

  // A dashboard that opened in Edit mode only because it was empty returns to
  // View mode when widgets arrive without the picker (they could be a stale
  // cache catching up). A scenario that was editing keeps editing, like a user
  // who then clicks Edit.
  const wasEditing = await DashboardSelectors.doneButton(page).isVisible();

  await writeDashboardSetting(page, { rows });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(layout.length, { timeout: WIDGET_TIMEOUT_MS });
  if (wasEditing) {
    await expect(DashboardSelectors.editButton(page).or(DashboardSelectors.doneButton(page))).toBeVisible();
    await enterEditMode(page);
  }
}

/**
 * Labels of a persisted row. Seeded widgets keep their seeded label; widgets
 * added through the UI are named after their view ("Tasks Grid").
 */
export function labelsOfRow(page: Page, row: PersistedRow): string[] {
  const world = dashboardWorld(page);

  return row.widgets.map((widget) => {
    const entry = Object.entries(world.widgets).find(([, known]) => known.id === widget.id);

    if (entry) return entry[0];
    for (const database of Object.values(world.databases)) {
      const layout = Object.keys(database.views).find((name) => database.views[name] === widget.view_id);

      if (layout) return `${database.name} ${layout}`;
    }

    return `?${widget.view_id}`;
  });
}

/** Widget ids per rendered dashboard row, in DOM order. */
export async function renderedRows(page: Page): Promise<string[][]> {
  return DashboardSelectors.rows(page).evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('[data-testid="dashboard-widget"]')).map(
        (widget) => widget.getAttribute('data-widget-id') ?? ''
      )
    )
  );
}

export async function persistedRow(page: Page, oneBasedIndex: number): Promise<PersistedRow> {
  const { rows } = await readDashboardSetting(page);
  const row = rows[oneBasedIndex - 1];

  if (!row) throw new Error(`The dashboard has no row ${oneBasedIndex} (it has ${rows.length})`);
  return row;
}

export function allWidgets(setting: PersistedDashboardSetting): PersistedWidget[] {
  return setting.rows.flatMap((row) => row.widgets);
}

// ---------------------------------------------------------------------------
// Pointer helpers
// ---------------------------------------------------------------------------

async function centerOf(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();

  if (!box) throw new Error('Element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Press, travel in small steps (crossing drag thresholds for pointer and native DnD), release. */
export async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;

  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }

  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

/** Widgets are dragged by their header in Edit mode. */
async function widgetGrip(page: Page, widget: Locator) {
  const header = widget.getByTestId('dashboard-widget-header');

  await widget.hover();
  const box = await header.boundingBox();

  if (!box) throw new Error('Widget header is not visible');
  // Grab the left part of the header, away from the title link and the menu button.
  return { x: box.x + Math.min(24, box.width / 4), y: box.y + box.height / 2 };
}

export async function dragWidgetBeside(page: Page, source: Locator, target: Locator, side: 'left' | 'right') {
  // Measure both ends in one scroll position: centre the source first (a
  // later scroll would move the grip), then drop on the visible part of the
  // target, which may be in the next row below.
  await source.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const grip = await widgetGrip(page, source);
  const box = await target.boundingBox();

  if (!box) throw new Error('Drop target widget is not rendered');
  const viewportHeight = page.viewportSize()?.height ?? 900;
  const top = Math.max(box.y, 60);
  const bottom = Math.min(box.y + box.height, viewportHeight - 10);

  if (bottom - top < 24) throw new Error('Drop target widget is not on screen with the dragged widget');
  const x = side === 'left' ? box.x + box.width * 0.15 : box.x + box.width * 0.85;

  await dragFromTo(page, grip, { x, y: (top + bottom) / 2 });
}

/** Drop into the gap between two rendered rows (a drop there creates a new row). */
export async function dragWidgetBetweenRows(page: Page, source: Locator, upperRowId: string, lowerRowId: string) {
  const grip = await widgetGrip(page, source);
  const upper = await DashboardSelectors.row(page, upperRowId).boundingBox();
  const lower = await DashboardSelectors.row(page, lowerRowId).boundingBox();

  if (!upper || !lower) throw new Error('Dashboard rows are not visible');
  const upperBottom = upper.y + upper.height;
  const y = lower.y - upperBottom >= 4 ? (upperBottom + lower.y) / 2 : lower.y + 2;

  await dragFromTo(page, grip, { x: lower.x + lower.width / 2, y });
}

export async function dragLocatorBy(page: Page, handle: Locator, dx: number, dy: number) {
  await expect(handle).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  const { x, y } = await centerOf(handle);

  await dragFromTo(page, { x, y }, { x: x + dx, y: y + dy });
}

export async function rowColumnWidth(page: Page, rowId: string) {
  const box = await DashboardSelectors.row(page, rowId).boundingBox();

  if (!box) throw new Error(`Dashboard row ${rowId} is not visible`);
  return box.width / DASHBOARD_GRID_COLUMNS;
}

// ---------------------------------------------------------------------------
// Widget UI
// ---------------------------------------------------------------------------

export async function openWidgetMenu(page: Page, widget: Locator) {
  await widget.hover();
  const button = widget.getByTestId('dashboard-widget-menu-button');

  await expect(button).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await button.click();
  await expect(DashboardSelectors.widgetMenu(page)).toBeVisible();
}

export async function chooseWidgetMenuAction(page: Page, widget: Locator, action: WidgetMenuAction) {
  await openWidgetMenu(page, widget);
  await DashboardSelectors.widgetMenuItem(page, action).click();
}

export async function openWidgetPicker(page: Page, trigger?: Locator) {
  const button = trigger ?? DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first();

  await expect(button).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await button.click();
  await expect(DashboardSelectors.picker(page)).toBeVisible();
}

export async function pickExistingView(page: Page, viewId: string, search?: string) {
  if (search !== undefined) await DashboardSelectors.pickerSearch(page).fill(search);
  const option = DashboardSelectors.pickerOption(page, viewId);

  await expect(option).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await option.click();
  await expect(DashboardSelectors.picker(page)).toBeHidden();
}

export async function expectDashboardMode(page: Page, mode: 'View' | 'Edit') {
  await expect(DashboardSelectors.view(page)).toBeVisible();
  if (mode === 'Edit') {
    await expect(DashboardSelectors.doneButton(page)).toBeVisible();
    await expect(DashboardSelectors.editButton(page)).toHaveCount(0);
  } else {
    await expect(DashboardSelectors.editButton(page)).toBeVisible();
    await expect(DashboardSelectors.doneButton(page)).toHaveCount(0);
    await expect(DashboardSelectors.widthHandles(page)).toHaveCount(0);
    await expect(DashboardSelectors.addWidgetButton(page).filter({ visible: true })).toHaveCount(0);
  }
}

export async function enterEditMode(page: Page) {
  if (await DashboardSelectors.doneButton(page).isVisible()) return;
  await DashboardSelectors.editButton(page).click();
  await expect(DashboardSelectors.doneButton(page)).toBeVisible();
}

export async function leaveEditMode(page: Page) {
  if (await DashboardSelectors.editButton(page).isVisible()) return;
  await DashboardSelectors.doneButton(page).click();
  await expect(DashboardSelectors.editButton(page)).toBeVisible();
}

/**
 * Open a row page from a widget the way a user would for its layout: the
 * expand button of a table row, a click on a list row, board card or gallery
 * card, or the open button of a timeline row.
 */
export async function openWidgetRow(scope: Page, widget: Locator, rowId: string) {
  await expect(widget).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  const layout = widget.locator(
    '[data-testid="database-grid"], [data-testid="database-list"], [data-testid="database-gallery"], [data-testid="timeline-view"], .database-board'
  );

  await expect(layout.first()).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  const kind = await layout
    .first()
    .evaluate((element) =>
      element.classList.contains('database-board') ? 'board' : element.getAttribute('data-testid') ?? ''
    );

  if (kind === 'database-grid') {
    const row = widget.getByTestId(`grid-row-${rowId}`);

    await expect(row).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    await row.hover();
    const expand = widget.getByTestId('row-expand-button').first();

    await expect(expand).toBeVisible();
    await expand.click();
    return;
  }

  if (kind === 'database-list') {
    const row = widget.getByTestId(`list-row-${rowId}`);

    await expect(row).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    await row.getByTestId(`list-primary-cell-${rowId}`).click();
    return;
  }

  if (kind === 'database-gallery') {
    const card = widget.getByTestId(`gallery-card-${rowId}`);

    await expect(card).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    await card.click();
    return;
  }

  if (kind === 'timeline-view') {
    const row = widget.getByTestId(`timeline-sidebar-row-${rowId}`);

    await expect(row).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    await row.hover();
    await widget.getByTestId(`timeline-open-row-${rowId}`).click();
    return;
  }

  const card = widget.locator(`[data-card-id*="${rowId}"]`).first();

  await expect(card).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await card.click();
}

/** Assert the exact set of row titles a grid widget shows. */
export async function expectGridWidgetRows(widget: Locator, titles: string[]) {
  await expect(gridDataRows(widget)).toHaveCount(titles.length, { timeout: WIDGET_TIMEOUT_MS });
  for (const title of titles) {
    await expect(widget.getByText(title, { exact: true }).first()).toBeVisible();
  }
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

async function openChartSettingsMenu(page: Page) {
  await page.keyboard.press('Escape');
  await ChartSettingsSelectors.settingsButton(page).click();
  await ChartSettingsSelectors.chartSettingsSubTrigger(page).click();
  await expect(page.getByTestId('chart-type-number')).toBeVisible({ timeout: 10_000 });
}

export interface ChartLayoutSnapshot {
  chartType: number;
  aggregationType: number;
  yFieldId?: string;
}

export async function readChartSetting(page: Page, viewId: string): Promise<ChartLayoutSnapshot | null> {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const view = bridge?.byView(id)?.databaseDoc.getMap('data').get('database').get('views').get(id);
    const setting = view?.get('layout_settings')?.get('3');

    if (!setting) return null;
    return {
      chartType: Number(setting.get('chartType') ?? 0),
      aggregationType: Number(setting.get('aggregationType') ?? 0),
      yFieldId: setting.get('yFieldId') ? String(setting.get('yFieldId')) : undefined,
    };
  }, viewId);
}

export const AGGREGATION_BY_NAME: Record<string, number> = { Count: 0, Sum: 1, Average: 2 };

/**
 * Turn a chart view into a Number chart through its settings menu, optionally
 * with an aggregation over a number property. Verified against the view's
 * persisted chart layout setting.
 */
export async function configureNumberChart(page: Page, databaseName: string, aggregation = 'Count', property?: string) {
  const database = fixtureDatabase(page, databaseName);
  const viewId = database.views.Chart;

  if (!viewId) throw new Error(`"${databaseName}" has no Chart view`);
  await openDatabasePage(page, databaseName, viewId);
  await openChartSettingsMenu(page);
  await page.getByTestId('chart-type-number').click();
  await expect.poll(async () => (await readChartSetting(page, viewId))?.chartType).toBe(4);

  const aggregationType = AGGREGATION_BY_NAME[aggregation];

  if (aggregationType === undefined) throw new Error(`Unknown number chart aggregation "${aggregation}"`);
  if (aggregationType !== AGGREGATION_BY_NAME.Count) {
    const item = page.getByTestId(`chart-number-aggregation-${aggregationType}`);

    if (!(await item.isVisible())) await openChartSettingsMenu(page);
    await item.click();
    await expect.poll(async () => (await readChartSetting(page, viewId))?.aggregationType).toBe(aggregationType);
  }

  if (property) {
    const fieldId = database.fieldIds[property];

    if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
    const item = page.getByTestId(`chart-number-property-${fieldId}`);

    if (!(await item.isVisible())) await openChartSettingsMenu(page);
    await item.click();
    await expect.poll(async () => (await readChartSetting(page, viewId))?.yFieldId).toBe(fieldId);
  }

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('number-chart')).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function joinWorkspace(request: APIRequestContext, owner: AuthSession, member: AuthSession, workspaceId: string) {
  const invite = await apiPost<{ code: string | null }>(
    request,
    owner.accessToken,
    `/api/workspace/${workspaceId}/invite-code`,
    { validity_period_hours: 24 }
  );
  const code =
    invite.code ??
    (await apiGet<{ code: string | null }>(request, owner.accessToken, `/api/workspace/${workspaceId}/invite-code`))
      .code;

  if (!code) throw new Error(`Workspace ${workspaceId} returned no invite code`);
  await apiPost<unknown>(request, member.accessToken, '/api/workspace/join-by-invite-code', { code });
}

async function findMemberUid(request: APIRequestContext, token: string, workspaceId: string, email: string) {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/member?include_pending=true`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  // Member uids exceed Number.MAX_SAFE_INTEGER; keep them as strings.
  const text = (await response.text()).replace(/"uid"\s*:\s*(\d{16,})/g, '"uid":"$1"');
  const body = parseJson<ApiEnvelope<{ uid?: string | number; email: string }[]>>(text);
  const member = body?.data?.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());

  if (member?.uid === undefined) throw new Error(`No workspace member uid for ${email}: ${text}`);
  return String(member.uid);
}

/**
 * Invite a member to the workspace and grant `access` on the fixture space.
 * `none` joins the workspace without any space grant.
 */
export async function inviteDashboardMember(
  page: Page,
  request: APIRequestContext,
  access: 'read-only' | 'read-and-write' | 'none'
) {
  const world = dashboardWorld(page);
  const email = `dashboard-member-${uuidv4()}@appflowy.io`;
  const session = await signInFixtureAccount(request, email);

  await joinWorkspace(request, world.owner, session, world.workspaceId);
  if (access !== 'none') {
    const uid = await findMemberUid(request, world.owner.accessToken, world.workspaceId, email);
    const level = access === 'read-only' ? ACCESS_LEVEL_READ_ONLY : ACCESS_LEVEL_READ_AND_WRITE;

    // Private spaces have no roster (access to them is granted per page), so
    // the fixture space becomes a custom space: explicit members only, all at
    // `level`, and no access for everyone else in the workspace.
    await apiPatch<unknown>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/spaces/${world.spaceId}/permission`,
      {
        visibility: 'custom',
        owner_access_level: ACCESS_LEVEL_FULL,
        member_default_access_level: level,
        everyone_else_access_level: null,
      }
    );
    // Raw JSON keeps the 64-bit uid exact.
    await apiPost<unknown>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/spaces/${world.spaceId}/members`,
      `{"uid":${uid},"role":"member","access_level":${level}}`
    );
  }

  world.member = { email, session };
  return world.member;
}

/** Open the scenario's dashboard in a separate browser signed in as the member. */
export async function openDashboardAsMember(page: Page) {
  const world = dashboardWorld(page);
  const member = world.member;

  if (!member) throw new Error('No member has been invited in this scenario');
  const browser = page.context().browser();

  if (!browser) throw new Error('The scenario page has no browser');
  member.context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 1440, height: 900 },
  });
  await installDashboardTestBridge(member.context);
  member.page = await member.context.newPage();
  setupPageErrorHandling(member.page);
  await mockProSubscription(member.page);
  await signBrowserInWithSession(member.page, member.session);
  const host = hostDatabase(page);

  await member.page.goto(`/app/${world.workspaceId}/${host.pageId}?v=${dashboardViewId(page)}`, {
    waitUntil: 'domcontentloaded',
  });
  const tab = DatabaseViewSelectors.viewTab(member.page, dashboardViewId(page));

  await expect(tab).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
  await expect(DashboardSelectors.view(member.page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
  return member.page;
}

export function memberPage(page: Page): Page {
  const memberPageRef = dashboardWorld(page).member?.page;

  if (!memberPageRef) throw new Error('The member has not opened the dashboard');
  return memberPageRef;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export async function dashboardSidebarEntry(page: Page) {
  const world = dashboardWorld(page);
  const host = hostDatabase(page);

  await expandSpaceByName(page, world.spaceName);
  await ensurePageExpandedByViewId(page, host.pageId);
  return page.getByTestId(`page-${dashboardViewId(page)}`).first();
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

export function globalFilterChip(page: Page, name: string): Locator {
  return DashboardSelectors.globalFilterChips(page).filter({ hasText: name }).first();
}

export async function openGlobalFilterMenu(page: Page) {
  if (await DashboardSelectors.globalFilterMenu(page).isVisible()) return;
  await DashboardSelectors.globalFilterButton(page).click();
  await expect(DashboardSelectors.globalFilterMenu(page)).toBeVisible();
}

export async function openGlobalFilterChip(scope: Page, name: string) {
  const chip = globalFilterChip(scope, name);

  await expect(chip).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await chip.click();
  await expect(DashboardSelectors.globalFilterMenu(scope)).toBeVisible();
}

export async function closeGlobalFilterMenu(scope: Page) {
  const menu = DashboardSelectors.globalFilterMenu(scope);
  const done = DashboardSelectors.globalFilterDone(scope);

  // Done closes the menu from the editor; the filter list has no Done button.
  if (await done.isVisible()) {
    await done.click();
    await expect(done).toBeHidden();
  }

  if (await menu.isVisible()) await scope.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

/**
 * Start a global filter of `typeName`, map it to exactly the given
 * database → property pairs (unmapping every other suggested source) and name
 * it after the first mapped property, so chips are addressable by that name
 * whichever source the editor suggested first.
 */
export async function addGlobalFilter(page: Page, typeName: string, mapping: Record<string, string>) {
  const fieldType = FIELD_TYPE_BY_NAME[typeName];

  if (fieldType === undefined) throw new Error(`Unknown property type "${typeName}"`);
  await openGlobalFilterMenu(page);
  const option = DashboardSelectors.globalFilterPropertyOption(page, fieldType);

  if (!(await option.isVisible())) await DashboardSelectors.globalFilterAdd(page).click();
  await option.click();
  await expect(page.getByTestId('dashboard-global-filter-editor')).toBeVisible();
  await mapGlobalFilterTargets(page, mapping);
  await renameGlobalFilter(page, Object.values(mapping)[0]);
}

export async function renameGlobalFilter(page: Page, name: string) {
  const input = DashboardSelectors.globalFilterName(page);
  const filterId = await page.getByTestId('dashboard-global-filter-editor').getAttribute('data-filter-id');

  await input.fill(name);
  await expect(input).toHaveValue(name);
  // The name input is debounced; wait for the saved value.
  await expect
    .poll(async () => (await readDashboardSetting(page)).global_filters.find((filter) => filter.id === filterId)?.name)
    .toBe(name);
}

/**
 * The editor lists one target row per mapped source (carrying its field id);
 * unmapped sources with a matching property sit under "Add source".
 */
async function mappedTargetIds(page: Page): Promise<string[]> {
  return DashboardSelectors.globalFilterTargets(page).evaluateAll((targets) =>
    targets
      .filter((target) => (target.getAttribute('data-field-id') ?? '') !== '')
      .map((target) => target.getAttribute('data-database-id') ?? '')
  );
}

export async function removeGlobalFilterTarget(page: Page, databaseId: string) {
  const target = DashboardSelectors.globalFilterTarget(page, databaseId);

  await target.getByTestId('dashboard-global-filter-target-remove').click();
  await expect(target).toHaveCount(0);
}

/** Map an unmapped source through the "Add source" menu (it picks the first compatible property). */
async function addGlobalFilterSource(page: Page, databaseId: string) {
  await page.getByTestId('dashboard-global-filter-add-source').click();
  await page
    .locator(`[data-testid="dashboard-global-filter-add-source-option"][data-database-id="${databaseId}"]`)
    .click();
  await expect(DashboardSelectors.globalFilterTarget(page, databaseId)).toBeVisible();
}

export async function mapGlobalFilterTargets(page: Page, mapping: Record<string, string>) {
  const wanted = new Map(
    Object.entries(mapping).map(([database, property]) => {
      const fixture = fixtureDatabase(page, database);
      const fieldId = fixture.fieldIds[property] ?? '';

      return [fixture.databaseId, { property, fieldId }] as const;
    })
  );

  await expect(DashboardSelectors.globalFilterTargets(page).first()).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });

  for (const [databaseId, { property, fieldId }] of wanted) {
    const target = DashboardSelectors.globalFilterTarget(page, databaseId);

    if (!(await target.isVisible())) await addGlobalFilterSource(page, databaseId);
    await expect(target, `the global filter lists no source for ${databaseId}`).toBeVisible();
    // The primary field has no fixture id; match it by name instead.
    const alreadyMapped = fieldId
      ? (await target.getAttribute('data-field-id')) === fieldId
      : new RegExp(`^\\s*${escapeRegExp(property)}\\s*$`).test(
          (await target.getByTestId('dashboard-global-filter-target-select').textContent()) ?? ''
        );

    if (alreadyMapped) continue;
    await target.getByTestId('dashboard-global-filter-target-select').click();
    const options = page.locator('[data-testid="dashboard-global-filter-target-option"]');
    const item = fieldId
      ? options.and(page.locator(`[data-field-id="${fieldId}"]`))
      : options.filter({ hasText: property, visible: true }).first();

    await item.click();
    await expect(target.getByTestId('dashboard-global-filter-target-select')).toContainText(property);
  }

  for (const databaseId of await mappedTargetIds(page)) {
    if (!wanted.has(databaseId)) await removeGlobalFilterTarget(page, databaseId);
  }

  await expect.poll(async () => (await mappedTargetIds(page)).sort()).toEqual([...wanted.keys()].sort());
}

export async function chooseGlobalFilterCondition(scope: Page, label: string) {
  await DashboardSelectors.globalFilterCondition(scope).click();
  await scope
    .getByTestId('dashboard-global-filter-condition-option')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i'), visible: true })
    .first()
    .click();
}

export async function fillGlobalFilterText(scope: Page, text: string) {
  const content = DashboardSelectors.globalFilterContent(scope);
  const tag = await content.evaluate((element) => element.tagName);
  const input = tag === 'INPUT' || tag === 'TEXTAREA' ? content : content.locator('input, textarea').first();

  await input.fill(text);
  await expect(input).toHaveValue(text);
}

/** Toggle a select option in the open filter editor (fixture options share ids across databases). */
export async function toggleGlobalFilterOption(scope: Page, optionName: string) {
  const option = DashboardSelectors.globalFilterContent(scope).locator(
    `[data-testid="dashboard-global-filter-option"][data-option-id="${statusOptionId(optionName)}"]`
  );
  const checked = await option.getAttribute('data-checked');

  await option.click();
  await expect(option).not.toHaveAttribute('data-checked', checked ?? 'false');
}

/** Seed persisted global filters directly (for scenarios about their effect, not their editor). */
export function selectGlobalFilter(page: Page, name: string, optionNames: string[], mapping: Record<string, string>) {
  return buildGlobalFilter(page, name, FieldType.SingleSelect, 0, optionNames.map(statusOptionId).join(','), mapping);
}

export function buildGlobalFilter(
  page: Page,
  name: string,
  fieldType: FieldType,
  condition: number,
  content: string,
  mapping: Record<string, string>
): PersistedGlobalFilter {
  const targets: Record<string, string> = {};

  Object.entries(mapping).forEach(([databaseName, property]) => {
    const database = fixtureDatabase(page, databaseName);
    const fieldId = database.fieldIds[property];

    if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
    targets[database.databaseId] = fieldId;
  });
  return { id: `gf-${uuidv4().slice(0, 12)}`, name, ty: fieldType, condition, content, targets };
}

/** "Status" in "Projects", "Stage" in "Tasks" → { Projects: 'Status', Tasks: 'Stage' } */
export function parseMapping(text: string): Record<string, string> {
  const mapping: Record<string, string> = {};
  const pattern = /"([^"]+)" in "([^"]+)"/g;
  let match = pattern.exec(text);

  while (match) {
    mapping[match[2]] = match[1];
    match = pattern.exec(text);
  }

  if (Object.keys(mapping).length === 0) throw new Error(`No "<property>" in "<database>" pairs in: ${text}`);
  return mapping;
}

export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
