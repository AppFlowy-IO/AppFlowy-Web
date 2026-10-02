/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values written inside page.evaluate are untyped. */
/**
 * Web visual parity probe (VISUAL-PARITY.md §3, §6 L2/L4): seeds the
 * canonical parity dashboard, builds each scene of `visual-metrics.json` on
 * it, measures every in-scope element, order, text and icon check in one
 * View/Edit × light/dark state, resolves the expected values from
 * `tokens.json`, and writes `web-<state>.json` (schema
 * `appflowy.dashboard-parity.visual-probe` v1, §6.1.3, read by
 * `scripts/dashboard-parity/compare-visual-parity.mjs`), the canonical
 * capture `web-<state>.png` and one capture per scene × interaction in
 * `shots/`.
 *
 * Run options (shared with the desktop probe, §6):
 * - `DASHBOARD_PARITY_MODE=report|enforce` (default `report`): report mode also
 *   measures `pending` entries; enforce mode measures `enforced` ones (and
 *   strict in-scope ones) only.
 * - `DASHBOARD_PARITY_STRICT=1` with `DASHBOARD_PARITY_WAVE=N`: pending entries
 *   with `wave ≤ N` fail too.
 * - `DASHBOARD_PARITY_REPORT=<dir>`: where the probe files and captures go
 *   (default `test-results/dashboard-parity`).
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';

import { FieldType } from '../../src/application/database-yjs/database.type';
import { Types } from '../../src/application/types';
import {
  appliesToPattern,
  compareValues,
  defaultScene,
  elementEntryFor,
  expandChecks,
  IconEntry,
  IconsFixture,
  isBlocking,
  isInScope,
  knownParityIds,
  measuredDependencies,
  measuredMetricNames,
  MetricCheck,
  multiplyAlpha,
  normalizeColor,
  OrderCheck,
  orderFamily,
  ParityReportRow,
  ParityStateId,
  parseParityState,
  ProbeBox,
  resolveExpected,
  RunOptions,
  runOptionsFromEnv,
  TextCheck,
  TokensFixture,
  VisualMetricsFixture,
} from '../../src/application/database-yjs/visual-parity';

import { renameDatabaseView } from './dashboard-owned-views-helpers';
import { mergeRawLayout } from './dashboard-parity-helpers';
import {
  addDashboardView,
  addFixtureDatabase,
  addViewThroughTabs,
  apiGet,
  buildGlobalFilter,
  closeGlobalFilterMenu,
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  DatabaseSpec,
  enterEditMode,
  fixtureDatabase,
  inviteDashboardMember,
  leaveEditMode,
  openDashboardAsMember,
  openDatabasePage,
  openGlobalFilterChip,
  PersistedGlobalFilter,
  PersistedRow,
  prepareDashboardFixture,
  readChartSetting,
  selectGlobalFilter,
  statusOptionId,
  toggleGlobalFilterOption,
} from './dashboard-test-helpers';
import { GlyphIdentity, IconRuntimeIndex } from './dashboard-visual-parity-icons';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from './page-utils';
import {
  callParityProbe,
  GlyphInstance,
  PARITY_FALLBACK_SELECTORS,
  prepareParityProbe,
  ProbeRequest,
  ProbeResult,
  ScopeSpec,
} from './dashboard-visual-parity-measure';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_DIR = join(REPO_ROOT, 'src/application/database-yjs/__fixtures__/dashboard-parity');
const PROBE_SCHEMA = 'appflowy.dashboard-parity.visual-probe';

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

interface Contract {
  metrics: VisualMetricsFixture;
  icons: IconsFixture;
  tokens: TokensFixture;
  known: string[];
  /** sha256 of the bytes of FIXTURES.sha256: the contract version a probe file records. */
  fixturesSha256: string;
}

let contractCache: Contract | null = null;
let iconIndex: IconRuntimeIndex | null = null;

export function parityContract(): Contract {
  if (contractCache) return contractCache;
  const metrics = readJson<VisualMetricsFixture>('visual-metrics.json');
  const icons = readJson<IconsFixture>('icons.json');

  contractCache = {
    metrics,
    icons,
    tokens: readJson<TokensFixture>('tokens.json'),
    known: knownParityIds(metrics, icons),
    fixturesSha256: createHash('sha256')
      .update(readFileSync(join(FIXTURE_DIR, 'FIXTURES.sha256')))
      .digest('hex'),
  };
  return contractCache;
}

function icons(): IconRuntimeIndex {
  iconIndex ??= new IconRuntimeIndex(parityContract().icons);
  return iconIndex;
}

/** `DASHBOARD_PARITY_REPORT` (VISUAL-PARITY.md §6), default `test-results/dashboard-parity`. */
export function parityReportDir(): string {
  const configured = process.env.DASHBOARD_PARITY_REPORT ?? process.env.DASHBOARD_PARITY_REPORT_DIR;

  return resolve(configured ?? join(REPO_ROOT, 'test-results/dashboard-parity'));
}

/** `View` / `Edit` and `light` / `dark` as the Gherkin writes them → a state id. */
export function parityStateFromWords(mode: string, theme: string): ParityStateId {
  const m = mode.toLowerCase();
  const t = theme.toLowerCase();

  if (!['view', 'edit'].includes(m) || !['light', 'dark'].includes(t)) {
    throw new Error(`Unknown parity state "${mode}" mode / "${theme}" theme`);
  }

  return `${m}-${t}` as ParityStateId;
}

// ---------------------------------------------------------------------------
// Canonical fixture
// ---------------------------------------------------------------------------

/** Widget labels → their view; every scene picks from these. */
interface ParityWorld {
  views: Record<string, { viewId: string; databaseId: string; layout: 'grid' | 'board' | 'chart' }>;
  /** The saved filter on the "Tasks Grid" view (the filtered-grid shape). */
  savedFilterId: string;
  memberReady?: boolean;
  currentScene?: string;
}

const parityWorlds = new WeakMap<Page, ParityWorld>();

function parityWorld(page: Page): ParityWorld {
  const world = parityWorlds.get(page);

  if (!world) throw new Error('The canonical dashboard visual parity fixture has not been seeded');
  return world;
}

const CHART_TYPES: Record<string, number> = { Bar: 0, Line: 1, Donut: 3, Number: 4 };

/** The canonical dashboard (the `web-<state>.png` capture): host and foreign grids, a board, four charts, an empty chart. */
const CANONICAL_ROWS = [
  ['Projects Grid', 'Projects Board'],
  ['Tasks Grid'],
  ['Projects Bar', 'Projects Donut', 'Projects Number'],
  ['Projects Line', 'Backlog Chart'],
];

