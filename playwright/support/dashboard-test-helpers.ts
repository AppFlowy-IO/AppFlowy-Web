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
import { APIRequestContext, BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  DASHBOARD_COLUMN_GAP_PX,
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_WIDGET_BOX_BLEED,
} from '../../src/application/database-yjs/dashboard-geometry';
import { DASHBOARD_LAYOUT_KEY } from '../../src/application/database-yjs/dashboard.type';
import { FieldType } from '../../src/application/database-yjs/database.type';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import { AuthTestUtils } from './auth-utils';
import {
  CHART_AGGREGATION_BY_NAME,
  chooseChartCalculation,
  closeChartPanel,
  openChartPagePanel,
  openChartPanelRow,
} from './chart-settings-helpers';
import { mockProSubscription } from './chart-test-helpers';
import {
  apiGet,
  apiHeaders,
  apiPatch,
  apiPost,
  canonicalJson,
  equalRowWidths,
  escapeRegExp,
  parseJson,
  plainYjs,
  pressEscapeUntilHidden,
  readServerDatabaseDoc,
  WIDGET_TIMEOUT_MS,
} from './dashboard-shared-helpers';
import { ensurePageExpandedByViewId, expandSpaceByName } from './page-utils';
import { DatabaseViewSelectors, SidebarSelectors, TimelineSelectors } from './selectors';
import { grantWorkspaceProSubscription } from './subscription-test-helpers';
import { installRuntimeTestConfig, setupPageErrorHandling, TestConfig } from './test-config';

export { DatabaseViewLayout, FieldType };
export { apiGet, apiPatch, apiPost, escapeRegExp };

// The `layout_settings` key, the limits and the geometry come from the app (bound to `dashboard-parity/tokens.json`).
export {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
};
/** The gap between widget boxes, and the bleed of each row track past the content column (WP02). */
export const DASHBOARD_COLUMN_GAP = DASHBOARD_COLUMN_GAP_PX;
export const DASHBOARD_BOX_INSET = DASHBOARD_WIDGET_BOX_BLEED;