function widgetIdFor(label: string) {
  return `pw-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Collab's snake_case chart keys, the ones desktop and the server decode (as
 * `dashboard-usecase-helpers.ts` writes them). A new chart view writes its
 * defaults once it renders, so the setting is written after the chart is on
 * screen and written again until it persists.
 */
async function setChartLayout(
  page: Page,
  viewId: string,
  chart: { chartType: number; xFieldId: string; showEmptyValues?: boolean }
) {
  const rendered = page.locator(
    '.recharts-wrapper, [data-testid="number-chart-value"], [data-parity-id="dash-chart-empty"]'
  );

  await expect(rendered.first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const current = await readChartSetting(page, viewId);

        if (current?.chartType === chart.chartType) return true;
        await mergeRawLayout(page, viewId, '3', {
          chart_type: chart.chartType,
          x_field_id: chart.xFieldId,
          aggregation_type: 0,
          show_empty_values: chart.showEmptyValues ?? true,
        });
        return false;
      },
      { timeout: 20_000, intervals: [300, 600, 1_000] }
    )
    .toBe(true);
}

/** Backlog for the parity fixture: a groupable property and no rows, so its chart shows the no-data state. */
const PARITY_BACKLOG: DatabaseSpec = {
  fields: [
    { name: 'Status', type: FieldType.SingleSelect },
    { name: 'Points', type: FieldType.Number },
  ],
  rows: [],
};

/** A saved "Stage is Doing" filter on a view (written to the open source database doc). */
async function addSavedSelectFilter(page: Page, viewId: string, fieldId: string, optionId: string) {
  const filterId = `pf-${Date.now().toString(36)}`;

  await page.evaluate(
    ({ viewId, fieldId, optionId, filterId, fieldType }) => {
      const win = window as any;
      const ctx = win.__DASHBOARD_TEST__?.byView(viewId);

      if (!ctx) throw new Error(`No mounted database doc holds view ${viewId}`);
      const Yjs = win.Y;
      const doc = ctx.databaseDoc;
      const view = doc.getMap('data').get('database').get('views').get(viewId);

      doc.transact(() => {
        let filters = view.get('filters');

        if (!filters) {
          filters = new Yjs.Array();
          view.set('filters', filters);
        }

        const filter = new Yjs.Map();

        filter.set('id', filterId);
        filter.set('field_id', fieldId);
        filter.set('condition', 0);
        filter.set('content', optionId);
        filter.set('ty', fieldType);
        filter.set('filter_type', 2);
        filters.push([filter]);
      });
    },
    { viewId, fieldId, optionId, filterId, fieldType: FieldType.SingleSelect }
  );
  return filterId;
}

/** Wait until the server holds the saved filter: the next step leaves the page, and an unsent update would be lost. */
async function waitForSavedFilterOnServer(
  page: Page,
  request: APIRequestContext,
  databaseId: string,
  viewId: string,
  filterId: string
) {
  const world = dashboardWorld(page);

  await expect
    .poll(
      async () => {
        const collab = await apiGet<{ doc_state: number[] }>(
          request,
          world.owner.accessToken,
          `/api/workspace/v1/${world.workspaceId}/collab/${databaseId}?collab_type=${Types.Database}`
        ).catch(() => null);

        if (!collab) return false;
        const doc = new Y.Doc({ guid: databaseId });

        try {
          Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
          const database = doc.getMap('data').get('database') as Y.Map<unknown> | undefined;
          const views = database?.get('views') as Y.Map<Y.Map<unknown>> | undefined;
          const filters = views?.get(viewId)?.get('filters');

          return filters instanceof Y.Array && filters.toJSON().some((filter: { id?: string }) => filter.id === filterId);
        } finally {
          doc.destroy();
        }
      },
      { timeout: 30_000, message: 'waiting for the saved Tasks filter to reach the server' }
    )
    .toBe(true);
}

/**
 * Seed the canonical parity dashboard: Projects (Grid, Board and Bar, Line,
 * Donut, Number charts grouped by Status), Tasks (Grid, with a saved filter),
 * Notes (Grid), Backlog (an empty Chart), and a dashboard on Projects holding
 * a host grid, a foreign grid, the four charts, a board, an empty chart and a
 * saved global filter. It opens in View mode.
 */
export async function seedCanonicalParityDashboard(page: Page, request: APIRequestContext) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepareDashboardFixture(page, request, ['Projects', 'Tasks', 'Notes']);
  await addFixtureDatabase(page, request, 'Backlog', PARITY_BACKLOG);
  const world = dashboardWorld(page);
  const projects = fixtureDatabase(page, 'Projects');
  const views: ParityWorld['views'] = {};
  const named: NonNullable<typeof world.viewsByName> = {};

  const remember = (label: string, database: string, viewId: string, layout: 'grid' | 'board' | 'chart') => {
    views[label] = { viewId, databaseId: fixtureDatabase(page, database).databaseId, layout };
    named[label] = { viewId, database };
  };

  for (const database of ['Projects', 'Tasks', 'Notes']) {
    remember(`${database} Grid`, database, fixtureDatabase(page, database).views.Grid, 'grid');
  }

  remember('Projects Board', 'Projects', await addViewThroughTabs(page, 'Projects', 'Board'), 'board');
  for (const [name, chartType] of Object.entries(CHART_TYPES)) {
    const viewId = await addViewThroughTabs(page, 'Projects', 'Chart');

    await setChartLayout(page, viewId, { chartType, xFieldId: projects.fieldIds.Status });
    // Named after its chart type, as the desktop fixture names it (the widget title is the view name).
    await renameDatabaseView(page, request, 'Projects', viewId, name);
    remember(`Projects ${name}`, 'Projects', viewId, 'chart');
  }

  const backlogChart = await addViewThroughTabs(page, 'Backlog', 'Chart');

  await setChartLayout(page, backlogChart, {
    chartType: CHART_TYPES.Bar,
    xFieldId: fixtureDatabase(page, 'Backlog').fieldIds.Status,
    showEmptyValues: false,
  });
  remember('Backlog Chart', 'Backlog', backlogChart, 'chart');
  world.viewsByName = { ...(world.viewsByName ?? {}), ...named };

  // The user report shape: the foreign grid carries one saved filter.
  const tasks = fixtureDatabase(page, 'Tasks');

  await openDatabasePage(page, 'Tasks');
  const savedFilterId = await addSavedSelectFilter(page, tasks.views.Grid, tasks.fieldIds.Stage, statusOptionId('Doing'));

  await waitForSavedFilterOnServer(page, request, tasks.databaseId, tasks.views.Grid, savedFilterId);

  parityWorlds.set(page, { views, savedFilterId });
  await addDashboardView(page, 'Projects');
  await applyLayout(page, { rows: CANONICAL_ROWS, globalFilters: [statusGlobalFilter(page)] });
  await leaveEditMode(page);
  parityWorld(page).currentScene = 'canonical';
}

function statusGlobalFilter(page: Page) {
  return selectGlobalFilter(page, 'Status', ['Doing'], { Projects: 'Status', Tasks: 'Stage' });
}

// ---------------------------------------------------------------------------
// Scenes and instances
// ---------------------------------------------------------------------------

/**
 * How an `instance` string of the contract resolves on web (§3.1, "one shared
 * resolver table"): a widget by its label, a dashboard row by index, the nth
 * instance of the id on the page, a selected instance, the whole page, or a
 * reason the web probe cannot produce it.
 */
type InstanceSpec =
  | { label: string }
  | { row: number }
  | { nth: number }
  | { selected: true }
  | { page: true }
  | { unavailable: string };

interface SceneSpec {
  id: string;
  rows?: string[][];
  globalFilters?: 'none' | 'two';
  showTitles?: boolean;
  showIcons?: boolean;
  viewport?: { width: number; height: number };
  member?: boolean;
  /** The dashboard is a linked database block of a document. */
  embedded?: boolean;
  localChange?: boolean;
  /** The widget that un-instanced widget-level checks and interactions use first. */
  defaultWidget?: string;
  instances?: Record<string, InstanceSpec>;
  unavailable?: string;
}

const TWO_WIDGETS = [['Projects Grid', 'Projects Board']];
const GRID_INSTANCE = { 'Grid widget': { label: 'Projects Grid' } };

/** How the web probe builds each scene of `visual-metrics.json` on the canonical fixture. */
export const PARITY_SCENES: Record<string, SceneSpec> = {
  'two-widgets': { id: 'two-widgets', rows: TWO_WIDGETS, defaultWidget: 'Projects Grid', instances: GRID_INSTANCE },
  'icons-in-heading': {
    id: 'icons-in-heading',
    rows: TWO_WIDGETS,
    showIcons: true,
    defaultWidget: 'Projects Grid',
    instances: GRID_INSTANCE,
  },
  'titles-hidden': {
    id: 'titles-hidden',
    rows: TWO_WIDGETS,
    showTitles: false,
    defaultWidget: 'Projects Grid',
    instances: GRID_INSTANCE,
  },
  'global-filters': {
    id: 'global-filters',
    rows: TWO_WIDGETS,
    globalFilters: 'two',
    localChange: true,
    defaultWidget: 'Projects Grid',
    instances: {
      ...GRID_INSTANCE,
      'first pill (Status: In progress)': { nth: 0 },
      'second pill (no value)': { nth: 1 },
    },
  },
  // The user report shape: the second widget ("HR" in the report) carries the saved filter.
  'filtered-grid': {
    id: 'filtered-grid',
    rows: [['Projects Grid', 'Tasks Grid']],
    defaultWidget: 'Tasks Grid',
    instances: { 'Grid widget': { label: 'Tasks Grid' } },
  },
  'three-rows': {
    id: 'three-rows',
    rows: [['Projects Grid'], ['Tasks Grid'], ['Notes Grid']],
    defaultWidget: 'Projects Grid',
    instances: { ...GRID_INSTANCE, 'first row': { row: 0 }, 'middle row': { row: 1 }, 'any row': { page: true } },
  },
  charts: {
    id: 'charts',
    rows: [
      ['Projects Bar', 'Projects Donut', 'Projects Number'],
      ['Projects Line', 'Backlog Chart'],
    ],
    instances: {
      'middle widget': { label: 'Projects Donut' },
      'bar chart widget': { label: 'Projects Bar' },
      'a chart whose source has no rows': { label: 'Backlog Chart' },
      'selected type': { selected: true },
      'a chart before its rows load': { unavailable: 'the loading state is transient; the web probe cannot hold it' },
      'bar chart grouped by a second property, Stacked': { unavailable: 'stacked bars arrive in wave 4 (WP12)' },
    },
  },
  empty: { id: 'empty', rows: [], instances: { 'after clicking + New view': { page: true } } },
  'mobile-390': {
    id: 'mobile-390',
    rows: TWO_WIDGETS,
    viewport: { width: 390, height: 844 },
    defaultWidget: 'Projects Grid',
    instances: GRID_INSTANCE,
  },
  'read-only-grid': {
    id: 'read-only-grid',
    rows: TWO_WIDGETS,
    member: true,
    defaultWidget: 'Projects Grid',
    instances: GRID_INSTANCE,
  },
  // A document whose first block links Projects as a dashboard. The block is a new, empty
  // linked dashboard: the contract measures only its toolbar there.
  embedded: { id: 'embedded', rows: [], embedded: true },
  'widget-search': { id: 'widget-search', unavailable: 'web widgets have no search tool before wave 4 (WP09)' },
  drilldown: { id: 'drilldown', unavailable: 'the drill-down dialog arrives in wave 5 (WP13a)' },
};

/**
 * Scenes are built in this order. The member scene comes late because inviting
 * a member is slow, and the global filter scene last: its unsaved viewer
 * change stays on the dashboard, and would filter every later scene.
 */
const SCENE_ORDER = [
  'two-widgets',
  'icons-in-heading',
  'titles-hidden',
  'filtered-grid',
  'three-rows',
  'charts',
  'empty',
  'mobile-390',
  'read-only-grid',
  'global-filters',
  // Leaves the dashboard page for a document, so nothing follows it.
  'embedded',
];

interface LayoutSpec {
  rows: string[][];
  globalFilters?: PersistedGlobalFilter[];
  showTitles?: boolean;
  showIcons?: boolean;
}

function persistedRows(page: Page, rows: string[][]): PersistedRow[] {
  const { views } = parityWorld(page);

  return rows.map((labels, index) => {
    const width = Math.floor(DASHBOARD_GRID_COLUMNS / Math.max(labels.length, 1));

    return {
      id: `pr-${index + 1}`,
      height: DASHBOARD_DEFAULT_ROW_HEIGHT,
      widgets: labels.map((label, position) => {
        const view = views[label];

        if (!view) throw new Error(`The parity fixture has no "${label}" view`);
        return {
          id: widgetIdFor(label),
          view_id: view.viewId,
          database_id: view.databaseId,
          width: position === labels.length - 1 ? DASHBOARD_GRID_COLUMNS - width * (labels.length - 1) : width,
        };
      }),
    };
  });
}

function widgetLocatorById(target: Page, widgetId: string): Locator {
  return target.locator(`[data-testid="dashboard-widget"][data-widget-id="${widgetId}"]`);
}

/** Wait until a widget shows its content (grid rows, board columns, a chart or its empty state). */
async function waitForWidgetContent(owner: Page, target: Page, label: string) {
  const view = parityWorld(owner).views[label];
  const widget = widgetLocatorById(target, widgetIdFor(label));
  const content =
    view.layout === 'grid'
      ? '[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"]), [data-testid="grid-new-row"]'
      : view.layout === 'board'
      ? '.database-board'
      : '.recharts-wrapper, [data-testid="number-chart"], [data-testid="number-chart-value"], [data-parity-id="dash-chart-empty"]';

  await expect(widget).toBeVisible({ timeout: 30_000 });
  await expect(widget.locator(content).first()).toBeVisible({ timeout: 30_000 });
}

async function applyLayout(page: Page, layout: LayoutSpec) {
  const rows = persistedRows(page, layout.rows);
  const viewId = dashboardViewId(page);

  // The dashboard's database doc remounts when the page reloads (theme fallback, dev server update).
  await expect
    .poll(() => page.evaluate((id) => Boolean((window as any).__DASHBOARD_TEST__?.byView(id)), viewId), { timeout: 30_000 })
    .toBe(true);
  await mergeRawLayout(page, viewId, '9', {
    rows,
    global_filters: layout.globalFilters ?? [],
    show_widget_titles: layout.showTitles ?? true,
    show_icons_in_heading: layout.showIcons ?? false,
  });
  const count = layout.rows.flat().length;

  if (count === 0) await expect(DashboardSelectors.emptyState(page)).toBeVisible({ timeout: 30_000 });
  else await expect(DashboardSelectors.widgets(page)).toHaveCount(count, { timeout: 30_000 });
  for (const label of layout.rows.flat()) await waitForWidgetContent(page, page, label);
}

/** Enter the mode with the toolbar Edit/Done button; a toolbar without it (phone width, reader) stays in View mode. */
async function setMode(target: Page, mode: 'view' | 'edit'): Promise<string | null> {
  if (mode === 'edit') {
    if (await DashboardSelectors.doneButton(target).isVisible()) return null;
    if (!(await DashboardSelectors.editButton(target).isVisible())) return 'Edit mode is not offered here';
    await enterEditMode(target);
  } else if (await DashboardSelectors.doneButton(target).isVisible()) {
    await leaveEditMode(target);
  }

  return null;
}

/**
 * Switch the app theme the way a user does: the `mod+shift+L` hotkey
 * (`useAppThemeMode`, which sets `data-dark-mode` on the document root and
 * stores it), falling back to the stored preference and a reload.
 */
async function setTheme(target: Page, theme: 'light' | 'dark') {
  const want = theme === 'dark' ? 'true' : 'false';
  const current = () => target.evaluate(() => document.documentElement.getAttribute('data-dark-mode'));

  if ((await current()) === want) return;
  await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await target.keyboard.press('ControlOrMeta+Shift+KeyL');
  const switched = await expect
    .poll(current, { timeout: 3_000 })
    .toBe(want)
    .then(() => true)
    .catch(() => false);

  if (switched) return;
  await target.evaluate((value) => localStorage.setItem('dark-mode', value), want);
  await target.reload({ waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(target)).toBeVisible({ timeout: 30_000 });
  await expect.poll(current, { timeout: 10_000 }).toBe(want);
}

async function settle(target: Page, ms = 400) {
  await target.waitForTimeout(ms);
}

async function resetPointer(target: Page) {
  await target.mouse.up().catch(() => undefined);
  await target.keyboard.press('Escape').catch(() => undefined);
  await target.mouse.move(4, 4);
  await settle(target, 250);
}

interface BuiltScene {
  target: Page;
  unavailable?: string;
  /** Widget id per label shown in the scene. */
  labels: Record<string, string>;
}

/** Make the global filter of the `global-filters` scene differ from the saved one (View mode only). */
async function makeLocalFilterChange(page: Page) {
  await openGlobalFilterChip(page, 'Status');
  await toggleGlobalFilterOption(page, 'Todo');
  await closeGlobalFilterMenu(page);
}

/** The `embedded` scene: a new document whose first block links Projects as a dashboard. */
async function buildEmbeddedScene(page: Page, mode: 'view' | 'edit'): Promise<BuiltScene> {
  const documentId = await createDocumentPageAndNavigate(page);

  await insertLinkedDatabaseViaSlash(page, documentId, 'Projects', 'Dashboard');
  const block = page.locator(`#editor-${documentId} [data-block-type="dashboard"]`);

  await expect(block.getByTestId('dashboard-view')).toBeVisible({ timeout: 30_000 });
  parityWorld(page).currentScene = 'embedded';
  // A dashboard created in this session opens in Edit mode.
  const modeProblem = await setMode(page, mode);

  if (modeProblem) return { target: page, unavailable: modeProblem, labels: {} };
  await resetPointer(page);
  return { target: page, labels: {} };
}

async function buildScene(
  page: Page,
  request: APIRequestContext,
  scene: SceneSpec,
  state: ParityStateId
): Promise<BuiltScene> {
  if (scene.unavailable) return { target: page, unavailable: scene.unavailable, labels: {} };
  const { mode, theme } = parseParityState(state);
  const labels = Object.fromEntries((scene.rows ?? []).flat().map((label) => [label, widgetIdFor(label)]));
  const globalFilters =
    scene.globalFilters === 'two'
      ? [statusGlobalFilter(page), buildGlobalFilter(page, 'Stage', FieldType.SingleSelect, 0, '', { Tasks: 'Stage' })]
      : [];

  await page.setViewportSize(scene.viewport ?? { width: 1440, height: 900 });
  await resetPointer(page);
  if (scene.embedded) return buildEmbeddedScene(page, mode);
  await applyLayout(page, {
    rows: scene.rows ?? [],
    globalFilters,
    showTitles: scene.showTitles,
    showIcons: scene.showIcons,
  });
  parityWorld(page).currentScene = scene.id;

  if (scene.member) {
    const world = dashboardWorld(page);

    if (!parityWorld(page).memberReady) {
      await inviteDashboardMember(page, request, 'read-only');
      parityWorld(page).memberReady = true;
    }

    const member = world.member?.page ?? (await openDashboardAsMember(page));

    await member.emulateMedia({ reducedMotion: 'reduce' });
    await setTheme(member, theme);
    for (const label of Object.keys(labels)) await waitForWidgetContent(page, member, label);
    if (mode === 'edit') return { target: member, unavailable: 'a reader cannot enter Edit mode', labels };
    await resetPointer(member);
    return { target: member, labels };
  }

  const modeProblem = await setMode(page, mode);

  if (modeProblem) return { target: page, unavailable: modeProblem, labels };
  if (scene.localChange && mode === 'view') await makeLocalFilterChange(page);
  await resetPointer(page);
  return { target: page, labels };
}