const FIXTURE_TIMEOUT_MS = 45_000;
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL = 50;
const SPACE_PERMISSION_PUBLIC = 0;
const SPACE_PERMISSION_PRIVATE = 1;
/** The `layout_settings` key of a chart view's settings. */
const CHART_LAYOUT_KEY = String(DatabaseViewLayout.Chart);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const DashboardSelectors = {
  view: (page: Page) => page.getByTestId('dashboard-view'),
  emptyState: (page: Page) => page.getByTestId('dashboard-empty-state'),
  editButton: (page: Page) => page.getByTestId('dashboard-edit-button'),
  doneButton: (page: Page) => page.getByTestId('dashboard-done-button'),
  grid: (page: Page) => page.getByTestId('dashboard-grid'),
  rows: (page: Page) => page.getByTestId('dashboard-row'),
  row: (page: Page, rowId: string) => page.locator(`[data-testid="dashboard-row"][data-row-id="${rowId}"]`),
  /** The row's widget boxes flex in its track, which bleeds 6px past the content column on both sides. */
  rowTrack: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-row"][data-row-id="${rowId}"] > [data-testid="dashboard-row-track"]`),
  /** The band before row `index` (0 = above the first row), in View and Edit mode. */
  rowGap: (page: Page, index: number) => page.locator(`[data-testid="dashboard-row-gap"][data-gap-index="${index}"]`),
  rowControlAnchor: (page: Page, rowId: string, side: 'start' | 'end') =>
    page.locator(
      `[data-testid="dashboard-row"][data-row-id="${rowId}"] > [data-testid="dashboard-row-control-anchor"][data-side="${side}"]`
    ),
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
  /** The docked "New view" picker (`data-state` creating | ready, `data-widget-id`, `data-side`), or the Source panel (`data-mode="replace"`). */
  picker: (page: Page) => page.getByTestId('dashboard-widget-picker'),
  pickerSearch: (page: Page) => page.getByTestId('dashboard-widget-picker-search'),
  pickerOption: (page: Page, viewId: string) =>
    page.locator(`[data-testid="dashboard-widget-picker-option"][data-view-id="${viewId}"]`),
  pickerOptions: (page: Page) => page.getByTestId('dashboard-widget-picker-option'),
  pickerLayoutOption: (page: Page, layout: DatabaseViewLayout) =>
    page.locator(`[data-testid="dashboard-widget-picker-layout-option"][data-layout="${layout}"]`),
  pickerLayoutOptions: (page: Page) => page.getByTestId('dashboard-widget-picker-layout-option'),
  /** A picker section: `host` ("Views on …"), `other` (Other data sources) or `new` (New view). */
  pickerSection: (page: Page, section: 'host' | 'other' | 'new') =>
    page.locator(`[data-testid="dashboard-widget-picker-section"][data-section="${section}"]`),
  pickerShowMore: (page: Page, databaseId?: string) =>
    databaseId
      ? page.locator(`[data-testid="dashboard-widget-picker-show-more"][data-database-id="${databaseId}"]`)
      : page.getByTestId('dashboard-widget-picker-show-more'),
  pickerOtherSources: (page: Page) => page.getByTestId('dashboard-widget-picker-other-sources'),
  pickerNewInDatabase: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-widget-picker-new-in-database"][data-database-id="${databaseId}"]`),
  pickerClose: (page: Page) => page.getByTestId('dashboard-widget-picker-close'),
  pickerBack: (page: Page) => page.getByTestId('dashboard-widget-picker-back'),
  /** The add flow's widget while its default view is created (`data-widget-id`). */
  pendingWidget: (page: Page) => page.getByTestId('dashboard-widget-pending'),
  newViewPanel: (page: Page) => page.getByTestId('dashboard-widget-new-view-panel'),
  newViewName: (page: Page) => page.getByTestId('dashboard-widget-new-view-panel-name'),
  newViewTile: (page: Page, layout: DatabaseViewLayout) =>
    page.locator(`[data-testid="dashboard-widget-new-view-panel-tile"][data-layout="${layout}"]`),
  editChartButton: (page: Page) => page.getByTestId('dashboard-widget-edit-chart'),
  emptyNewViewButton: (page: Page) => page.getByTestId('dashboard-empty-new-view-button'),
  emptyEditDashboardButton: (page: Page) => page.getByTestId('dashboard-empty-edit-dashboard-button'),
  emptyIllustration: (page: Page) => page.getByTestId('dashboard-empty-illustration'),
  emptyPlaceholder: (page: Page) => page.getByTestId('dashboard-empty-placeholder'),
  widthHandle: (page: Page, rowId: string, index: number) =>
    page.locator(`[data-testid="dashboard-width-handle"][data-row-id="${rowId}"][data-index="${index}"]`),
  widthHandles: (page: Page) => page.getByTestId('dashboard-width-handle'),
  resizePill: (page: Page, rowId: string, index: number) =>
    page
      .locator(`[data-testid="dashboard-width-handle"][data-row-id="${rowId}"][data-index="${index}"]`)
      .getByTestId('dashboard-resize-pill'),
  heightHandle: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-height-handle"][data-row-id="${rowId}"]`),
  globalFilterButton: (page: Page) => page.getByTestId('dashboard-global-filter-button'),
  globalFilterBar: (page: Page) => page.getByTestId('dashboard-global-filter-bar'),
  globalFilterChips: (page: Page) => page.getByTestId('dashboard-global-filter-chip'),
  globalFilterMenu: (page: Page) => page.getByTestId('dashboard-global-filter-menu'),
  /** The bar's grey `+ Filter` (writers). */
  globalFilterBarAdd: (page: Page) => page.getByTestId('dashboard-global-filter-bar-add'),
  /** "Filter by…": the picker's search box (WP08 §1.2). */
  globalFilterSearch: (page: Page) => page.getByTestId('dashboard-global-filter-search'),
  globalFilterFieldOptions: (page: Page) => page.getByTestId('dashboard-global-filter-field-option'),
  globalFilterFieldOption: (page: Page, databaseId: string, fieldId: string) =>
    page.locator(
      `[data-testid="dashboard-global-filter-field-option"][data-database-id="${databaseId}"][data-field-id="${fieldId}"]`
    ),
  globalFilterSourceGroups: (page: Page) => page.getByTestId('dashboard-global-filter-source-group'),
  globalFilterSourceGroup: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-global-filter-source-group"][data-database-id="${databaseId}"]`),
  /** `··· N more` of a source group (or of the flat list). */
  globalFilterMore: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-global-filter-more"][data-database-id="${databaseId}"]`),
  globalFilterNoResults: (page: Page) => page.getByTestId('dashboard-global-filter-no-results'),
  globalFilterMultipleSources: (page: Page) => page.getByTestId('dashboard-global-filter-multiple-sources'),
  globalFilterMultiIntro: (page: Page) => page.getByTestId('dashboard-global-filter-multi-intro'),
  globalFilterAddToFilter: (page: Page) => page.getByTestId('dashboard-global-filter-add-to-filter'),
  globalFilterBuilder: (page: Page) => page.getByTestId('dashboard-global-filter-builder'),
  globalFilterAddAnother: (page: Page) => page.getByTestId('dashboard-global-filter-add-another'),
  /** A reader's list of the dashboard's filters (toolbar popover). */
  globalFilterReaderItems: (page: Page) => page.getByTestId('dashboard-global-filter-reader-item'),
  globalFilterPillEditor: (page: Page) => page.getByTestId('dashboard-global-filter-pill-editor'),
  /** The pill editor's `···` (writers): Filter multiple sources, Delete filter. */
  globalFilterMoreActions: (page: Page) => page.getByTestId('dashboard-global-filter-more-actions'),
  globalFilterOpenBuilder: (page: Page) => page.getByTestId('dashboard-global-filter-open-builder'),
  globalFilterRelativeDirection: (page: Page) => page.getByTestId('dashboard-global-filter-relative-direction'),
  globalFilterRelativeAmount: (page: Page) => page.getByTestId('dashboard-global-filter-relative-amount'),
  globalFilterRelativeUnit: (page: Page) => page.getByTestId('dashboard-global-filter-relative-unit'),
  globalFilterRelativeHint: (page: Page) => page.getByTestId('dashboard-global-filter-relative-hint'),
  globalFilterName: (page: Page) => page.getByTestId('dashboard-global-filter-name'),
  globalFilterTargets: (page: Page) => page.getByTestId('dashboard-global-filter-target'),
  globalFilterTarget: (page: Page, databaseId: string) =>
    page.locator(`[data-testid="dashboard-global-filter-target"][data-database-id="${databaseId}"]`),
  globalFilterCondition: (page: Page) => page.getByTestId('dashboard-global-filter-condition'),
  globalFilterContent: (page: Page) => page.getByTestId('dashboard-global-filter-content'),
  globalFilterDelete: (page: Page) => page.getByTestId('dashboard-global-filter-delete'),
  /** Done of the multiple sources builder (the pill editor has none). */
  globalFilterDone: (page: Page) => page.getByTestId('dashboard-global-filter-done'),
  globalFilterReset: (page: Page) => page.getByTestId('dashboard-global-filter-reset'),
  globalFilterSaveForEveryone: (page: Page) => page.getByTestId('dashboard-global-filter-save-for-everyone'),
  /** Reset and "Save for everyone" at the bar's right end, while something is unsaved (WP07). */
  privateControls: (page: Page) => page.getByTestId('dashboard-private-controls'),
  /** Every orange "unsaved changes" dot: pills, the toolbar button and the widget tools. */
  unsavedDots: (scope: Page | Locator) => scope.locator('[data-slot="unsaved-dot"]'),
  addDashboardViewOption: (page: Page) => page.getByTestId('add-dashboard-view-button'),
  viewIcon: (scope: Page | Locator) => scope.getByTestId('dashboard-view-icon'),
  /** WP14b: a phone's bottom sheet, of one kind (`data-sheet`: widget-filter, widget-menu, global-filter, global-filter-pill, drilldown, views) or the open one. */
  mobileSheet: (page: Page, kind?: string) =>
    kind ? page.locator(`[data-testid="mobile-sheet"][data-sheet="${kind}"]`) : page.getByTestId('mobile-sheet').last(),
  mobileSheetTitle: (page: Page) => page.getByTestId('mobile-sheet').last().getByTestId('mobile-sheet-title'),
  /** A sheet row by its `data-item-id` (`view-data-source`, a view id, `new-view`, …). */
  mobileSheetItem: (page: Page, id: string) =>
    page.getByTestId('mobile-sheet').last().locator(`[data-testid="mobile-sheet-item"][data-item-id="${id}"]`),
  mobileSheetItems: (page: Page) => page.getByTestId('mobile-sheet').last().getByTestId('mobile-sheet-item'),
  mobileSheetClose: (page: Page) => page.getByTestId('mobile-sheet').last().getByTestId('mobile-sheet-close'),
  mobileSheetBack: (page: Page) => page.getByTestId('mobile-sheet').last().getByTestId('mobile-sheet-back'),
  /** The view switcher that replaces the tab strip below 768px. */
  viewPill: (page: Page) => page.getByTestId('database-view-pill'),
  /** The chart tooltip, of one category (`data-category`) or whichever shows. */
  chartTooltip: (page: Page, category?: string) =>
    category
      ? page.locator(`[data-testid="chart-tooltip"][data-category="${category}"]`)
      : page.getByTestId('chart-tooltip'),
  /** A widget's tool by its slot (`data-widget-tool`): the same on desktop and on a phone. */
  widgetTool: (widget: Locator, tool: string) =>
    widget.locator(`[data-widget-tool="${tool.toLowerCase()}"]`).getByRole('button').first(),
};

/** The widget menu's entries (WP04 §1.7); `create-row-*` live in the "Move to row" submenu. */
export type WidgetMenuAction =
  | 'view-data-source'
  | 'edit-view'
  | 'move-left'
  | 'move-right'
  | 'move-to-row'
  | 'create-row-above'
  | 'create-row-below'
  | 'duplicate'
  | 'delete';

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
  /**
   * Option ids are `<prefix>-<slug>` instead of the shared named ids, so two
   * databases list options of the same name under different ids (WP08 §1.9).
   */
  optionIdPrefix?: string;
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

/** The id of a select option of `field`: its prefixed id, or the id shared by every option of that name. */
function fieldOptionId(field: FieldSpec, name: string): string {
  const id = namedOptionId(name);

  return field.optionIdPrefix ? `${field.optionIdPrefix}-${id.slice('uc-opt-'.length)}` : id;
}

function selectOptionsFor(field: FieldSpec) {
  if (!field.options) return STATUS_OPTIONS;
  return field.options.map((name, index) => ({
    id: fieldOptionId(field, name),
    name,
    color: OPTION_COLORS[index % OPTION_COLORS.length],
  }));
}

/**
 * Projects and Tasks share every property type under different names, so a
 * global filter maps one property per source. Notes has only a title and a
 * number, and Backlog has no rows. Projects.Region and Tasks.Area list
 * options of the same names under different ids (and spellings), so a select
 * filter mapped to both matches them by name (WP08 §1.9); they come after the
 * Status / Stage selects, so boards and charts still group by those.
 */
export const DASHBOARD_FIXTURE_DATABASES: Record<string, DatabaseSpec> = {
  Projects: {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect },
      { name: 'Estimate', type: FieldType.Number },
      { name: 'Due', type: FieldType.DateTime },
      { name: 'Urgent', type: FieldType.Checkbox },
      { name: 'Region', type: FieldType.SingleSelect, options: ['Europe', 'Asia'], optionIdPrefix: 'proj-region' },
    ],
    rows: [
      { Name: 'Website launch', Status: 'Doing', Estimate: 3, Due: { dayOffset: 0 }, Urgent: true, Region: 'Europe' },
      { Name: 'Mobile app', Status: 'Todo', Estimate: 5, Due: { dayOffset: 10 }, Urgent: false, Region: 'Asia' },
      { Name: 'API cleanup', Status: 'Done', Estimate: 8, Due: { dayOffset: -3 }, Urgent: true },
    ],
  },
  Tasks: {
    fields: [
      { name: 'Stage', type: FieldType.SingleSelect },
      { name: 'Points', type: FieldType.Number },
      { name: 'Deadline', type: FieldType.DateTime },
      { name: 'Blocked', type: FieldType.Checkbox },
      {
        name: 'Area',
        type: FieldType.SingleSelect,
        options: ['EUROPE', 'Asia', 'Africa'],
        optionIdPrefix: 'task-area',
      },
    ],
    rows: [
      {
        Name: 'Write launch plan',
        Stage: 'Doing',
        Points: 2,
        Deadline: { dayOffset: 0 },
        Blocked: false,
        Area: 'EUROPE',
      },
      { Name: 'Review', Stage: 'Todo', Points: 1, Deadline: { dayOffset: 5 }, Blocked: false, Area: 'Africa' },
      { Name: 'Ship', Stage: 'Done', Points: 4, Deadline: { dayOffset: -1 }, Blocked: true, Area: 'Asia' },
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

/**
 * WP14c (`dashboard-localization.feature`): Amount is a plain number and the
 * two payments fall in January and February 2026 (local noon, as the web
 * stores a picked date), 78,500,000 in all. Created through the `specs`
 * argument of `addFixtureDatabases`; `dashboard-localization-helpers.ts` adds
 * its "Monthly" bar chart and "Total" number chart.
 */
export const BUDGET_FIXTURE: DatabaseSpec = {
  fields: [
    { name: 'Amount', type: FieldType.Number },
    { name: 'Paid on', type: FieldType.DateTime },
  ],
  rows: [
    { Name: 'Ads', Amount: 50_000_000, 'Paid on': new Date(2026, 0, 15, 12).toISOString() },
    { Name: 'Agency', Amount: 28_500_000, 'Paid on': new Date(2026, 1, 3, 12).toISOString() },
  ],
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
  await installRuntimeTestConfig(context);
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
    type BridgeContext = {
      workspaceId?: string;
      activeViewId?: string;
      databaseDoc?: { guid?: string; getMap: (name: string) => any };
    };
    const win = window as unknown as Record<string, unknown> & { Cypress?: boolean };

    win.Cypress = true;
    if (win.__DASHBOARD_TEST__) return;
    const contexts: BridgeContext[] = [];
    let current: unknown;
    const record = (value: unknown) => {
      const ctx = value as BridgeContext | undefined;

      if (!ctx || !ctx.databaseDoc) return;
      const databaseId = ctx.databaseDoc.getMap('data')?.get('database')?.get('id') ?? ctx.databaseDoc.guid;

      // React exposes a fresh context value after row-map updates. Keep the
      // newest value for each database/view, not hundreds of historical maps
      // that would distort the heap and lifetime measurements of the app.
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        const previous = contexts[index];
        const previousId =
          previous.databaseDoc?.getMap('data')?.get('database')?.get('id') ?? previous.databaseDoc?.guid;
        const sameDatabase =
          previous.databaseDoc === ctx.databaseDoc || (databaseId !== undefined && previousId === databaseId);

        if (previous.workspaceId === ctx.workspaceId && previous.activeViewId === ctx.activeViewId && sameDatabase) {
          contexts.splice(index, 1);
        }
      }

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

export async function createSpace(
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

/** Run `task` over `items` with at most `concurrency` calls in flight; results keep the input order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

async function createFixtureDatabase(
  request: APIRequestContext,
  world: DashboardWorld,
  name: string,
  spaceId: string,
  spec: DatabaseSpec,
  rowConcurrency = 1
): Promise<FixtureDatabase & { defaultRowIds: string[] }> {
  const token = world.owner.accessToken;
  const created = await apiPost<{ view_id: string; database_id?: string }>(
    request,
    token,
    `/api/workspace/${world.workspaceId}/page-view`,
    // Database pages are created as grids and get extra views through the tab bar.
    { parent_view_id: spaceId, layout: ViewLayout.Grid, name }
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

  // One row at a time keeps the table order; a scenario that does not care about it may ask for more.
  await mapConcurrent(spec.rows, rowConcurrency, async (row) => {
    const cells: Record<string, string | number | boolean> = {};

    Object.entries(row).forEach(([key, value]) => {
      cells[key] = typeof value === 'object' ? localNoonIso(value.dayOffset) : value;
    });
    rowIds[String(row.Name)] = await apiPost<string>(request, token, `${base}/row`, {
      cells,
      document: null,
      parse_link_as_link_preview: false,
    });
  });

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
  /** Whether the view is the hidden inline view of a container-backed database. */
  inline: boolean;
  /** The view's row order; read only when asked for (`{ rowIds: true }`). */
  rowIds?: string[];
}

/**
 * The views of a database the browser has open. Before the dashboard test
 * bridge is installed, the database the app exposed last is read instead.
 */
export async function readDatabaseViews(
  page: Page,
  databaseId: string,
  { rowIds = false }: { rowIds?: boolean } = {}
): Promise<DatabaseViewSummary[]> {
  return page.evaluate(
    ({ id, withRowIds }) => {
      const win = window as any;
      const exposed = win.__TEST_DATABASE_CONTEXT__;
      const ctx =
        win.__DASHBOARD_TEST__?.byDatabase(id) ??
        (exposed?.databaseDoc?.getMap('data')?.get('database')?.get('id') === id ? exposed : undefined);
      const views = ctx?.databaseDoc.getMap('data').get('database')?.get('views');
      const result: { id: string; layout: number; name: string; inline: boolean; rowIds?: string[] }[] = [];

      views?.forEach((view: any, viewId: string) => {
        result.push({
          id: viewId,
          layout: Number(view.get('layout') ?? 0),
          name: String(view.get('name') ?? ''),
          inline: Boolean(view.get('is_inline')),
          rowIds: withRowIds ? (view.get('row_orders')?.toJSON() ?? []).map((row: { id: string }) => row.id) : undefined,
        });
      });
      return result;
    },
    { id: databaseId, withRowIds: rowIds }
  );
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

  try {
    await expect
      .poll(
        async () => {
          const [rows, fields] = await Promise.all([
            apiGet<{ id: string }[]>(request, world.owner.accessToken, `${base}/row`),
            apiGet<{ id: string }[]>(request, world.owner.accessToken, `${base}/fields`),
          ]);

          return (
            rows.every((row) => !defaultRowIds.includes(row.id)) &&
            fields.every((field) => !templateFieldIds.includes(field.id))
          );
        },
        { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for "${database.name}" template data removal to sync` }
      )
      .toBe(true);
  } catch (error) {
    // Inspect only after the persistence assertion fails. Do not flush, retry
    // the deletion, or read payloads: a stranded update must remain a failure.
    const diagnostic = await page
      .evaluate(
        async ({ databaseId, workspaceId }) => {
          const win = window as any;
          const bridgeDoc = win.__DASHBOARD_TEST__?.byDatabase(databaseId)?.databaseDoc;
          const currentDoc = win.__TEST_DATABASE_CONTEXT__?.databaseDoc;
          const describe = (doc: any) =>
            doc
              ? {
                  guid: doc.guid,
                  databaseId: doc.getMap('data').get('database')?.get('id'),
                  destroyed: doc.isDestroyed,
                  updateListeners: doc._observers?.get('update')?.size ?? null,
                  databaseRestoreId: doc.databaseRestoreId ?? null,
                }
              : null;
          const result: Record<string, unknown> = {
            databaseId,
            workspaceId,
            bridgeDoc: describe(bridgeDoc),
            currentDoc: describe(currentDoc),
            sameDocument: bridgeDoc === currentDoc,
          };

          try {
            const databases = await indexedDB.databases();
            const cache = databases.find(({ name }) => name === 'af_database_cache');

            if (!cache?.name) return { ...result, nativeIdbError: 'App cache database not present' };
            result.outbox = await new Promise<unknown[]>((resolve, reject) => {
              const open = indexedDB.open(cache.name as string);
              let database: IDBDatabase | undefined;
              let settled = false;
              const timer = window.setTimeout(() => {
                settled = true;
                database?.close();
                reject(new Error('Readonly outbox inspection timed out'));
              }, 3000);
              const fail = (reason: unknown) => {
                settled = true;
                window.clearTimeout(timer);
                database?.close();
                reject(reason);
              };

              open.onerror = () => fail(open.error);
              open.onblocked = () => fail(new Error('Readonly outbox inspection was blocked'));
              open.onupgradeneeded = () => {
                open.transaction?.abort();
                fail(new Error('App cache database disappeared before inspection'));
              };

              open.onsuccess = () => {
                database = open.result;
                if (settled) {
                  database.close();
                  return;
                }

                if (!database.objectStoreNames.contains('sync_outbox')) {
                  fail(new Error('sync_outbox store not present'));
                  return;
                }

                const transaction = database.transaction('sync_outbox', 'readonly');
                const cursor = transaction.objectStore('sync_outbox').openCursor();
                const records: unknown[] = [];

                cursor.onerror = () => fail(cursor.error);
                transaction.onabort = () => fail(transaction.error);
                transaction.onerror = () => fail(transaction.error);
                cursor.onsuccess = () => {
                  const item = cursor.result;

                  if (!item) return;
                  const row = item.value;

                  if (row.workspaceId === workspaceId && row.objectId === databaseId) {
                    records.push({
                      id: row.id,
                      objectId: row.objectId,
                      collabType: row.collabType,
                      version: row.version ?? null,
                      databaseRestoreId: row.databaseRestoreId ?? null,
                      source: row.source ?? 'local',
                      payloadBytes: row.payload?.byteLength ?? null,
                      beforeStateVectorBytes: row.beforeStateVector?.byteLength ?? null,
                      createdAt: row.createdAt,
                    });
                  }

                  item.continue();
                };

                transaction.oncomplete = () => {
                  settled = true;
                  window.clearTimeout(timer);
                  database?.close();
                  resolve(records);
                };
              };
            });
          } catch (idbError) {
            result.nativeIdbError =
              idbError instanceof Error ? { name: idbError.name, message: idbError.message } : String(idbError);
          }

          return result;
        },
        { databaseId: database.databaseId, workspaceId: world.workspaceId }
      )
      .catch((diagnosticError: unknown) => ({
        unavailable: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));

    await test
      .info()
      .attach('fixture-template-prune-sync-failure', {
        body: JSON.stringify(diagnostic, null, 2),
        contentType: 'application/json',
      })
      .catch(() => undefined);
    throw error;
  }
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
const FOLDER_LAYOUT_NAMES: Partial<Record<ViewLayout, string>> = {
  [ViewLayout.Grid]: 'Grid',
  [ViewLayout.Board]: 'Board',
  [ViewLayout.Calendar]: 'Calendar',
  [ViewLayout.Chart]: 'Chart',
  [ViewLayout.List]: 'List',
  [ViewLayout.Gallery]: 'Gallery',
  [ViewLayout.Feed]: 'Feed',
  [ViewLayout.Timeline]: 'Timeline',
  [ViewLayout.Dashboard]: 'Dashboard',
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
        return views.some((view) => view.layout === ViewLayout.Grid);
      },
      { timeout: FIXTURE_TIMEOUT_MS, message: `waiting for "${database.name}" to appear in the workspace database list` }
    )
    .toBe(true);

  for (const view of views) {
    const layoutName = FOLDER_LAYOUT_NAMES[view.layout as ViewLayout];

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
  // Only the databases this scenario names; a scenario that builds its own adds them later.
  await addFixtureDatabases(page, request, names);
  if (names.length > 0) await openDatabasePage(page, names[0]);
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
  await addFixtureDatabases(page, request, [name], customSpec ? { [name]: customSpec } : {});
}

export interface FixtureDatabaseOptions {
  /** Drop the server's template rows and fields through the browser (default). */
  prune?: boolean;
  /** Row requests in flight at once per database; above 1 the rows are not created in table order. */
  rowConcurrency?: number;
}

/**
 * Create fixture databases (`specs[name]`, else `DASHBOARD_FIXTURE_DATABASES`).
 * Their API calls run in parallel; only the template prune, which goes
 * through the browser, visits one database after the other.
 */
export async function addFixtureDatabases(
  page: Page,
  request: APIRequestContext,
  names: string[],
  specs: Record<string, DatabaseSpec> = {},
  options: FixtureDatabaseOptions = {}
) {
  const world = dashboardWorld(page);
  const resolved = names.map((name) => {
    const spec = specs[name] ?? DASHBOARD_FIXTURE_DATABASES[name];

    if (!spec) throw new Error(`Unknown fixture database "${name}"`);
    return { name, spec };
  });

  if (resolved.some(({ spec }) => spec.privateSpace)) {
    world.privateSpaceId ??= await createSpace(
      request,
      world.owner.accessToken,
      world.workspaceId,
      `Owner only ${world.runId}`,
      true
    );
  }

  const created = await Promise.all(
    resolved.map(({ name, spec }) =>
      createFixtureDatabase(
        request,
        world,
        name,
        spec.privateSpace ? (world.privateSpaceId as string) : world.spaceId,
        spec,
        options.rowConcurrency
      )
    )
  );

  for (const { defaultRowIds, ...database } of created) {
    world.databases[database.name] = database;
    if (options.prune === false) continue;
    await page.goto(`/app/${world.workspaceId}/${database.pageId}`, { waitUntil: 'domcontentloaded' });
    await waitForDatabaseContext(page, database.databaseId);
    await pruneTemplateData(page, request, world, world.databases[database.name], defaultRowIds);
  }

  await Promise.all(created.map(({ name }) => refreshKnownViews(request, world, world.databases[name])));
  for (const { name } of created) {
    if (!world.databases[name].views.Grid) throw new Error(`"${name}" did not expose a Grid view`);
  }
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

interface CreatedDatabaseView {
  view_id: string;
  database_update?: number[];
}

export interface DatabaseViewRequest {
  /** The fixture database the view belongs to. */
  database: string;
  name: string;
  /** Folder `ViewLayout` (1 Grid, 2 Board, 3 Calendar, 5 Chart, 6 List, 11 Dashboard, ...). */
  folderLayout: number;
  /** The folder view the new view goes under; the database page by default. */
  parentViewId?: string;
  /** The sibling the new view goes after. */
  prevViewId?: string;
}

/**
 * Create a folder view of a fixture database the way the web's tab bar does,
 * apply the database update the server returns (as the web does), and wait
 * until the browser's database doc lists the view. Returns its id.
 */
export async function createDatabaseViewThroughApi(page: Page, request: APIRequestContext, view: DatabaseViewRequest) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, view.database);
  const parentViewId = view.parentViewId ?? database.pageId;
  const created = await apiPost<CreatedDatabaseView>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/page-view/${parentViewId}/database-view`,
    {
      parent_view_id: parentViewId,
      prev_view_id: view.prevViewId,
      database_id: database.databaseId,
      layout: view.folderLayout,
      name: view.name,
      embedded: false,
    }
  );

  if (created.database_update?.length) {
    await page.evaluate(
      ({ databaseId, update }) => {
        const win = window as any;
        const ctx = win.__DASHBOARD_TEST__.byDatabase(databaseId);

        // Same origin as the web's applyYDoc: a server update is never sent back.
        win.Y.transact(
          ctx.databaseDoc,
          () => win.Y.applyUpdate(ctx.databaseDoc, new Uint8Array(update), 'remote'),
          'remote'
        );
      },
      { databaseId: database.databaseId, update: created.database_update }
    );
  }

  await expect
    .poll(
      async () => (await readDatabaseViews(page, database.databaseId)).some((known) => known.id === created.view_id),
      {
        timeout: FIXTURE_TIMEOUT_MS,
        message: `waiting for the "${view.name}" view to reach the browser`,
      }
    )
    .toBe(true);
  return created.view_id;
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
  /** The mapping order (the first target is primary); current clients always write it. */
  target_order?: string[];
}

export interface PersistedDashboardSetting {
  exists: boolean;
  rows: PersistedRow[];
  global_filters: PersistedGlobalFilter[];
  show_widget_titles?: boolean;
  show_icons_in_heading?: boolean;
}

/** The saved (server-visible) filters and sorts of a database view, as plain objects. */
export async function readViewConditions(
  page: Page,
  viewId: string
): Promise<{ filters: Record<string, unknown>[]; sorts: Record<string, unknown>[] }> {
  const conditions = await page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const ctx = bridge?.byView(id);

    if (!ctx) return null;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(id);

    return {
      filters: bridge.plain(view?.get('filters')) ?? [],
      sorts: bridge.plain(view?.get('sorts')) ?? [],
    };
  }, viewId);

  if (!conditions) throw new Error(`view ${viewId} is not open in the browser`);
  return conditions;
}

/** The dashboard setting as the browser's host database doc holds it. */
export async function readDashboardSetting(
  page: Page,
  viewId = dashboardViewId(page)
): Promise<PersistedDashboardSetting> {
  const setting = await page.evaluate(
    ({ id, layoutKey }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge?.byView(id);

      if (!ctx) return null;
      const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(id);
      const layout = view.get('layout_settings')?.get(layoutKey);

      if (!layout) return { exists: false, rows: [], global_filters: [] };
      return {
        exists: true,
        rows: bridge.plain(layout.get('rows')) ?? [],
        global_filters: bridge.plain(layout.get('global_filters')) ?? [],
        show_widget_titles: layout.get('show_widget_titles'),
        show_icons_in_heading: layout.get('show_icons_in_heading'),
      };
    },
    { id: viewId, layoutKey: DASHBOARD_LAYOUT_KEY }
  );

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
  const viewId = dashboardViewId(page);

  return readServerDatabaseDoc(
    request,
    { token: world.owner.accessToken, workspaceId: world.workspaceId },
    host.databaseId,
    (database): PersistedDashboardSetting => {
      const view = (database?.get('views') as Y.Map<Y.Map<unknown>> | undefined)?.get(viewId);
      const layout = (view?.get('layout_settings') as Y.Map<Y.Map<unknown>> | undefined)?.get(DASHBOARD_LAYOUT_KEY);

      if (!layout) return { exists: false, rows: [], global_filters: [] };
      return {
        exists: true,
        rows: (plainYjs(layout.get('rows')) as PersistedRow[] | undefined) ?? [],
        global_filters: (plainYjs(layout.get('global_filters')) as PersistedGlobalFilter[] | undefined) ?? [],
        show_widget_titles: layout.get('show_widget_titles') as boolean | undefined,
      };
    }
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
    ({ viewId, patch, layoutKey }) => {
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

        let setting = layouts.get(layoutKey);

        if (!setting) {
          setting = new Yjs.Map();
          layouts.set(layoutKey, setting);
        }

        if (patch.rows) setting.set('rows', patch.rows);
        if (patch.global_filters) setting.set('global_filters', patch.global_filters);
      });
    },
    { viewId: dashboardViewId(page), patch, layoutKey: DASHBOARD_LAYOUT_KEY }
  );
}

/** Row index (0-based) → labels, as a Given table lists them. */
export async function seedDashboardWidgets(page: Page, layout: { row: number; label: string }[]) {
  const world = dashboardWorld(page);
  const rowsByIndex = new Map<number, PersistedWidget[]>();

  for (const { row, label } of layout) {
    const widget: PersistedWidget = {
      id: `w-${uuidv4().slice(0, 12)}`,
      view_id: viewIdForLabel(page, label),
      database_id: fixtureDatabase(page, databaseForLabel(page, label)).databaseId,
      width: 0,
    };

    world.widgets[label] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
    rowsByIndex.set(row, [...(rowsByIndex.get(row) ?? []), widget]);
  }

  const rows: PersistedRow[] = [...rowsByIndex.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const widgets = rowsByIndex.get(index) ?? [];
      const widths = equalRowWidths(widgets.length);

      return {
        id: `r-${uuidv4().slice(0, 12)}`,
        height: DASHBOARD_DEFAULT_ROW_HEIGHT,
        widgets: widgets.map((widget, position) => ({ ...widget, width: widths[position] })),
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

/** The dashboard shows `count` widgets and saves as many. */
export async function expectWidgetCount(page: Page, count: number) {
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, { timeout: WIDGET_TIMEOUT_MS });
  await expect.poll(async () => allWidgets(await readDashboardSetting(page)).length).toBe(count);
}

/** Row `oneBasedIndex` saves these widths. */
export async function expectRowWidths(page: Page, oneBasedIndex: number, widths: number[]) {
  await expect
    .poll(async () => (await readDashboardSetting(page)).rows[oneBasedIndex - 1]?.widgets.map((widget) => widget.width))
    .toEqual(widths);
}

/**
 * Row `oneBasedIndex` saves a height within `storedTolerance` of `height`,
 * and its first widget box renders within `renderedTolerance` of the saved height.
 */
export async function expectRowHeight(
  page: Page,
  oneBasedIndex: number,
  height: number,
  { storedTolerance = 0, renderedTolerance = 1 }: { storedTolerance?: number; renderedTolerance?: number } = {}
) {
  await expect
    .poll(async () => Math.abs(((await readDashboardSetting(page)).rows[oneBasedIndex - 1]?.height ?? 0) - height))
    .toBeLessThanOrEqual(storedTolerance);
  const row = await persistedRow(page, oneBasedIndex);
  const widget = DashboardSelectors.row(page, row.id).getByTestId('dashboard-widget').first();

  await expect(widget).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await expect
    .poll(async () => Math.abs(((await widget.boundingBox())?.height ?? 0) - row.height))
    .toBeLessThanOrEqual(renderedTolerance);
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

/**
 * Widgets are dragged by their header band in Edit mode. Grab the empty part
 * of the band, between the title pill and the tools: a drag that starts on
 * the pill (a button) is not a native drag in every browser.
 */
async function widgetGrip(page: Page, widget: Locator) {
  const header = widget.getByTestId('dashboard-widget-header');

  await widget.hover();
  const box = await header.boundingBox();

  if (!box) throw new Error('Widget header is not visible');
  const pill = await header.getByTestId('dashboard-widget-title-button').boundingBox();
  const tools = await header.getByTestId('database-actions').boundingBox();
  const start = pill ? pill.x + pill.width : box.x + Math.min(24, box.width / 4);
  const end = tools ? tools.x : box.x + box.width;

  return { x: start + (end - start) / 2, y: box.y + box.height / 2 };
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

/**
 * One column of a row of `count` widgets in px: the track (the row plus the
 * 6px bleed on both sides) without its gaps, over 12 (WP02).
 */
export async function rowColumnPitch(page: Page, rowId: string, count: number) {
  const box = await DashboardSelectors.row(page, rowId).boundingBox();

  if (!box) throw new Error(`Dashboard row ${rowId} is not visible`);
  return (box.width + 2 * DASHBOARD_BOX_INSET - (count - 1) * DASHBOARD_COLUMN_GAP) / DASHBOARD_GRID_COLUMNS;
}

/**
 * Drag width handle `handle` (1-based: between widget N and widget N + 1) of
 * row `oneBasedIndex` by `columns` grid columns.
 */
export async function dragWidthHandle(page: Page, oneBasedIndex: number, handle: number, columns: number) {
  const row = await persistedRow(page, oneBasedIndex);
  const pitch = await rowColumnPitch(page, row.id, row.widgets.length);

  await DashboardSelectors.row(page, row.id).hover();
  // `data-index` is 0-based.
  await dragLocatorBy(page, DashboardSelectors.widthHandle(page, row.id, handle - 1), columns * pitch, 0);
}

/** The dashboard's row track width, as the grid measured it (`null` while unmeasured). */
async function trackWidth(page: Page) {
  const value = await DashboardSelectors.grid(page).getAttribute('data-track-width');

  return value ? Number(value) : null;
}

/**
 * The track width once it has held still for `quietMs`. A resize across the
 * sidebar's breakpoint (a viewport of 768 px plus the sidebar) opens or
 * closes the sidebar after the resize, which animates for 200 ms and moves
 * the track again after its first measure.
 */
async function settledTrackWidth(page: Page, quietMs = 600) {
  let last = await trackWidth(page);
  let since = Date.now();

  await expect
    .poll(
      async () => {
        const value = await trackWidth(page);

        if (value !== last) {
          last = value;
          since = Date.now();
        }

        return Date.now() - since >= quietMs;
      },
      { intervals: [50], timeout: WIDGET_TIMEOUT_MS }
    )
    .toBe(true);
  return last;
}

/**
 * Resize the viewport until the dashboard's row tracks are `width` px wide
 * (±0.5) and stay so. The loop absorbs the sidebar and the small-screen page
 * padding.
 */
export async function setDashboardTrackWidth(page: Page, width: number) {
  await expect(DashboardSelectors.grid(page)).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await settledTrackWidth(page);

    if (current !== null && Math.abs(current - width) < 0.5) return;
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
    const next = Math.round(viewport.width + width - (current ?? viewport.width));

    await page.setViewportSize({ width: next, height: viewport.height });
    await expect.poll(() => trackWidth(page)).not.toBe(current);
  }

  expect(await settledTrackWidth(page)).toBeCloseTo(width, 0);
}

export interface WidgetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The widget boxes of a row, in order. */
export async function widgetBoxes(page: Page, rowId: string): Promise<WidgetBox[]> {
  return DashboardSelectors.row(page, rowId)
    .getByTestId('dashboard-widget')
    .evaluateAll((widgets) =>
      widgets.map((widget) => {
        const rect = widget.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })
    );
}

/** The widget boxes of a row grouped into lines by their top edge (±2px). */
export async function rowLineBoxes(page: Page, rowId: string): Promise<WidgetBox[][]> {
  const lines: WidgetBox[][] = [];

  for (const box of await widgetBoxes(page, rowId)) {
    const line = lines[lines.length - 1];

    if (line && Math.abs(line[0].y - box.y) <= 2) line.push(box);
    else lines.push([box]);
  }

  return lines;
}

/** The widgets of a row grouped into lines by their top edge (±2px): the line sizes. */
export async function rowLines(page: Page, rowId: string): Promise<number[]> {
  return (await rowLineBoxes(page, rowId)).map((line) => line.length);
}

/** Every widget box, keyed by widget id, relative to the dashboard grid (immune to page scroll). */
export async function widgetRectsRelativeToGrid(page: Page): Promise<Record<string, WidgetBox>> {
  return DashboardSelectors.grid(page).evaluate((grid) => {
    const origin = grid.getBoundingClientRect();
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};

    grid.querySelectorAll<HTMLElement>('[data-testid="dashboard-widget"]').forEach((widget) => {
      const rect = widget.getBoundingClientRect();

      rects[widget.dataset.widgetId ?? ''] = {
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        width: rect.width,
        height: rect.height,
      };
    });
    return rects;
  });
}

// ---------------------------------------------------------------------------
// Widget UI
// ---------------------------------------------------------------------------

/**
 * Open a widget's menu from its title pill, or, with widget titles hidden,
 * from the "Widget options" button of its floating capsule (shown on hover).
 */
export async function openWidgetMenu(page: Page, widget: Locator) {
  await expect(widget).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  // A loading widget swaps its header for the loaded view's header: a menu
  // opened on the loading header can close in that swap.
  await expect(widget.locator('[data-testid="dashboard-widget-placeholder"][data-reason="loading"]')).toHaveCount(0, {
    timeout: WIDGET_TIMEOUT_MS,
  });
  const title = widget.getByTestId('dashboard-widget-title-button');

  if ((await title.count()) > 0) {
    await title.click();
  } else {
    await widget.hover();
    const options = widget.getByTestId('dashboard-widget-options-button');

    await expect(options).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    await options.click();
  }

  await expect(DashboardSelectors.widgetMenu(page)).toBeVisible();
}

export async function chooseWidgetMenuAction(page: Page, widget: Locator, action: WidgetMenuAction) {
  await openWidgetMenu(page, widget);
  if (action === 'create-row-above' || action === 'create-row-below') {
    // The new-row entries live in the "Move to row" submenu, which opens on hover.
    await DashboardSelectors.widgetMenuItem(page, 'move-to-row').hover();
    await expect(page.getByTestId('dashboard-widget-menu-move-to-row-content')).toBeVisible();
  }

  await DashboardSelectors.widgetMenuItem(page, action).click();
}

const pickerWidgets = new WeakMap<Page, { widgetId: string; hostViewIds: string[] }>();

/**
 * The widget the last `openWidgetPicker` added (WP06 §1.1: a "+" inserts a
 * default widget and docks the picker beside it), and the host database's
 * views before it.
 */
export function lastPickerWidget(page: Page): { widgetId: string; hostViewIds: string[] } {
  const entry = pickerWidgets.get(page);

  if (!entry) throw new Error('No widget was added through the picker in this scenario');
  return entry;
}

/**
 * Start an add (WP06): the empty dashboard's "+ New view" pill, else the
 * visible "Add to new row" button, or `trigger`. Waits until the default
 * widget is persisted (one more widget) and the docked picker is ready, then
 * remembers the new widget's id and the host's views before the add.
 */
export async function openWidgetPicker(page: Page, trigger?: Locator) {
  const emptyPill = DashboardSelectors.emptyNewViewButton(page);
  const button =
    trigger ??
    ((await emptyPill.isVisible())
      ? emptyPill
      : DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first());
  const widgetCountBefore = allWidgets(await readDashboardSetting(page)).length;
  const hostViewIds = (await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id);
  const world = dashboardWorld(page);
  const picker = DashboardSelectors.picker(page);

  world.viewCountBefore = hostViewIds.length;
  await expect(button).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await button.click();
  await expect(picker).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await expect(picker).toHaveAttribute('data-state', 'ready', { timeout: WIDGET_TIMEOUT_MS });
  await expect
    .poll(async () => allWidgets(await readDashboardSetting(page)).length, { timeout: WIDGET_TIMEOUT_MS })
    .toBe(widgetCountBefore + 1);
  const widgetId = (await picker.getAttribute('data-widget-id')) ?? '';

  expect(widgetId, 'the picker names the widget it was opened for').not.toBe('');
  pickerWidgets.set(page, { widgetId, hostViewIds });
  return widgetId;
}

/**
 * Pick an existing view in the open picker: searched for, or revealed with
 * "Show n more" / "Other data sources" when it is not listed. In the add
 * flow the picker's widget swaps to the view; in the Source panel (replace
 * mode) the widget it belongs to does.
 */
export async function pickExistingView(page: Page, viewId: string, search?: string) {
  const picker = DashboardSelectors.picker(page);
  const option = DashboardSelectors.pickerOption(page, viewId);
  const replace = (await picker.getAttribute('data-mode')) === 'replace';
  const widgetId = replace ? null : await picker.getAttribute('data-widget-id');

  if (search !== undefined) await DashboardSelectors.pickerSearch(page).fill(search);
  if (!(await option.isVisible())) {
    if (await DashboardSelectors.pickerOtherSources(page).isVisible())
      await DashboardSelectors.pickerOtherSources(page).click();
    for (const more of await DashboardSelectors.pickerShowMore(page).all()) {
      if (await option.isVisible()) break;
      if (await more.isVisible()) await more.click();
    }
  }

  await expect(option).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  await option.click();
  await expect(picker).toBeHidden({ timeout: WIDGET_TIMEOUT_MS });
  if (widgetId) {
    await expect(DashboardSelectors.widget(page, widgetId)).toHaveAttribute('data-view-id', viewId, {
      timeout: WIDGET_TIMEOUT_MS,
    });
    await expect
      .poll(async () => allWidgets(await readDashboardSetting(page)).find((widget) => widget.id === widgetId)?.view_id, {
        timeout: WIDGET_TIMEOUT_MS,
      })
      .toBe(viewId);
  }
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
    // Editing a later property can leave the Name column virtualized away.
    // Scroll this grid back to that column before looking for its row action.
    await widget.locator('[data-parity-id="dash-widget-grid-scrollbar"]').evaluate((element) => {
      element.scrollLeft = 0;
    });
    // Wide virtual rows extend beyond the clipped widget. Hover the primary
    // cell, whose row-specific action opens this exact record.
    await row.locator('.grid-row-cell[data-is-primary="true"]').hover();
    const expand = row.getByTestId('row-expand-button');

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

/** The chart settings panel of the open chart page (gear → Chart settings ›), showing the chart types. */
async function openNumberChartSettingsMenu(page: Page) {
  await openChartPagePanel(page);
  await expect(page.getByTestId('chart-type-number')).toBeVisible({ timeout: 10_000 });
}

export interface ChartLayoutSnapshot {
  chartType: number;
  aggregationType: number;
  yFieldId?: string;
}

/** Reads collab's snake_case chart keys, the ones desktop and the server decode. */
export async function readChartSetting(page: Page, viewId: string): Promise<ChartLayoutSnapshot | null> {
  return page.evaluate(
    ({ id, layoutKey }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const view = bridge?.byView(id)?.databaseDoc.getMap('data').get('database').get('views').get(id);
      const setting = view?.get('layout_settings')?.get(layoutKey);

      if (!setting) return null;
      return {
        chartType: Number(setting.get('chart_type') ?? 0),
        aggregationType: Number(setting.get('aggregation_type') ?? 0),
        yFieldId: setting.get('y_field_id') ? String(setting.get('y_field_id')) : undefined,
      };
    },
    { id: viewId, layoutKey: CHART_LAYOUT_KEY }
  );
}

/** Calculation labels → `aggregation_type` (WP11: every value 0–16; "Count" is Count all). */
export const AGGREGATION_BY_NAME: Record<string, number> = CHART_AGGREGATION_BY_NAME;

/**
 * Turn a chart view into a Number chart through its settings panel: the
 * property first ("What to show"), then the calculation. A calculation other
 * than Count needs its property. Verified against the view's persisted chart
 * layout setting.
 */
export async function configureNumberChart(page: Page, databaseName: string, aggregation = 'Count', property?: string) {
  const database = fixtureDatabase(page, databaseName);
  const viewId = database.views.Chart;

  if (!viewId) throw new Error(`"${databaseName}" has no Chart view`);
  const aggregationType = AGGREGATION_BY_NAME[aggregation];

  if (aggregationType === undefined) throw new Error(`Unknown number chart aggregation "${aggregation}"`);
  if (aggregationType !== AGGREGATION_BY_NAME.Count && !property) {
    throw new Error(`The "${aggregation}" calculation needs a property`);
  }

  await openDatabasePage(page, databaseName, viewId);
  await openNumberChartSettingsMenu(page);
  await page.getByTestId('chart-type-number').click();
  await expect.poll(async () => (await readChartSetting(page, viewId))?.chartType).toBe(4);

  if (property) {
    const fieldId = database.fieldIds[property];

    if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
    await openChartPanelRow(page, 'y_what');
    await page.getByTestId(`chart-field-${fieldId}`).click();
    await expect.poll(async () => (await readChartSetting(page, viewId))?.yFieldId).toBe(fieldId);
  }

  if (aggregationType !== AGGREGATION_BY_NAME.Count) {
    await chooseChartCalculation(page, aggregationType);
    await expect.poll(async () => (await readChartSetting(page, viewId))?.aggregationType).toBe(aggregationType);
  }

  await closeChartPanel(page);
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

/**
 * Close the open global filter popover (the pill editor has no Done button):
 * Escape, once per open layer (a condition dropdown first). Debounced inputs
 * flush as the editor unmounts.
 */
export async function closeGlobalFilterMenu(scope: Page) {
  const menu = DashboardSelectors.globalFilterMenu(scope);

  await pressEscapeUntilHidden(scope, menu);
}

/**
 * Add a global filter the way a writer does (WP08 §1.3–1.4). One source:
 * pick its property in the toolbar menu. More: "Filter multiple sources",
 * "Add to filter", the first property, "Add another" for each other source,
 * then Done. Either way the new pill's editor opens, and the filter is named
 * after the first property. `typeName` (a type name or a `FieldType`) is kept
 * for the steps and checked against the saved filter. Fixture identities
 * belong to `owner`; the UI to `page`. Returns the new filter's id.
 */
export async function addGlobalFilter(
  page: Page,
  typeName: string | FieldType,
  mapping: Record<string, string>,
  owner: Page = page
): Promise<string> {
  const fieldType = typeof typeName === 'number' ? typeName : FIELD_TYPE_BY_NAME[typeName];
  const pairs = Object.entries(mapping);

  if (fieldType === undefined) throw new Error(`Unknown property type "${typeName}"`);
  if (pairs.length === 0) throw new Error('A global filter needs at least one source');
  // The search shows every match (a group lists 5 properties otherwise). The
  // primary property has no fixture id: its row is matched by name.
  const pick = async ([database, property]: [string, string]) => {
    const search = DashboardSelectors.globalFilterSearch(page);

    await search.fill(property);
    await expect(search).toHaveValue(property);
    const fixture = fixtureDatabase(owner, database);
    const fieldId = fixture.fieldIds[property];
    const rows = page.locator(
      `[data-testid="dashboard-global-filter-field-option"][data-database-id="${fixture.databaseId}"]`
    );
    const row = fieldId
      ? rows.and(page.locator(`[data-field-id="${fieldId}"]`))
      : rows.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(property)}\\s*$`) }).first();

    await expect(row, `the filter menu offers no "${property}" in "${database}"`).toBeVisible({
      timeout: WIDGET_TIMEOUT_MS,
    });
    await row.click();
  };

  await openGlobalFilterMenu(page);
  if (pairs.length === 1) {
    await pick(pairs[0]);
  } else {
    await DashboardSelectors.globalFilterMultipleSources(page).click();
    await DashboardSelectors.globalFilterAddToFilter(page).click();
    await pick(pairs[0]);
    await expect(DashboardSelectors.globalFilterBuilder(page)).toBeVisible();
    for (const pair of pairs.slice(1)) {
      await DashboardSelectors.globalFilterAddAnother(page).click();
      await pick(pair);
      await expect(
        DashboardSelectors.globalFilterTarget(page, fixtureDatabase(owner, pair[0]).databaseId)
      ).toBeVisible();
    }

    await DashboardSelectors.globalFilterDone(page).click();
  }

  const editor = DashboardSelectors.globalFilterPillEditor(page);

  await expect(editor).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
  const filterId = (await editor.getAttribute('data-filter-id')) ?? '';
  const expectedTargets = Object.fromEntries(
    pairs.map(([database]) => [fixtureDatabase(owner, database).databaseId, expect.any(String)])
  );

  // Adding is a shared write in either mode: the saved filter has the type and exactly these sources.
  await expect
    .poll(async () => {
      const saved = (await readDashboardSetting(page, dashboardViewId(owner))).global_filters.find(
        (filter) => filter.id === filterId
      );

      return saved ? { ty: saved.ty, targets: saved.targets } : null;
    })
    .toEqual({ ty: fieldType, targets: expectedTargets });
  return filterId;
}

/** Open the multiple sources builder of the open pill (through `···`), unless it shows already. */
async function openGlobalFilterBuilderFromPill(page: Page) {
  const builder = DashboardSelectors.globalFilterBuilder(page);

  if (await builder.isVisible()) return builder;
  await DashboardSelectors.globalFilterMoreActions(page).click();
  await DashboardSelectors.globalFilterOpenBuilder(page).click();
  await expect(builder).toBeVisible();
  return builder;
}

/** Rename the open filter in its builder, only when the name differs. */
export async function renameGlobalFilter(page: Page, name: string) {
  const builder = await openGlobalFilterBuilderFromPill(page);
  const input = DashboardSelectors.globalFilterName(page);
  const filterId = await builder.getAttribute('data-filter-id');

  if ((await input.inputValue()) === name) return;
  await input.fill(name);
  await expect(input).toHaveValue(name);
  // The name input is debounced; wait for the saved value.
  await expect
    .poll(async () => (await readDashboardSetting(page)).global_filters.find((filter) => filter.id === filterId)?.name)
    .toBe(name);
}

/**
 * Stop the open filter from applying to `databaseId`: `···` → "Filter
 * multiple sources", remove the source in the builder, then Done (back to the
 * pill's editor).
 */
export async function removeGlobalFilterTarget(page: Page, databaseId: string) {
  await openGlobalFilterBuilderFromPill(page);
  const target = DashboardSelectors.globalFilterTarget(page, databaseId);

  await target.getByTestId('dashboard-global-filter-target-remove').click();
  await expect(target).toHaveCount(0);
  await DashboardSelectors.globalFilterDone(page).click();
  await expect(DashboardSelectors.globalFilterPillEditor(page)).toBeVisible();
}

/**
 * Pick a condition in the open global filter editor (a no-op when it is
 * already chosen), then check the editor shows it. `ignoreCase: false` holds
 * the label to its exact case as well.
 */
export async function chooseGlobalFilterCondition(scope: Page, label: string, { ignoreCase = true } = {}) {
  const trigger = DashboardSelectors.globalFilterCondition(scope);
  const exactly = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, ignoreCase ? 'i' : '');

  if (exactly.test((await trigger.textContent()) ?? '')) return;
  await trigger.click();
  await scope
    .getByTestId('dashboard-global-filter-condition-option')
    .filter({ hasText: exactly, visible: true })
    .first()
    .click();
  await expect(trigger).toHaveText(exactly);
}

export async function fillGlobalFilterText(scope: Page, text: string) {
  const content = DashboardSelectors.globalFilterContent(scope);
  const tag = await content.evaluate((element) => element.tagName);
  const input = tag === 'INPUT' || tag === 'TEXTAREA' ? content : content.locator('input, textarea').first();

  await input.fill(text);
  await expect(input).toHaveValue(text);
}

/** Toggle the select option `optionId` in the open global filter editor and wait for its new state. */
export async function toggleGlobalFilterOptionById(scope: Page, optionId: string) {
  const option = DashboardSelectors.globalFilterContent(scope).locator(
    `[data-testid="dashboard-global-filter-option"][data-option-id="${optionId}"]`
  );
  const checked = (await option.getAttribute('data-checked')) === 'true';

  await option.click();
  await expect(option).toHaveAttribute('data-checked', checked ? 'false' : 'true');
}

/** Toggle a status option in the open filter editor (fixture options share ids across databases). */
export async function toggleGlobalFilterOption(scope: Page, optionName: string) {
  await toggleGlobalFilterOptionById(scope, statusOptionId(optionName));
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
  // `targets` is a JSON map whose key order Yrs does not keep, so a current
  // client writes the mapping order next to it, as this seed does.
  return {
    id: `gf-${uuidv4().slice(0, 12)}`,
    name,
    ty: fieldType,
    condition,
    content,
    targets,
    target_order: Object.keys(targets),
  };
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