const PAGE_LEVEL_PREFIXES = [
  'dash-widget-menu',
  'dash-widget-picker',
  'dash-widget-settings',
  'dash-widget-filters-popover',
  'dash-widget-sorts-popover',
  'dash-chart-panel',
  'dash-chart-type',
  // The chart tooltip renders in a portal on document.body (WP10 §1.6).
  'dash-chart-tooltip',
  'dash-number-color-rule',
  'dash-drilldown',
  'dash-side-peek',
];

/** Ids that live inside one widget box (scoped to it, §3.1); everything else is looked up on the page. */
export function isWidgetLevel(id: string): boolean {
  const owner = id.split('__')[0];

  if (PAGE_LEVEL_PREFIXES.some((prefix) => owner.startsWith(prefix))) return false;
  return ['dash-widget-', 'dash-chart-', 'dash-donut-', 'dash-number-'].some((prefix) => owner.startsWith(prefix));
}

type Resolved =
  | { scope: ScopeSpec; label: string; nth?: number; selected?: boolean }
  | { unavailable: string };

function defaultWidgetId(scene: SceneSpec, built: BuiltScene): string | undefined {
  return scene.defaultWidget ? built.labels[scene.defaultWidget] : undefined;
}

/** The scope an id is measured in for a contract `instance` (or the scene's default scope). */
function instanceScope(scene: SceneSpec, built: BuiltScene, id: string, pattern: string | undefined, instance?: string): Resolved {
  if (instance) {
    const spec = scene.instances?.[instance];

    if (!spec) return { unavailable: `the web probe does not know the instance "${instance}" in scene ${scene.id}` };
    if ('unavailable' in spec) return { unavailable: spec.unavailable };
    if ('label' in spec) {
      const widgetId = built.labels[spec.label];

      if (!widgetId) return { unavailable: `"${spec.label}" is not part of scene ${scene.id}` };
      return { scope: isWidgetLevel(id) ? { kind: 'widget', widgetId } : { kind: 'page' }, label: spec.label };
    }

    if ('row' in spec) return { scope: { kind: 'row-index', index: spec.row }, label: `row ${spec.row + 1}` };
    if ('nth' in spec) return { scope: { kind: 'page' }, label: `instance ${spec.nth + 1}`, nth: spec.nth };
    if ('selected' in spec) return { scope: { kind: 'page' }, label: 'selected', selected: true };
    return { scope: { kind: 'page' }, label: 'page' };
  }

  if (isWidgetLevel(id)) {
    return {
      scope: { kind: 'widget-containing', id: pattern ? undefined : id, pattern, prefer: defaultWidgetId(scene, built) },
      label: '',
    };
  }

  return { scope: { kind: 'page' }, label: 'page' };
}

/** The widget an interaction acts on. */
function interactionWidget(scene: SceneSpec, built: BuiltScene, when: string, instance?: string): ScopeSpec {
  const spec = instance ? scene.instances?.[instance] : undefined;

  if (spec && 'label' in spec && built.labels[spec.label]) return { kind: 'widget', widgetId: built.labels[spec.label] };
  if (spec && 'row' in spec) return { kind: 'row-index', index: spec.row };
  const prefer = defaultWidgetId(scene, built);

  if (when === 'hover-bar' || when === 'chart-panel-open') {
    return { kind: 'widget-containing', pattern: '^dash-chart-(bar|grid-line|tick-label)$', prefer };
  }

  if (when === 'hover-row' || when === 'scrolling') return { kind: 'widget-containing', id: 'dash-widget-grid-row', prefer };
  if (prefer) return { kind: 'widget', widgetId: prefer };
  return { kind: 'widget-index', index: 0 };
}

// ---------------------------------------------------------------------------
// Interactions (`interactions` of visual-metrics.json)
// ---------------------------------------------------------------------------

interface Interaction {
  undo: () => Promise<void>;
}

const GRID_DATA_ROW = '[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])';

async function interact(
  target: Page,
  when: string,
  scopeSpec: ScopeSpec,
  pickerNewView: boolean
): Promise<Interaction | { unavailable: string }> {
  const none = { undo: async () => undefined };
  const escape = { undo: async () => resetPointer(target) };

  if (pickerNewView) {
    const add = DashboardSelectors.addWidgetButton(target).filter({ visible: true }).first();

    if (!(await add.isVisible())) return { unavailable: 'no add widget button (Edit mode only)' };
    await add.click();
    await expect(DashboardSelectors.picker(target)).toBeVisible();
    const newView = DashboardSelectors.pickerNewView(target);

    if (await newView.isEnabled()) await newView.click();
    await settle(target);
    return escape;
  }

  if (when === 'rest') return none;
  const scope = await callParityProbe(target, 'resolveScope', scopeSpec);
  const pageWide = ['hover-width-gap', 'drag-width', 'hover-height-band', 'drag-height', 'filter-popover-open', 'tooltip-move-up'];

  if (!scope.found && !pageWide.includes(when)) return { unavailable: 'no widget to interact with' };
  const host =
    scopeSpec.kind === 'row-index'
      ? target.locator('[data-testid="dashboard-row"]').nth(scopeSpec.index)
      : scope.widgetId
      ? widgetLocatorById(target, scope.widgetId)
      : target.locator('body');
  const first = async (locator: Locator) => ((await locator.count()) > 0 ? locator.first() : null);

  switch (when) {
    case 'hover-widget': {
      const box = await host.boundingBox();

      if (!box) return { unavailable: 'widget is not rendered' };
      await target.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
      return none;
    }

    case 'hover-title': {
      const title = await first(host.getByTestId('dashboard-widget-title-button'));

      if (!title) return { unavailable: 'no title pill' };
      await title.hover();
      return none;
    }

    case 'hover-row': {
      const row = await first(host.locator(GRID_DATA_ROW));

      const rowBox = row ? await row.boundingBox() : null;
      const box = await host.boundingBox();

      if (rowBox && box) {
        // A pointer move, not `hover()`: that scrolls the row into view, and a grid wider than
        // its card would scroll sideways and hide the gutter with the row handle.
        await target.mouse.move(Math.max(rowBox.x, box.x) + 80, rowBox.y + rowBox.height / 2);
        return none;
      }

      if (!box) return { unavailable: 'no grid row' };
      await target.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      return none;
    }

    case 'hover-width-gap':
    case 'drag-width':
    case 'hover-height-band':
    case 'drag-height': {
      const handle = await first(
        target.getByTestId(when.includes('width') ? 'dashboard-width-handle' : 'dashboard-height-handle')
      );

      if (!handle) return { unavailable: 'no resize handle (Edit mode only)' };
      await handle.hover();
      if (when.startsWith('drag')) {
        await target.mouse.down();
        return { undo: async () => target.mouse.up() };
      }

      return none;
    }

    case 'menu-open': {
      const title = await first(host.getByTestId('dashboard-widget-title-button'));

      if (!title) return { unavailable: 'no title pill to open the widget menu from' };
      await title.click();
      await expect(DashboardSelectors.widgetMenu(target)).toBeVisible();
      return escape;
    }

    case 'settings-open':
    case 'chart-panel-open':
    case 'filters-open': {
      await host.hover();
      const testId = when === 'filters-open' ? 'database-actions-filter' : 'dashboard-widget-settings-button';
      const button = await first(host.getByTestId(testId));

      if (!button) return { unavailable: `no ${testId} tool in the widget` };
      await button.click();
      return escape;
    }

    case 'filter-popover-open': {
      await DashboardSelectors.globalFilterButton(target).click();
      await expect(DashboardSelectors.globalFilterMenu(target)).toBeVisible();
      return escape;
    }

    case 'hover-bar': {
      const bar = await first(host.locator('[data-parity-id="dash-chart-bar"], .recharts-bar-rectangle path'));

      if (!bar) return { unavailable: 'no bar to hover' };
      await bar.hover();
      return none;
    }

    case 'scrolling': {
      const scroller = await first(host.locator('.appflowy-custom-scroller'));

      if (!scroller) return { unavailable: 'no grid scroller' };
      await scroller.hover();
      await scroller.evaluate((el) => el.scrollBy({ top: 40 }));
      await settle(target, 80);
      return { undo: async () => scroller.evaluate((el) => el.scrollTo({ top: 0 })) };
    }

    case 'tooltip-move-up': {
      const control = await first(target.locator('[data-parity-id="dash-row-control-move-up"]'));

      if (!control) return { unavailable: 'no ↑ row control (wave 3, WP04)' };
      await control.hover();
      await settle(target, 800);
      return none;
    }

    default:
      return { unavailable: `interaction "${when}" is not implemented by the web probe` };
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface ScreenshotEntry {
  scene: string;
  when: string;
  instance: string | null;
  path: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  origin: { x: number; y: number };
}

interface ScopedBox extends ProbeBox {
  id: string;
  scene: string;
  when: string;
  instance: string | null;
}

interface RunContext {
  state: ParityStateId;
  options: RunOptions;
  dir: string;
  rows: ParityReportRow[];
  missing: Map<string, { id: string; scene: string; when: string; instance: string | null }>;
  boxes: ScopedBox[];
  screenshots: ScreenshotEntry[];
  fallbackIds: Set<string>;
}

type RowFields = Omit<ParityReportRow, 'state' | 'blocking' | 'pass' | 'measure' | 'tolerance' | 'target' | 'index' | 'instanceLabel'> & {
  /** Force the gate off for a row that cannot apply here (an icon the scene does not show). */
  blocking?: false;
  pass?: boolean;
  measure?: ParityReportRow['measure'];
  tolerance?: number;
  target?: string;
  index?: number;
  instanceLabel?: string | null;
};

function pushRow(ctx: RunContext, fields: RowFields) {
  const pass = fields.pass ?? false;
  const row: ParityReportRow = {
    ...fields,
    target: fields.target ?? fields.check,
    index: fields.index ?? 0,
    instanceLabel: fields.instanceLabel ?? null,
    state: ctx.state,
    tolerance: fields.tolerance ?? 0.5,
    pass,
    measure: fields.measure ?? 'render',
    blocking: fields.blocking === false ? false : !pass && isBlocking(fields.status, fields.wave, ctx.options),
  };

  ctx.rows.push(row);
  if (row.error === 'missing-id' && row.kind !== 'icon') {
    const id = row.target;
    const key = [id, row.scene, row.when, row.instance ?? '-'].join('|');

    ctx.missing.set(key, { id, scene: row.scene, when: row.when, instance: row.instance });
  }
}

const COLOR_METRICS = new Set(['background', 'borderColor', 'ringColor', 'outlineColor', 'color', 'iconColor', 'strokeColor']);

/** Normalize a raw page value (`{ values }` means the corners / sides / colors differ). */
function finalizeActual(metric: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'values' in (raw as Record<string, unknown>)) {
    const values = (raw as { values: unknown[] }).values;

    return { differs: COLOR_METRICS.has(metric) ? values.map((value) => normalizeColor(String(value))) : values };
  }

  if (COLOR_METRICS.has(metric)) return normalizeColor(String(raw)) ?? String(raw);
  if (metric === 'effectiveIconColor') {
    const { color, opacity } = raw as { color: string | null; opacity: number };
    const normalized = normalizeColor(color);

    return normalized ? multiplyAlpha(normalized, opacity) : color;
  }

  if (metric === 'shadow' && Array.isArray(raw)) {
    return (raw as { x: number; y: number; blur: number; spread: number; color: string }[]).map((shadow) => ({
      ...shadow,
      color: normalizeColor(shadow.color) ?? shadow.color,
    }));
  }

  return raw;
}

/**
 * The `icon` value of §6.1.3 for a rendered glyph: the expected icons.json
 * name when the glyph is that icon's web target (svg-norm/1 of SVGO's output
 * on both sides, §4.4), else the web asset it is (preferring one icons.json
 * knows), else an unknown-glyph label.
 */
function iconActual(identity: GlyphIdentity, expectedName: string | null): { actual: unknown; pass: boolean } {
  const entry = expectedName ? parityContract().icons.icons.find((icon) => icon.name === expectedName) : undefined;
  const wanted = entry ? icons().expectedHash(entry) : null;

  if (entry && identity.hash && wanted && identity.hash === wanted) return { actual: entry.name, pass: true };
  if (identity.assets.length > 0) {
    const listed = new Set(
      parityContract().icons.icons.flatMap((icon) => [icon.web.current?.asset, icon.web.target.asset].filter(Boolean) as string[])
    );
    const preferred = [entry?.web.current?.asset, entry?.web.target.asset].find(
      (asset): asset is string => Boolean(asset) && identity.assets.includes(asset as string)
    );

    return { actual: { asset: preferred ?? identity.assets.find((asset) => listed.has(asset)) ?? identity.assets[0] }, pass: false };
  }

  return { actual: { name: identity.hash ? `unknown glyph ${identity.hash.slice(0, 12)}` : 'unparseable glyph' }, pass: false };
}

function metricRows(
  ctx: RunContext,
  check: MetricCheck,
  result: ProbeResult,
  resolved: { label: string },
  labelOfWidget: (widgetId: string) => string
) {
  const { tokens } = parityContract();
  const state = parseParityState(ctx.state);
  const names = measuredMetricNames(check.metrics);
  const instanceLabel =
    resolved.label || (result.widgetId ? labelOfWidget(result.widgetId) : result.rowIndex !== null ? `row ${result.rowIndex + 1}` : 'page');
  const common = {
    check: check.checkId,
    kind: 'metric' as const,
    variant: check.variant,
    scene: check.scene,
    when: check.when,
    instance: check.instance ?? null,
    instanceLabel,
    wave: check.wave,
    status: check.status,
    attach: check.attach,
    tolerance: check.tolerancePx,
  };
  const missingError = (detail?: string) =>
    detail === 'no element with this id in scope' || detail === 'scope not found' ? 'missing-id' : detail ?? 'missing-id';

  // Metrics over the whole scope, whether or not an instance exists.
  for (const metric of names.filter((name) => name === 'count' || name === 'widthMin' || name === 'widthMax')) {
    const expected = resolveExpected(check.metrics[metric], { tokens, state, client: 'web' });
    let actual: number | null;

    if (metric === 'count') actual = result.missing === 'scope not found' ? null : result.count;
    else {
      const widths = result.instances
        .map((instance) => instance.values[metric])
        .filter((value): value is number => typeof value === 'number');

      actual = widths.length === 0 ? null : metric === 'widthMin' ? Math.min(...widths) : Math.max(...widths);
    }

    let pass = false;

    if (expected.ok && typeof expected.value === 'number' && actual !== null) {
      if (metric === 'count') pass = compareValues(expected.value, actual, 0).pass;
      else if (metric === 'widthMin') pass = actual >= expected.value - check.tolerancePx;
      else pass = actual <= expected.value + check.tolerancePx;
    }

    if (metric === 'count' && actual === 0) {
      ctx.missing.set([check.checkId, check.scene, check.when, check.instance ?? '-'].join('|'), {
        id: check.checkId,
        scene: check.scene,
        when: check.when,
        instance: check.instance ?? null,
      });
    }

    pushRow(ctx, {
      ...common,
      metric,
      expected: expected.ok ? expected.value : null,
      actual,
      pass,
      measure: result.instances[0]?.source ?? 'render',
      error: actual === null ? missingError(result.missing) : undefined,
      note: !expected.ok ? `expected: ${expected.error}` : undefined,
    });
  }

  const perInstance = names.filter((name) => !['count', 'widthMin', 'widthMax'].includes(name));

  if (perInstance.length === 0) return;
  if (result.instances.length === 0) {
    perInstance.forEach((metric) => {
      const expected = resolveExpected(check.metrics[metric], { tokens, state, client: 'web', measured: () => undefined });

      pushRow(ctx, {
        ...common,
        metric,
        expected: expected.ok ? expected.value : null,
        actual: null,
        error: missingError(result.missing),
        note: check.attach ? `attach in ${check.attach}` : undefined,
      });
    });
    return;
  }

  result.instances.forEach((instance) => {
    if (instance.source === 'fallback') ctx.fallbackIds.add(instance.id);
    const refs = Object.fromEntries(
      Object.entries(instance.deps).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    );

    perInstance.forEach((metric) => {
      const measured = (id: string, name: string) => {
        if (id === 'self') {
          const own = instance.values[name];

          return typeof own === 'number' ? own : refs[`self.${name}`];
        }

        return refs[`${id}.${name}`];
      };
      const expected = resolveExpected(check.metrics[metric], { tokens, state, client: 'web', measured });
      const note = instance.notes[metric];
      let actual = finalizeActual(metric, instance.values[metric]);
      let pass = false;

      if (metric === 'icon') {
        const identity = typeof actual === 'string' ? icons().identify(actual) : null;
        const verdict = identity ? iconActual(identity, expected.ok ? String(expected.value) : null) : null;

        actual = verdict?.actual ?? null;
        pass = verdict?.pass ?? false;
      } else if (metric === 'childGap' && Array.isArray(actual) && expected.ok && typeof expected.value === 'number') {
        const gaps = actual as number[];

        pass = gaps.every((gap) => compareValues(expected.value, gap, check.tolerancePx).pass);
        actual = gaps.every((gap) => gap === gaps[0]) ? gaps[0] : gaps;
      } else if (expected.ok) {
        pass = compareValues(expected.value, actual, check.tolerancePx).pass;
      }

      const calcRefs = Object.keys(refs).length > 0 ? refs : undefined;

      pushRow(ctx, {
        ...common,
        target: instance.id,
        index: instance.index,
        metric,
        expected: expected.ok ? expected.value : null,
        actual,
        pass,
        measure: instance.source,
        box: instance.box,
        refs: calcRefs,
        error: actual === null ? note ?? 'not measured' : undefined,
        note: !expected.ok ? `expected: ${expected.error}` : actual === null ? undefined : note,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// One state
// ---------------------------------------------------------------------------

interface IconTask {
  icon: IconEntry;
  part: string;
  owner: string;
  size: unknown;
  wave: number;
  status: IconEntry['status'];
}

/** The checks measured in one scene × interaction × instance (one capture). */
interface Group {
  scene: SceneSpec;
  when: string;
  instance?: string;
  metrics: { check: MetricCheck; id: string; pattern?: string }[];
  orders: OrderCheck[];
  texts: TextCheck[];
  icons: IconTask[];
}

function groupKey(scene: string, when: string, instance?: string) {
  return `${scene}|${when}|${instance ?? ''}`;
}

function planGroups(ctx: RunContext): Map<string, Group> {
  const { metrics, icons: iconFixture } = parityContract();
  const checks = expandChecks(metrics, ctx.state, ctx.options);
  const groups = new Map<string, Group>();
  const groupFor = (sceneId: string, when: string, instance?: string): Group => {
    const scene = PARITY_SCENES[sceneId] ?? { id: sceneId, unavailable: `unknown scene ${sceneId}` };
    const key = groupKey(sceneId, when, instance);

    if (!groups.has(key)) groups.set(key, { scene, when, instance, metrics: [], orders: [], texts: [], icons: [] });
    return groups.get(key) as Group;
  };

  checks.metrics.forEach((check) => {
    const id = check.appliesTo ?? check.checkId;
    const pattern = check.appliesTo?.includes('*') ? appliesToPattern(check.appliesTo) : undefined;

    groupFor(check.scene, check.when, check.instance).metrics.push({ check, id, pattern });
  });
  checks.orders.forEach((check) => groupFor(check.scene, check.when, check.instance).orders.push(check));
  checks.texts.forEach((check) => groupFor(check.scene, check.when, check.instance).texts.push(check));

  // icons.json contexts are measured where (and in the states in which) their owner
  // element is measured, in every instance of the part in that scope (§4.4: "every
  // context renders the target"). Owners that only the `ids` section lists take the
  // scene of their surface.
  const { mode } = parseParityState(ctx.state);

  iconFixture.icons.forEach((icon) => {
    icon.contexts.forEach((context) => {
      const status = context.status ?? icon.status;

      if (!isInScope(status, context.wave, ctx.options)) return;
      const owner = context.parityId.split('__')[0];
      const task = { icon, part: context.parityId, owner, size: context.size, wave: context.wave, status };
      // The part's own entry says where it shows (the title icon only with "Show icons in
      // heading"); else its owner's entry does.
      const entry =
        metrics.elements.find((element) => element.id === context.parityId) ?? elementEntryFor(metrics, owner);

      if (entry) {
        // The base entry only: a variant such as `count: 0` says where the part is absent.
        const baseCheck = checks.metrics.find((check) => check.checkId === entry.id && check.variant === null);

        // Not measured in this state (e.g. Edit-only controls in a View state).
        if (baseCheck) groupFor(baseCheck.scene, baseCheck.when, baseCheck.instance).icons.push(task);
        return;
      }

      const surface = ICON_OWNER_SURFACES.find(([prefix]) => owner.startsWith(prefix))?.[1];

      if (surface?.mode && surface.mode !== mode) return;
      groupFor(surface?.scene ?? defaultScene(metrics), surface?.when ?? 'rest', surface?.instance).icons.push(task);
    });
  });
  return groups;
}

/** Where an icon context whose owner has no element entry is shown (scene, interaction, instance; `mode` when only one has it). */
const ICON_OWNER_SURFACES: [string, { scene: string; when: string; instance?: string; mode?: 'view' | 'edit' }][] = [
  ['dash-widget-picker', { scene: 'empty', when: 'rest', instance: 'after clicking + New view' }],
  ['dash-empty-', { scene: 'empty', when: 'rest' }],
  ['dash-widget-menu-item-', { scene: 'charts', when: 'menu-open' }],
  ['dash-widget-filters-popover', { scene: 'filtered-grid', when: 'filters-open' }],
  ['dash-widget-sorts-popover', { scene: 'filtered-grid', when: 'filters-open' }],
  ['dash-widget-settings', { scene: 'two-widgets', when: 'settings-open', mode: 'edit' }],
  ['dash-chart-type-', { scene: 'charts', when: 'chart-panel-open' }],
  ['dash-chart-panel', { scene: 'charts', when: 'chart-panel-open' }],
  ['dash-number-color-rule', { scene: 'charts', when: 'chart-panel-open' }],
  ['dash-global-filter-back', { scene: 'two-widgets', when: 'filter-popover-open' }],
  ['dash-row-control-', { scene: 'three-rows', when: 'hover-row', instance: 'middle row' }],
  ['dash-drilldown', { scene: 'drilldown', when: 'rest' }],
  ['dash-widget-search', { scene: 'widget-search', when: 'rest' }],
];

function unavailableRows(ctx: RunContext, group: Group, reason: string) {
  const common = { scene: group.scene.id, when: group.when, measure: 'unavailable' as const, error: reason };

  group.metrics.forEach(({ check }) =>
    measuredMetricNames(check.metrics).forEach((metric) =>
      pushRow(ctx, {
        ...common,
        check: check.checkId,
        kind: 'metric',
        variant: check.variant,
        scene: check.scene,
        when: check.when,
        instance: check.instance ?? null,
        metric,
        expected: null,
        actual: null,
        wave: check.wave,
        status: check.status,
        attach: check.attach,
      })
    )
  );
  group.orders.forEach((check) =>
    pushRow(ctx, {
      ...common,
      check: check.checkId,
      kind: 'order',
      variant: null,
      instance: check.instance ?? null,
      metric: 'order',
      expected: check.expected,
      actual: null,
      wave: check.wave,
      status: check.status,
    })
  );
  group.texts.forEach((check) =>
    pushRow(ctx, {
      ...common,
      check: check.checkId,
      kind: 'text',
      variant: null,
      instance: check.instance ?? null,
      metric: check.textKind,
      expected: check.expected,
      actual: null,
      wave: check.wave,
      status: check.status,
    })
  );
  group.icons.forEach((task) =>
    pushRow(ctx, {
      ...common,
      check: `icon:${task.icon.name}`,
      kind: 'icon',
      variant: null,
      instance: group.instance ?? null,
      target: task.part,
      metric: 'icon',
      expected: task.icon.name,
      actual: null,
      wave: task.wave,
      status: task.status,
    })
  );
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** One capture per scene × interaction (× instance), taken right before measuring so the boxes match it. */
async function capture(ctx: RunContext, target: Page, group: Group) {
  const name = [`web-${ctx.state}`, group.scene.id, group.when, group.instance ? slug(group.instance) : null]
    .filter(Boolean)
    .join('--');
  const path = join(ctx.dir, 'shots', `${name}.png`);
  const viewport = target.viewportSize() ?? { width: 1440, height: 900 };

  await target.screenshot({ path }).catch(() => undefined);
  if (!existsSync(path)) return;
  ctx.screenshots.push({
    scene: group.scene.id,
    when: group.when,
    instance: group.instance ?? null,
    path: relative(ctx.dir, path),
    width: viewport.width,
    height: viewport.height,
    devicePixelRatio: 1,
    origin: { x: 0, y: 0 },
  });
}

async function measureGroup(ctx: RunContext, built: BuiltScene, group: Group) {
  const { target } = built;
  const { scene } = group;
  const pickerNewView = group.instance === 'after clicking + New view';

  await resetPointer(target);
  await prepareParityProbe(target);
  const interaction = await interact(
    target,
    group.when,
    interactionWidget(scene, built, group.when, group.instance),
    pickerNewView
  );

  if ('unavailable' in interaction) {
    unavailableRows(ctx, group, interaction.unavailable);
    return;
  }

  try {
    await settle(target);
    await prepareParityProbe(target);
    await capture(ctx, target, group);

    // Element metrics, one page call for the whole group.
    const requests: (ProbeRequest & { resolved: Extract<Resolved, { scope: ScopeSpec }>; checkIndex: number })[] = [];

    group.metrics.forEach(({ check, id, pattern }, checkIndex) => {
      const resolved = instanceScope(scene, built, check.checkId, pattern, group.instance);

      if ('unavailable' in resolved) {
        unavailableRows(ctx, { ...group, metrics: [{ check, id }], orders: [], texts: [], icons: [] }, resolved.unavailable);
        return;
      }

      requests.push({
        key: String(checkIndex),
        id,
        pattern,
        scope: resolved.scope,
        relativeTo: check.relativeTo,
        content: check.content,
        metrics: measuredMetricNames(check.metrics),
        deps: measuredDependencies(check.metrics),
        gapAxis: check.metrics.gapAxis === 'y' ? 'y' : 'x',
        nth: resolved.nth,
        selected: resolved.selected,
        resolved,
        checkIndex,
      });
    });
    const results = await callParityProbe(
      target,
      'measure',
      requests.map(({ resolved: _resolved, checkIndex: _index, ...request }) => request)
    );
    const labelOfWidget = (widgetId: string) =>
      Object.entries(built.labels).find(([, id]) => id === widgetId)?.[0] ?? widgetId;

    results.forEach((result, index) => {
      const request = requests[index];
      const { check } = group.metrics[request.checkIndex];

      metricRows(ctx, check, result, request.resolved, labelOfWidget);
    });

    // Reference boxes (relativeTo, calc inputs) for the review page's outlines.
    for (const request of requests) {
      const ids = [request.relativeTo, ...request.deps.map((dep) => dep.id)].filter(
        (id): id is string => Boolean(id) && id !== 'self'
      );

      if (ids.length === 0) continue;
      const { check } = group.metrics[request.checkIndex];
      const found = await callParityProbe(target, 'boxes', { ids: [...new Set(ids)], scope: request.scope });

      found.forEach((box) =>
        ctx.boxes.push({ ...box, scene: check.scene, when: check.when, instance: check.instance ?? null })
      );
    }

    for (const check of group.orders) await measureOrder(ctx, built, group, check);
    for (const check of group.texts) await measureText(ctx, built, group, check);
    for (const task of group.icons) await measureIcon(ctx, built, group, task);
  } finally {
    await interaction.undo();
  }
}

async function measureOrder(ctx: RunContext, built: BuiltScene, group: Group, check: OrderCheck) {
  const resolved = instanceScope(group.scene, built, check.container, undefined, check.instance);
  const common = {
    check: check.checkId,
    kind: 'order' as const,
    variant: null,
    scene: check.scene,
    when: check.when,
    instance: check.instance ?? null,
    target: check.container,
    metric: 'order',
    expected: check.expected,
    wave: check.wave,
    status: check.status,
  };

  if ('unavailable' in resolved) {
    pushRow(ctx, { ...common, actual: null, measure: 'unavailable', error: resolved.unavailable });
    return;
  }

  const family = orderFamily(check.expected, parityContract().known, check.container);
  const result = await callParityProbe(built.target, 'order', {
    container: check.container,
    scope: resolved.scope,
    axis: check.axis,
    family,
  });
  const pass = result.ids !== null && JSON.stringify(result.ids) === JSON.stringify(check.expected);

  pushRow(ctx, {
    ...common,
    instanceLabel: resolved.label || null,
    actual: result.ids,
    pass,
    box: result.box ?? null,
    boxes: result.boxes,
    error: result.ids === null ? (result.missing?.startsWith('no ') ? 'missing-id' : result.missing ?? 'missing-id') : undefined,
  });
}

async function measureText(ctx: RunContext, built: BuiltScene, group: Group, check: TextCheck) {
  const { target } = built;
  const resolved = instanceScope(group.scene, built, check.element, undefined, check.instance);
  const common = {
    check: check.checkId,
    kind: 'text' as const,
    variant: null,
    scene: check.scene,
    when: check.when,
    instance: check.instance ?? null,
    target: check.element,
    metric: check.textKind,
    expected: check.expected,
    wave: check.wave,
    status: check.status,
    tolerance: 0,
  };

  if ('unavailable' in resolved) {
    pushRow(ctx, { ...common, actual: null, measure: 'unavailable', error: resolved.unavailable });
    return;
  }

  let value: string | null = null;
  let error: string | undefined;
  let box: ProbeBox | null = null;

  if (check.textKind === 'tooltip') {
    const token = await callParityProbe(target, 'mark', { id: check.element, scope: resolved.scope });

    if (!token) error = 'missing-id';
    else {
      const host = target.locator(`[data-parity-probe-target="${token}"]`);

      box = await host.boundingBox().catch(() => null);
      await host.hover({ force: true }).catch(() => undefined);
      await settle(target, 800);
      value = await callParityProbe(target, 'tooltipText');
      if (value === null) error = 'no tooltip after 800ms';
      await target.mouse.move(4, 4);
      await settle(target, 200);
    }
  } else {
    const result = await callParityProbe(target, 'text', {
      element: check.element,
      scope: resolved.scope,
      kind: check.textKind,
    });

    value = result.value;
    box = result.box ?? null;
    if (value === null) error = result.missing?.startsWith('no ') ? 'missing-id' : result.missing ?? 'missing-id';
  }

  pushRow(ctx, {
    ...common,
    instanceLabel: resolved.label || null,
    actual: value,
    pass: value !== null && value.replace(/\s+/g, ' ').trim() === check.expected.replace(/\s+/g, ' ').trim(),
    box,
    error,
  });
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isSharedContext(part: string) {
  return parityContract().icons.icons.filter((icon) => icon.contexts.some((context) => context.parityId === part)).length > 1;
}

/** Icons sharing a context (layout glyphs in tabs, field glyphs in headers) look across the whole page. */
function iconScope(group: Group, built: BuiltScene, task: IconTask): Resolved {
  if (isSharedContext(task.part)) return { scope: { kind: 'page' }, label: 'page' };
  if (!group.instance && isWidgetLevel(task.owner)) {
    return {
      scope: {
        kind: 'widget-containing',
        pattern: `^(${escapeRegExp(task.owner)}|${escapeRegExp(task.part)})$`,
        prefer: defaultWidgetId(group.scene, built),
      },
      label: '',
    };
  }

  return instanceScope(group.scene, built, task.owner, undefined, group.instance);
}

/** An icons.json context (§4.4 L2): the glyph rendered at the part is the icon's web target, at the contract size. */
async function measureIcon(ctx: RunContext, built: BuiltScene, group: Group, task: IconTask) {
  const { tokens } = parityContract();
  const resolved = iconScope(group, built, task);
  const common = {
    check: `icon:${task.icon.name}`,
    kind: 'icon' as const,
    variant: null,
    scene: group.scene.id,
    when: group.when,
    instance: group.instance ?? null,
    target: task.part,
    wave: task.wave,
    status: task.status,
  };

  if ('unavailable' in resolved) {
    pushRow(ctx, { ...common, metric: 'icon', expected: task.icon.name, actual: null, measure: 'unavailable', error: resolved.unavailable });
    return;
  }

  const glyphs: GlyphInstance[] = await callParityProbe(built.target, 'glyphs', {
    part: task.part,
    owner: task.owner,
    scope: resolved.scope,
  });
  const verdicts = glyphs.map((glyph) => ({ glyph, ...iconActual(icons().identify(glyph.html), task.icon.name) }));
  const match = verdicts.find((verdict) => verdict.pass);
  const shown = verdicts.map((verdict) => verdict.actual);
  const uniqueShown = shown.filter((value, index) => shown.findIndex((other) => JSON.stringify(other) === JSON.stringify(value)) === index);
  const targetMissing = icons().expectedHash(task.icon) === null;

  // A context several icons share (layout glyphs in tabs and titles, field glyphs in
  // headers) shows this icon only where the fixture has that layout or field type.
  if (!match && glyphs.length > 0 && isSharedContext(task.part)) {
    const reason = `not shown in ${group.scene.id}: the context renders ${uniqueShown.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(', ')}`;

    pushRow(ctx, { ...common, metric: 'icon', expected: task.icon.name, actual: null, measure: 'unavailable', error: reason, blocking: false });
    return;
  }

  pushRow(ctx, {
    ...common,
    instanceLabel: resolved.label || null,
    metric: 'icon',
    expected: task.icon.name,
    actual: match ? match.actual : uniqueShown.length === 1 ? uniqueShown[0] : uniqueShown.length ? uniqueShown : null,
    pass: Boolean(match),
    measure: glyphs[0]?.source ?? 'render',
    error: glyphs.length === 0 ? 'missing-id' : undefined,
    note: targetMissing ? `the web target ${task.icon.web.target.asset} does not exist yet` : undefined,
  });
  const size = resolveExpected(task.size, { tokens, state: parseParityState(ctx.state), client: 'web' });
  const sized = match?.glyph ?? glyphs[0];
  const actualSize = sized ? (Math.abs(sized.width - sized.height) <= 0.5 ? sized.width : `${sized.width}x${sized.height}`) : null;

  pushRow(ctx, {
    ...common,
    instanceLabel: resolved.label || null,
    metric: 'iconSize',
    expected: size.ok ? size.value : null,
    actual: actualSize,
    pass: size.ok && compareValues(size.value, actualSize, 0.5).pass,
    measure: sized?.source ?? 'render',
    error: sized ? undefined : 'missing-id',
  });
}

// ---------------------------------------------------------------------------
// Captures and the probe file
// ---------------------------------------------------------------------------

/** The whole canonical dashboard in one capture: `web-<state>.png`. */
async function captureCanonical(page: Page, state: ParityStateId, dir: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await applyLayout(page, { rows: CANONICAL_ROWS, globalFilters: [statusGlobalFilter(page)] });
  parityWorld(page).currentScene = 'canonical';
  await setMode(page, parseParityState(state).mode);
  await resetPointer(page);
  const height = await DashboardSelectors.view(page).evaluate((el) => el.scrollHeight + el.getBoundingClientRect().top + 40);

  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(900, Math.ceil(height)), 4000) });
  await settle(page, 600);
  const path = join(dir, `web-${state}.png`);

  await page.screenshot({ path });
  await page.setViewportSize({ width: 1440, height: 900 });
  return path;
}

function gitCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export interface ParityStateResult {
  state: ParityStateId;
  rows: ParityReportRow[];
  reportPath: string;
  screenshotPath: string;
  summary: ReturnType<typeof summarize>;
}

function summarize(rows: ParityReportRow[], options: RunOptions) {
  const count = (filter: (row: ParityReportRow) => boolean) => rows.filter(filter).length;
  const checks = [...new Set(rows.map((row) => `${row.kind}:${row.check}`))];

  return {
    rows: rows.length,
    pass: count((row) => row.pass),
    fail: count((row) => !row.pass && row.actual !== null),
    missing: count((row) => row.error === 'missing-id'),
    notMeasured: count((row) => row.actual === null && row.error !== 'missing-id'),
    fallback: count((row) => row.measure === 'fallback'),
    blockingFailures: count((row) => row.blocking),
    /** Pending checks of `wave ≤ N` whose every row passed on web (the comparator decides across clients). */
    passingPendingInWave:
      options.wave === null
        ? []
        : checks.filter((key) => {
            const own = rows.filter((row) => `${row.kind}:${row.check}` === key);

            return own.every((row) => row.status === 'pending' && row.wave <= (options.wave as number) && row.pass);
          }),
    byKind: Object.fromEntries(
      (['metric', 'order', 'text', 'icon'] as const).map((kind) => [
        kind,
        { pass: count((row) => row.kind === kind && row.pass), fail: count((row) => row.kind === kind && !row.pass) },
      ])
    ),
  };
}

/** A row as §6.1.3 writes it, plus the probe's own verdict (never read by the comparator). */
function probeMeasurement(row: ParityReportRow) {
  return {
    check: row.check,
    variant: row.variant,
    scene: row.scene,
    when: row.when,
    instance: row.instance,
    target: row.target,
    index: row.index,
    instanceLabel: row.instanceLabel,
    metric: row.metric,
    actual: row.actual,
    measure: row.measure === 'unavailable' ? 'render' : row.measure,
    ...(row.box ? { box: row.box } : {}),
    ...(row.refs ? { refs: row.refs } : {}),
    expected: row.expected,
    ...(row.error ? { error: row.error } : {}),
    pass: row.pass,
    ...(row.note ? { note: row.note } : {}),
  };
}

function probeListEntry(row: ParityReportRow) {
  return {
    check: row.check,
    scene: row.scene,
    when: row.when,
    instance: row.instance,
    actual: row.actual,
    ...(row.box ? { box: row.box } : {}),
    ...(row.boxes ? { boxes: row.boxes } : {}),
    ...(row.error ? { error: row.error } : {}),
    expected: row.expected,
    pass: row.pass,
  };
}

/**
 * Measure every in-scope check of one state on the seeded canonical fixture
 * and write `web-<state>.json` (§6.1.3), `web-<state>.png` (the canonical
 * dashboard) and `shots/web-<state>--<scene>--<when>[--<instance>].png`.
 */
export async function runDashboardParityState(
  page: Page,
  request: APIRequestContext,
  state: ParityStateId,
  options: RunOptions = runOptionsFromEnv(process.env)
): Promise<ParityStateResult> {
  const dir = parityReportDir();

  mkdirSync(join(dir, 'shots'), { recursive: true });
  const ctx: RunContext = {
    state,
    options,
    dir,
    rows: [],
    missing: new Map(),
    boxes: [],
    screenshots: [],
    fallbackIds: new Set(),
  };
  const { theme } = parseParityState(state);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setTheme(page, theme);
  const screenshotPath = await captureCanonical(page, state, dir);
  const groups = [...planGroups(ctx).values()];
  const unavailableScenes: Record<string, string> = {};
  const rank = (id: string) => (SCENE_ORDER.indexOf(id) === -1 ? SCENE_ORDER.length : SCENE_ORDER.indexOf(id));
  const sceneIds = [...new Set(groups.map((group) => group.scene.id))].sort((a, b) => rank(a) - rank(b));

  for (const sceneId of sceneIds) {
    const sceneGroups = groups
      .filter((group) => group.scene.id === sceneId)
      .sort((a, b) => (a.when === 'rest' ? -1 : b.when === 'rest' ? 1 : a.when.localeCompare(b.when)));
    const scene = sceneGroups[0].scene;
    let built: BuiltScene;

    try {
      built = await buildScene(page, request, scene, state);
    } catch (error) {
      built = { target: page, labels: {}, unavailable: `scene could not be built: ${(error as Error).message.split('\n')[0]}` };
    }

    if (built.unavailable) {
      unavailableScenes[sceneId] = built.unavailable;
      sceneGroups.forEach((group) => unavailableRows(ctx, group, built.unavailable as string));
      if (scene.viewport) await page.setViewportSize({ width: 1440, height: 900 });
      continue;
    }

    for (const group of sceneGroups) {
      try {
        await measureGroup(ctx, built, group);
      } catch (error) {
        unavailableRows(ctx, group, `measurement failed: ${(error as Error).message.split('\n')[0]}`);
        await resetPointer(built.target).catch(() => undefined);
      }
    }

    if (scene.viewport) await page.setViewportSize({ width: 1440, height: 900 });
  }

  await prepareParityProbe(page);
  const pageEnvironment = (await callParityProbe(page, 'environment')) as Record<string, any>;
  const summary = summarize(ctx.rows, options);
  const byKind = (kind: ParityReportRow['kind']) => ctx.rows.filter((row) => row.kind === kind);
  const report = {
    schema: PROBE_SCHEMA,
    version: 1,
    client: 'web',
    state,
    commit: gitCommit(),
    fixturesSha256: parityContract().fixturesSha256,
    generatedAt: new Date().toISOString(),
    environment: {
      viewport: pageEnvironment.viewport,
      devicePixelRatio: pageEnvironment.devicePixelRatio,
      textScale: 1,
      locale: 'en',
      platform: process.platform === 'darwin' ? 'macOS' : process.platform,
      browser: pageEnvironment.userAgent,
      reducedMotion: pageEnvironment.reducedMotion,
      classicScrollbarGutter: pageEnvironment.classicScrollbarGutter,
    },
    screenshots: ctx.screenshots,
    measurements: byKind('metric').map(probeMeasurement),
    missing: [...ctx.missing.values()],
    orderChecks: byKind('order').map(probeListEntry),
    textChecks: byKind('text').map(probeListEntry),
    boxes: ctx.boxes,
    // Web probe extras (ignored by the comparator).
    probe: {
      baseURL: new URL(page.url()).origin,
      mode: options.includePending ? 'report' : 'enforce',
      strict: options.strict,
      wave: options.wave,
      canonicalScreenshot: relative(dir, screenshotPath),
      summary,
      unavailableScenes,
      fallbackIds: Object.fromEntries(
        [...ctx.fallbackIds].sort().map((id) => [id, PARITY_FALLBACK_SELECTORS[id]?.note ?? ''])
      ),
      iconContexts: byKind('icon').map(probeMeasurement),
    },
  };
  const reportPath = join(dir, `web-${state}.json`);

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { state, rows: ctx.rows, reportPath, screenshotPath, summary };
}

/** The rows that fail the build (enforced, or strict in-scope pending), formatted for an assertion message. */
export function blockingFailures(result: ParityStateResult, kind: ParityReportRow['kind']): string[] {
  return result.rows
    .filter((row) => row.kind === kind && row.blocking)
    .map(
      (row) =>
        `${row.check}${row.variant !== null ? `#${row.variant}` : ''} ${row.metric} [${row.scene}/${row.when}/${
          row.instance ?? row.instanceLabel ?? ''
        }]: expected ${JSON.stringify(row.expected)}, got ${JSON.stringify(row.actual)}${row.error ? ` (${row.error})` : ''}`
    );
}

export function reportExists(path: string) {
  return existsSync(path);
}
