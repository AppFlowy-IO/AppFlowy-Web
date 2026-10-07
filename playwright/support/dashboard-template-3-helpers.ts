/**
 * Helpers of the third set of dashboard template scenarios
 * (`dashboard-usecases/field-research`, `oncall-handbook` and
 * `saas-subscriptions`). They extend the use-case world of
 * `dashboard-usecase-helpers.ts` with views that need richer chart settings,
 * documents that embed a dashboard, the people who read them (a teammate, a
 * guest and an anonymous visitor of the published page) and the clean-up a
 * workspace goes through (trash, view and property changes, version history
 * and duplicates).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { APIRequestContext, APIResponse, BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { ChartAggregationType } from '../../src/application/database-yjs/chart-enums';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
  DASHBOARD_ROW_HEIGHT_SNAP,
} from '../../src/application/database-yjs/dashboard-geometry';
import { DateGroupCondition } from '../../src/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '../../src/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '../../src/application/database-yjs/fields/date/date.type';
import { AccessLevel, ViewLayout } from '../../src/application/types';

import { AIMeetingSelectors, areTestUtilitiesAvailable, injectAIMeetingBlock } from './ai-meeting-helpers';
import { waitForTypeOptionSync, writeTypeOptions } from './chart-render-helpers';
import { mockProSubscription } from './chart-test-helpers';
import {
  apiHeaders,
  equalRowWidths,
  parseJson,
  pressEscapeUntilHidden,
  readServerDatabaseDoc,
} from './dashboard-shared-helpers';
import {
  allWidgets,
  apiGet,
  apiPost,
  AuthSession,
  DashboardSelectors,
  dashboardWorld,
  DatabaseViewLayout,
  enterEditMode,
  FIELD_TYPE_BY_NAME,
  FieldType,
  fixtureDatabase,
  globalFilterChip,
  installDashboardTestBridge,
  leaveEditMode,
  memberPage,
  openDatabasePage,
  persistedRow,
  readDashboardSetting,
  readDatabaseViews,
  signBrowserInWithSession,
  signInFixtureAccount,
  waitForDashboardSync,
  WidgetMenuAction,
  widgetLocator,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import {
  activateDashboard,
  addUseCaseViews,
  chartNumber,
  chartTable,
  namedDashboard,
  namedView,
  namedWidget,
  relativeDayOffset,
  rememberFieldTypes,
  scenarioState,
  USE_CASE_TIMEOUT,
  UseCaseDashboard,
  waitForViewSync,
} from './dashboard-usecase-helpers';
import { acknowledgeDatabaseRestore } from './database-history-helpers';
import { duplicatePageByExactText } from './duplicate-test-helpers';
import { changeFieldTypeById } from './field-type-helpers';
import { expandSpaceByName, insertLinkedDatabaseViaSlash } from './page-utils';
import {
  BlockSelectors,
  DatabaseViewSelectors,
  HeaderSelectors,
  ShareSelectors,
  SlashCommandSelectors,
  TrashSelectors,
} from './selectors';
import { mockServerInfoPreservingCapabilities } from './server-info-helpers';
import { installRuntimeTestConfig, setupPageErrorHandling, TestConfig } from './test-config';

export const TEMPLATE_WAIT = { timeout: USE_CASE_TIMEOUT };
const FIXTURE_TIMEOUT = 45_000;
const FIXTURE_WAIT = { timeout: FIXTURE_TIMEOUT };

// ---------------------------------------------------------------------------
// Scenario memory
// ---------------------------------------------------------------------------

/** Someone else reading the scenario's pages in a browser of their own. */
interface Actor {
  email?: string;
  session?: AuthSession;
  context?: BrowserContext;
  page?: Page;
}

interface TemplateMemory {
  /** Document name → view id. */
  documents: Record<string, string>;
  /** The document the editing steps act on. */
  editing?: string;
  /** Dashboard views the scenario knows, so a new one (a copy) can be told apart. */
  knownDashboards: Set<string>;
  /** The dashboard view of the block the block menu's Duplicate made. */
  copiedBlockViewId?: string;
  guest?: Actor;
  guestSourceShared?: boolean;
  visitor?: Actor;
  /** How many widgets the visitor's page shows (checked again after a reload). */
  visitorWidgetCount?: number;
  /** Document name → published URL. */
  publishedUrls: Record<string, string>;
  /** Database name → the page id of its sidebar copy. */
  databaseCopies: Record<string, string>;
  savedVersion?: { database: string; name: string };
}

const memories = new WeakMap<Page, TemplateMemory>();

function templateMemory(page: Page): TemplateMemory {
  let memory = memories.get(page);

  if (!memory) {
    memory = { documents: {}, knownDashboards: new Set(), publishedUrls: {}, databaseCopies: {} };
    memories.set(page, memory);
  }

  return memory;
}

/** Close the browsers the guest and the visitor used. */
export async function closeTemplateActors(page: Page) {
  const memory = memories.get(page);

  if (!memory) return;
  for (const actor of [memory.guest, memory.visitor]) await actor?.context?.close().catch(() => undefined);
  memories.delete(page);
}

interface FolderChild {
  view_id: string;
  name: string;
  layout: number;
}

async function folderChildren(request: APIRequestContext, page: Page, parentViewId: string): Promise<FolderChild[]> {
  const world = dashboardWorld(page);
  const view = await apiGet<{ children?: FolderChild[] }>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/view/${parentViewId}?depth=1`
  );

  return view.children ?? [];
}

async function apiPut(request: APIRequestContext, token: string, path: string, data: unknown) {
  const started = Date.now();
  let response: APIResponse | undefined;

  try {
    response = await request.put(`${TestConfig.apiUrl}${path}`, {
      headers: apiHeaders(token),
      data: JSON.stringify(data),
      failOnStatusCode: false,
    });
    const text = await response.text();

    if (!response.ok() || parseJson<{ code?: number }>(text)?.code !== 0) {
      throw new Error(`API PUT ${path} failed: HTTP ${response.status()} ${text}`);
    }
  } catch (error) {
    // A fixture transport failure must stay distinct from the scenario's
    // permission assertion. Keep timing and status, never auth headers or
    // request bodies; the request itself is neither retried nor relaxed.
    await test
      .info()
      .attach('template-setup-put-failure', {
        contentType: 'application/json',
        body: JSON.stringify({
          method: 'PUT',
          path,
          elapsedMs: Date.now() - started,
          status: response?.status() ?? null,
          error: error instanceof Error ? error.message.split('\n')[0] : String(error).split('\n')[0],
        }),
      })
      .catch(() => undefined);
    throw error;
  }
}

/** The name the scenario gave a view id (its views and its dashboards), `?id` for a view it never named. */
function nameOfView(page: Page, viewId: string): string {
  const state = scenarioState(page);
  const view = Object.values(state.views).find((candidate) => candidate.viewId === viewId);

  return (
    view?.name ?? Object.values(state.dashboards).find((dashboard) => dashboard.viewId === viewId)?.name ?? `?${viewId}`
  );
}

/** Wait until `scope` renders `count` widgets and none of them is still loading. */
async function waitForWidgetsLoaded(scope: Page, count: number) {
  await expect(DashboardSelectors.widgets(scope)).toHaveCount(count, FIXTURE_WAIT);
  await expect(
    scope.getByTestId('dashboard-widget-placeholder').and(scope.locator('[data-reason="loading"]'))
  ).toHaveCount(0, FIXTURE_WAIT);
}

// ---------------------------------------------------------------------------
// Views with richer chart settings
// ---------------------------------------------------------------------------

interface ExtraFilter {
  property: string;
  fieldType: FieldType;
  condition: number;
}

interface ViewExtras {
  titleText?: string;
  dateCondition?: number;
  aggregationType?: number;
  filters: ExtraFilter[];
}

const DATE_GROUPS: Record<string, DateGroupCondition> = {
  day: DateGroupCondition.Day,
  week: DateGroupCondition.Week,
  month: DateGroupCondition.Month,
  year: DateGroupCondition.Year,
};

/**
 * Split a view's settings into what `parseViewSettings` reads and the parts
 * it does not: `, titled "T"` (the Number chart's custom title), `percent
 * checked of P` (a checkbox's share of checked rows), `by D per
 * day|week|month|year` (date buckets), and the `where` clauses `P is checked`,
 * `P is unchecked` and `P is next week`.
 */
export function splitChartSettings(settings: string): { base: string; extras: ViewExtras } {
  const extras: ViewExtras = { filters: [] };
  let rest = settings.trim();
  const titled = /,\s*titled\s+"([^"]*)"/.exec(rest);

  if (titled) {
    extras.titleText = titled[1];
    rest = rest.replace(titled[0], '');
  }

  const percent = /^percent checked of (.+?)(?=\s+by\s|\s+where\s|$)/.exec(rest);

  if (percent) {
    extras.aggregationType = ChartAggregationType.PercentChecked;
    rest = `sum of ${percent[1]}${rest.slice(percent[0].length)}`;
  }

  const perGroup = /\s+per (day|week|month|year)(?=\s+where\s|$)/.exec(rest);

  if (perGroup) {
    extras.dateCondition = DATE_GROUPS[perGroup[1]];
    rest = rest.replace(perGroup[0], '');
  }

  const whereIndex = rest.search(/(^|\s)where /);

  if (whereIndex !== -1) {
    const head = rest.slice(0, whereIndex).trim();
    const kept: string[] = [];

    rest
      .slice(whereIndex)
      .trim()
      .replace(/^where /, '')
      .split(' and ')
      .forEach((raw) => {
        const clause = raw.trim();
        const checkbox = /^(.+?) is (checked|unchecked)$/.exec(clause);
        const nextWeek = /^(.+?) is next week$/.exec(clause);

        if (checkbox) {
          extras.filters.push({
            property: checkbox[1],
            fieldType: FieldType.Checkbox,
            condition:
              checkbox[2] === 'checked' ? CheckboxFilterCondition.IsChecked : CheckboxFilterCondition.IsUnChecked,
          });
        } else if (nextWeek) {
          extras.filters.push({
            property: nextWeek[1],
            fieldType: FieldType.DateTime,
            condition: DateFilterCondition.DateStartsNextWeek,
          });
        } else {
          kept.push(clause);
        }
      });
    rest = kept.length > 0 ? `${head} where ${kept.join(' and ')}`.trim() : head;
  }

  return { base: rest.trim(), extras };
}

interface ViewPatch {
  viewId: string;
  titleText?: string;
  dateCondition?: number;
  aggregationType?: number;
  filters: { id: string; fieldId: string; fieldType: number; condition: number }[];
}

/** Add the filters and chart keys `addUseCaseViews` does not write; filters already there are kept once. */
async function writeViewPatches(page: Page, databaseId: string, patches: ViewPatch[]) {
  await page.evaluate(
    ({ databaseId, patches }) => {
      const win = window as any;
      const Yjs = win.Y;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const views = doc.getMap('data').get('database').get('views');

      doc.transact(() => {
        patches.forEach((patch: ViewPatch) => {
          const view = views.get(patch.viewId);

          if (patch.filters.length > 0) {
            let filters = view.get('filters');

            if (!filters) {
              filters = new Yjs.Array();
              view.set('filters', filters);
            }

            const existing = new Set(filters.toArray().map((filter: any) => filter.get('id')));

            patch.filters.forEach((spec) => {
              if (existing.has(spec.id)) return;
              const filter = new Yjs.Map();

              filter.set('id', spec.id);
              filter.set('field_id', spec.fieldId);
              filter.set('condition', spec.condition);
              filter.set('content', '');
              filter.set('ty', spec.fieldType);
              filter.set('filter_type', 2);
              filters.push([filter]);
            });
          }

          const chart = view.get('layout_settings')?.get('3');

          if (!chart) return;
          if (patch.dateCondition !== undefined) chart.set('date_condition', patch.dateCondition);
          if (patch.aggregationType !== undefined) chart.set('aggregation_type', patch.aggregationType);
          if (patch.titleText !== undefined) chart.set('titleText', patch.titleText);
        });
      });
    },
    { databaseId, patches }
  );
}

/**
 * `{string} has these views:` plus the settings of `splitChartSettings`: the
 * views are created with their base settings, then the rest is written in one
 * transaction and waited for on the server.
 */
export async function addViewsWithChartSettings(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const database = fixtureDatabase(page, databaseName);
  const parsed = rows.map((row) => ({ row, ...splitChartSettings(row.settings ?? '') }));

  await addUseCaseViews(
    page,
    request,
    databaseName,
    parsed.map(({ row, base }) => ({ ...row, settings: base }))
  );
  const patches: ViewPatch[] = parsed
    .filter(
      ({ extras }) =>
        extras.filters.length > 0 ||
        extras.titleText !== undefined ||
        extras.dateCondition !== undefined ||
        extras.aggregationType !== undefined
    )
    .map(({ row, extras }) => {
      const viewId = namedView(page, row.view.trim()).viewId;

      return {
        viewId,
        titleText: extras.titleText,
        dateCondition: extras.dateCondition,
        aggregationType: extras.aggregationType,
        filters: extras.filters.map((filter, index) => {
          const fieldId = database.fieldIds[filter.property];

          if (!fieldId) throw new Error(`"${databaseName}" has no "${filter.property}" property`);
          return {
            id: `t3-${viewId.slice(0, 8)}-${index}`,
            fieldId,
            fieldType: filter.fieldType,
            condition: filter.condition,
          };
        }),
      };
    });

  if (patches.length === 0) return;
  const write = () => writeViewPatches(page, database.databaseId, patches);

  await write();
  await waitForViewSync(
    page,
    request,
    databaseName,
    patches.map((patch) => patch.viewId),
    write
  );
}

/** `NumberFormat` ids (web `fields/number/number.type.ts`, desktop `NumberFormatPB`) by name. */
const NUMBER_FORMATS: Record<string, number> = { Number: 0, 'US dollar': 1, Euro: 4, Percent: 36 };

export async function setNumberFormat(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  property: string,
  formatName: string
) {
  const format = NUMBER_FORMATS[formatName];
  const database = fixtureDatabase(page, databaseName);
  const fieldId = database.fieldIds[property];

  if (format === undefined) throw new Error(`Unknown number format "${formatName}"`);
  if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
  await openDatabasePage(page, databaseName, database.views.Grid);
  const updates = [{ fieldId, type: FieldType.Number, entries: { format } }];

  await writeTypeOptions(page, database.databaseId, updates);
  await waitForTypeOptionSync(page, request, database.databaseId, updates);
}

// ---------------------------------------------------------------------------
// Chart values by year
// ---------------------------------------------------------------------------

/** The calendar year of `today ± N` (local time), as a Year bucket is labelled. */
function yearOfDay(text: string): string {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + relativeDayOffset(text));
  return String(date.getFullYear());
}

/** Every category of a date chart grouped per year, from its data table; `today ± N` names a year by one of its days. */
export async function expectValuesPerYear(page: Page, viewName: string, rows: Record<string, string>[]) {
  const widget = widgetLocator(page, viewName);
  const expected = Object.fromEntries(
    rows.map((row) => {
      const year = row.year.trim();

      return [/^today/.test(year) ? yearOfDay(year) : year, chartNumber(row.value)];
    })
  );

  await expect(widget.getByTestId('chart-data-table')).toBeAttached(TEMPLATE_WAIT);
  await expect
    .poll(async () => Object.fromEntries((await chartTable(widget)).map((row) => [row.label, row.value])), TEMPLATE_WAIT)
    .toEqual(expected);
}

// ---------------------------------------------------------------------------
// Rows, the widget menu and the add buttons
// ---------------------------------------------------------------------------

/** Press an arrow key on a row's height handle `times` times; each press moves the snapped height one step. */
export async function pressRowHeightKey(page: Page, rowIndex: number, key: string, times: number) {
  const step = key === 'ArrowUp' ? -DASHBOARD_ROW_HEIGHT_SNAP : key === 'ArrowDown' ? DASHBOARD_ROW_HEIGHT_SNAP : 0;

  if (step === 0) throw new Error(`The height handle moves with ArrowUp and ArrowDown, not "${key}"`);
  await enterEditMode(page);
  const row = await persistedRow(page, rowIndex);
  const handle = DashboardSelectors.heightHandle(page, row.id);
  let height = row.height;

  await DashboardSelectors.row(page, row.id).hover();
  await expect(handle).toBeAttached(TEMPLATE_WAIT);
  for (let press = 0; press < times; press += 1) {
    const snapped = Math.round((height + step) / DASHBOARD_ROW_HEIGHT_SNAP) * DASHBOARD_ROW_HEIGHT_SNAP;
    const next = Math.min(DASHBOARD_MAX_ROW_HEIGHT, Math.max(DASHBOARD_MIN_ROW_HEIGHT, snapped));

    await handle.press(key);
    // Saved, and rendered: the next press starts from the height the handle shows.
    await expect.poll(async () => (await persistedRow(page, rowIndex)).height, TEMPLATE_WAIT).toBe(next);
    await expect(handle).toHaveAttribute('aria-valuenow', String(next), TEMPLATE_WAIT);
    height = next;
  }
}

export async function expectWidgetMenuItemDisabled(page: Page, action: string) {
  const item = DashboardSelectors.widgetMenuItem(page, action as WidgetMenuAction);

  await expect(DashboardSelectors.widgetMenu(page)).toBeVisible(TEMPLATE_WAIT);
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('aria-disabled', 'true');
}

export async function hoverWidgetMenuItem(page: Page, action: string) {
  const item = DashboardSelectors.widgetMenuItem(page, action as WidgetMenuAction);

  await expect(item).toBeVisible(TEMPLATE_WAIT);
  await item.hover();
}

export async function closeWidgetMenu(page: Page) {
  await pressEscapeUntilHidden(page, DashboardSelectors.widgetMenu(page));
  await expect(DashboardSelectors.widgetMenu(page)).toHaveCount(0, TEMPLATE_WAIT);
}

/**
 * "Show widget titles" is off for the whole dashboard: it is saved so, and
 * every widget it holds shows the floating tool capsule instead of a title.
 */
export async function expectNoWidgetTitles(page: Page) {
  await expect.poll(async () => (await readDashboardSetting(page)).show_widget_titles, TEMPLATE_WAIT).toBe(false);
  const count = allWidgets(await readDashboardSetting(page)).length;
  const widgets = DashboardSelectors.widgets(page);

  expect(count, 'the dashboard holds widgets').toBeGreaterThan(0);
  await expect(widgets).toHaveCount(count, TEMPLATE_WAIT);
  await expect(widgets.filter({ has: page.getByTestId('dashboard-widget-tool-capsule') })).toHaveCount(
    count,
    TEMPLATE_WAIT
  );
  await expect(widgets.getByTestId('dashboard-widget-header')).toHaveCount(0);
  await expect(widgets.getByTestId('dashboard-widget-title')).toHaveCount(0);
}

/** A row's "Add to row" button is there but refused (the dashboard is full): `aria-disabled`, never hidden. */
export async function expectDisabledRowAddButton(page: Page, rowIndex: number) {
  const row = await persistedRow(page, rowIndex);
  const button = DashboardSelectors.addWidgetRowButton(page, row.id);

  await DashboardSelectors.row(page, row.id).hover();
  await expect(button).toHaveCount(1, TEMPLATE_WAIT);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
}

// ---------------------------------------------------------------------------
// Documents with an embedded dashboard
// ---------------------------------------------------------------------------

function documentId(page: Page, name: string): string {
  const viewId = templateMemory(page).documents[name];

  if (!viewId) throw new Error(`The scenario has no "${name}" document`);
  return viewId;
}

function editingDocument(page: Page): string {
  const name = templateMemory(page).editing;

  if (!name) throw new Error('No document is being edited');
  return name;
}

function documentEditor(scope: Page, viewId: string): Locator {
  return scope.locator(`#editor-${viewId}`);
}

function dashboardBlocks(page: Page, name: string): Locator {
  return documentEditor(page, documentId(page, name)).locator('[data-block-type="dashboard"]');
}

export async function createDocument(page: Page, request: APIRequestContext, name: string, space: string) {
  const world = dashboardWorld(page);

  // The use-case space is named after the use case.
  expect(space).toBe(world.spaceName);
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await apiPost<{ view_id: string }>(
        request,
        world.owner.accessToken,
        `/api/workspace/${world.workspaceId}/page-view`,
        { parent_view_id: world.spaceId, layout: ViewLayout.Document, name }
      );

      templateMemory(page).documents[name] = created.view_id;
      return;
    } catch (error) {
      // The folder projection of a new space can lag behind its creation.
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
    }
  }

  throw lastError;
}

/** Open a document in the owner's browser and make it the one the editing steps act on. */
export async function openDocument(page: Page, name: string) {
  const world = dashboardWorld(page);
  const viewId = documentId(page, name);

  await page.goto(`/app/${world.workspaceId}/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(documentEditor(page, viewId)).toBeVisible(FIXTURE_WAIT);
  templateMemory(page).editing = name;
  if (scenarioState(page).dashboards[name]) activateDashboard(page, name);
}

/** The dashboard view of `databaseName` the scenario has not seen yet (a block just linked or copied). */
async function newDashboardViewOf(page: Page, databaseName: string): Promise<string> {
  const databaseId = fixtureDatabase(page, databaseName).databaseId;
  const known = templateMemory(page).knownDashboards;
  let viewId = '';

  await expect
    .poll(
      async () => {
        viewId =
          (await readDatabaseViews(page, databaseId)).find(
            (view) => view.layout === DatabaseViewLayout.Dashboard && !known.has(view.id)
          )?.id ?? '';
        return viewId;
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for a new dashboard view of "${databaseName}"` }
    )
    .not.toBe('');
  known.add(viewId);
  return viewId;
}

/** A document's dashboard is addressed by the document's name. */
function registerDocumentDashboard(page: Page, name: string, viewId: string, host: string) {
  const dashboard: UseCaseDashboard = { name, viewId, host, widgets: {} };

  scenarioState(page).dashboards[name] = dashboard;
  templateMemory(page).knownDashboards.add(viewId);
  activateDashboard(page, name);
  return dashboard;
}

/** Link `databaseName` as a dashboard in the edited document through its slash menu (it opens in Edit mode, empty). */
export async function linkDashboardInDocument(page: Page, databaseName: string) {
  const name = editingDocument(page);
  const blocks = dashboardBlocks(page, name);
  const before = await blocks.count();

  await insertLinkedDatabaseViaSlash(page, documentId(page, name), databaseName, 'Dashboard');
  await expect(blocks).toHaveCount(before + 1, FIXTURE_WAIT);
  await expect(blocks.last().getByTestId('dashboard-view')).toBeVisible(FIXTURE_WAIT);
  registerDocumentDashboard(page, name, await newDashboardViewOf(page, databaseName), databaseName);
}

export async function expectDashboardBlockCount(page: Page, name: string, count: number) {
  const blocks = dashboardBlocks(page, name);

  await expect(blocks).toHaveCount(count, FIXTURE_WAIT);
  for (let index = 0; index < count; index += 1) {
    await expect(blocks.nth(index).getByTestId('dashboard-view')).toBeVisible(FIXTURE_WAIT);
  }
}

/**
 * Link `databaseName` as a dashboard in `name`, seed its rows (equal widths,
 * the default height) and leave Edit mode, as a reader would find it.
 */
export async function embedDashboardInDocument(
  page: Page,
  request: APIRequestContext,
  name: string,
  databaseName: string,
  layout: string[][]
) {
  await openDocument(page, name);
  await linkDashboardInDocument(page, databaseName);
  const dashboard = namedDashboard(page, name);
  const rows = layout.map((names) => {
    const widths = equalRowWidths(names.length);

    return {
      id: `r-${uuidv4().slice(0, 12)}`,
      height: DASHBOARD_DEFAULT_ROW_HEIGHT,
      widgets: names.map((viewName, index) => {
        const view = namedView(page, viewName);
        const widget = {
          id: `w-${uuidv4().slice(0, 12)}`,
          view_id: view.viewId,
          database_id: fixtureDatabase(page, view.database).databaseId,
          width: widths[index],
        };

        dashboard.widgets[viewName] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
        return widget;
      }),
    };
  });
  const count = rows.reduce((sum, row) => sum + row.widgets.length, 0);

  activateDashboard(page, name);
  await writeDashboardSetting(page, { rows, global_filters: [] });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, FIXTURE_WAIT);
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);
  await waitForWidgetsLoaded(page, count);
}

/**
 * Open a document; when it embeds a dashboard the scenario has not seen (the
 * copy of a page), that dashboard becomes the one the widget steps act on.
 */
export async function openDocumentWithDashboard(page: Page, name: string) {
  await openDocument(page, name);
  const blocks = dashboardBlocks(page, name);

  if ((await blocks.count()) === 0 || scenarioState(page).dashboards[name]) return;
  await expect(blocks.first().getByTestId('dashboard-view')).toBeVisible(FIXTURE_WAIT);
  const world = dashboardWorld(page);
  let found: { viewId: string; host: string } | undefined;

  // The block's dashboard is the view its database context shows (the widgets
  // mount contexts of their own layouts): a copied page embeds either a copy of
  // the dashboard view or, as the server's page duplicate does, the same one.
  await expect
    .poll(
      async () => {
        const mounted = await page.evaluate((dashboardLayout) => {
          const contexts: { databaseDoc?: { getMap: (name: string) => any }; activeViewId?: string }[] =
            (window as any).__DASHBOARD_TEST__?.contexts ?? [];

          for (let index = contexts.length - 1; index >= 0; index -= 1) {
            const { databaseDoc, activeViewId } = contexts[index];
            const database = databaseDoc?.getMap('data')?.get('database');
            const view = activeViewId ? database?.get('views')?.get(activeViewId) : undefined;

            if (view && Number(view.get('layout')) === dashboardLayout) {
              return { viewId: String(activeViewId), databaseId: String(database.get('id')) };
            }
          }

          return null;
        }, DatabaseViewLayout.Dashboard);
        const host = Object.values(world.databases).find((database) => database.databaseId === mounted?.databaseId);

        if (mounted && host) found = { viewId: mounted.viewId, host: host.name };
        return Boolean(found);
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the dashboard embedded in "${name}"` }
    )
    .toBe(true);
  if (!found) throw new Error(`"${name}" embeds no dashboard the scenario can find`);
  registerDocumentDashboard(page, name, found.viewId, found.host);
  await waitForWidgetsLoaded(page, allWidgets(await readDashboardSetting(page)).length);
}

/** Hover a block until the editor shows its controls (the drag handle opens the block menu, `+` adds below). */
async function hoverBlockControls(page: Page, block: Locator, control: Locator) {
  await expect(block).toBeVisible(TEMPLATE_WAIT);
  await expect
    .poll(async () => {
      const box = await block.boundingBox();

      if (box) await page.mouse.move(box.x + 24, box.y + 16);
      return control.isVisible();
    }, TEMPLATE_WAIT)
    .toBe(true);
}

async function chooseBlockMenuAction(page: Page, block: Locator, action: 'duplicate' | 'delete') {
  await hoverBlockControls(page, block, BlockSelectors.dragHandle(page));
  await BlockSelectors.dragHandle(page).click({ force: true });
  await expect(BlockSelectors.controlsMenu(page)).toBeVisible(TEMPLATE_WAIT);
  await BlockSelectors.controlsMenuAction(page, action).click({ force: true });
}

/** Duplicate the edited document's first dashboard block from its block menu; remember the copy's view. */
export async function duplicateDashboardBlock(page: Page) {
  const name = editingDocument(page);
  const blocks = dashboardBlocks(page, name);
  const before = await blocks.count();

  await chooseBlockMenuAction(page, blocks.first(), 'duplicate');
  await expect(blocks).toHaveCount(before + 1, FIXTURE_WAIT);
  templateMemory(page).copiedBlockViewId = await newDashboardViewOf(page, namedDashboard(page, name).host);
}

export async function deleteDashboardBlock(page: Page, oneBasedIndex: number) {
  const blocks = dashboardBlocks(page, editingDocument(page));
  const before = await blocks.count();

  await chooseBlockMenuAction(page, blocks.nth(oneBasedIndex - 1), 'delete');
  await expect(blocks).toHaveCount(before - 1, FIXTURE_WAIT);
}

/** The second block's rows as it renders them and as its own dashboard view saves them. */
export async function expectSecondBlockRows(page: Page, expected: string[][]) {
  const block = dashboardBlocks(page, editingDocument(page)).nth(1);
  const viewId = templateMemory(page).copiedBlockViewId;

  if (!viewId) throw new Error('No dashboard block was duplicated in this scenario');
  await expect(block.getByTestId('dashboard-view')).toBeVisible(FIXTURE_WAIT);
  await expect
    .poll(async () => {
      const ids = await block
        .getByTestId('dashboard-row')
        .evaluateAll((rows) =>
          rows.map((row) =>
            Array.from(row.querySelectorAll('[data-testid="dashboard-widget"]')).map(
              (widget) => widget.getAttribute('data-view-id') ?? ''
            )
          )
        );

      return ids.map((row) => row.map((id) => nameOfView(page, id)));
    }, TEMPLATE_WAIT)
    .toEqual(expected);
  await expect
    .poll(
      async () =>
        (
          await readDashboardSetting(page, viewId)
        ).rows.map((row) => row.widgets.map((widget) => nameOfView(page, widget.view_id))),
      TEMPLATE_WAIT
    )
    .toEqual(expected);
}

/** A view of a database is still in its doc, in the browser and on the server. */
export async function expectViewStillExists(
  page: Page,
  request: APIRequestContext,
  viewName: string,
  databaseName: string
) {
  const world = dashboardWorld(page);
  const view = namedView(page, viewName);
  const database = fixtureDatabase(page, databaseName);

  expect(view.database, `"${viewName}" is not a view of "${databaseName}"`).toBe(databaseName);
  await expect
    .poll(
      async () => (await readDatabaseViews(page, database.databaseId)).some((known) => known.id === view.viewId),
      TEMPLATE_WAIT
    )
    .toBe(true);
  const onServer = await readServerDatabaseDoc(
    request,
    { token: world.owner.accessToken, workspaceId: world.workspaceId },
    database.databaseId,
    (doc) => Boolean((doc?.get('views') as Y.Map<unknown> | undefined)?.get(view.viewId))
  );

  expect(onServer, `the server lost the "${viewName}" view`).toBe(true);
}

// ---------------------------------------------------------------------------
// Slash menus inside a simple table and an AI meeting block
// ---------------------------------------------------------------------------

/** `+` below the last dashboard block, a simple table from the slash menu, then `/` in its first cell. */
export async function typeSlashInSimpleTableCell(page: Page) {
  const name = editingDocument(page);
  const editor = documentEditor(page, documentId(page, name));
  const panel = SlashCommandSelectors.slashPanel(page);

  await hoverBlockControls(page, dashboardBlocks(page, name).last(), BlockSelectors.addButton(page));
  await BlockSelectors.addButton(page).click({ force: true });
  await expect(panel).toBeVisible(TEMPLATE_WAIT);
  await page.keyboard.type('table', { delay: 30 });
  const option = page.getByTestId('slash-menu-simpleTable');

  await expect(option).toBeVisible(TEMPLATE_WAIT);
  await option.click({ force: true });
  await expect(panel).toBeHidden(TEMPLATE_WAIT);
  const cell = editor.locator('td[data-row-index="0"][data-cell-index="0"]').first();

  await expect(cell).toBeVisible(TEMPLATE_WAIT);
  await cell.click({ force: true });
  await page.keyboard.type('/');
  await expect(panel).toBeVisible(TEMPLATE_WAIT);
}

const MEETING_NOTE = 'Follow up on the webhook retries';

/**
 * AI meeting blocks come from meeting recordings; a test injects one through
 * the editor test hooks, which only development builds expose.
 */
export async function addAIMeetingBlock(page: Page, name: string) {
  expect(name, 'the AI meeting block goes into the edited document').toBe(editingDocument(page));
  test.skip(
    !(await areTestUtilitiesAvailable(page)),
    'AI meeting blocks are injected through the editor test hooks of development builds'
  );
  await injectAIMeetingBlock(page, { title: 'Incident review', notes: MEETING_NOTE, showNotesDirectly: true });
  await expect(AIMeetingSelectors.block(page)).toBeVisible(TEMPLATE_WAIT);
}

/** A new line at the end of the meeting notes, then `/`. */
export async function typeSlashInMeetingNotes(page: Page) {
  const notes = page.locator('[data-block-type="ai_meeting_notes"]').first();

  await expect(notes).toBeVisible(TEMPLATE_WAIT);
  await notes.getByText(MEETING_NOTE).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible(TEMPLATE_WAIT);
}

// ---------------------------------------------------------------------------
// The Free plan
// ---------------------------------------------------------------------------

/**
 * Model a hosted server whose billing answers "no active plan". Development
 * builds turn the Pro gate off (`isDevelopmentOrTestEnvironment`), so there
 * the scenario is skipped; it runs against a production build.
 */
export async function useFreePlan(page: Page) {
  const developmentBuild = await page.evaluate(() => Boolean(document.querySelector('script[src*="/@vite/client"]')));

  test.skip(developmentBuild, 'Development builds turn the Pro gate off (isDevelopmentOrTestEnvironment)');
  await mockServerInfoPreservingCapabilities(page, { self_hosted: false });
  const noPlan = JSON.stringify({ code: 0, data: [], message: '' });

  // Routes added later win over the Pro mocks of the workspace fixture.
  await page.route('**/billing/api/v1/active-subscription/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: noPlan })
  );
  await page.route('**/billing/api/v1/subscriptions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: noPlan })
  );
}

/** A disabled slash option keeps its place; its wrapper shows why on hover. */
export async function expectSlashOptionDisabled(page: Page, command: string, reason: string) {
  const option = page.getByTestId(`slash-menu-${command}`);
  const tooltip = page.getByRole('tooltip').filter({ hasText: reason });

  await expect(option).toBeVisible(TEMPLATE_WAIT);
  await expect(option).toBeDisabled();
  // Start from no tooltip, so the one shown belongs to this option.
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0, TEMPLATE_WAIT);
  await option.locator('xpath=..').hover();
  await expect(tooltip).toBeVisible(TEMPLATE_WAIT);
}

// ---------------------------------------------------------------------------
// Teammates, guests and anonymous visitors
// ---------------------------------------------------------------------------

export type Persona = 'teammate' | 'guest' | 'visitor';

/** The page a persona reads the scenario's pages in. */
export function actorPage(page: Page, persona: Persona): Page {
  if (persona === 'teammate') return memberPage(page);
  const memory = templateMemory(page);
  const actor = persona === 'guest' ? memory.guest : memory.visitor;

  if (!actor?.page) throw new Error(`The ${persona} has not opened the page yet`);
  return actor.page;
}

async function signInActor(page: Page, session: AuthSession) {
  const browser = page.context().browser();

  if (!browser) throw new Error('The scenario page has no browser');
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 1440, height: 900 },
  });

  await installDashboardTestBridge(context);
  const actor = await context.newPage();

  setupPageErrorHandling(actor);
  await mockProSubscription(actor);
  await signBrowserInWithSession(actor, session);
  return { context, page: actor };
}

/** Invite a guest to one document only: a new account the document is shared with, read only. */
export async function inviteGuestToPage(page: Page, request: APIRequestContext, name: string) {
  const world = dashboardWorld(page);
  const email = `dashboard-guest-${uuidv4()}@appflowy.io`;
  const session = await signInFixtureAccount(request, email);

  await apiPut(request, world.owner.accessToken, `/api/sharing/workspace/${world.workspaceId}/view`, {
    view_id: documentId(page, name),
    emails: [email],
    access_level: AccessLevel.ReadOnly,
  });
  templateMemory(page).guest = { email, session };
  templateMemory(page).guestSourceShared = false;
}

/** Sharing an embedding page does not grant access to its source database. */
export async function shareGuestSourceDatabase(page: Page, request: APIRequestContext, name: string) {
  const world = dashboardWorld(page);
  const guest = templateMemory(page).guest;

  if (!guest?.email) throw new Error('Invite the guest to the page first');
  await apiPut(request, world.owner.accessToken, `/api/sharing/workspace/${world.workspaceId}/view`, {
    view_id: fixtureDatabase(page, name).pageId,
    emails: [guest.email],
    access_level: AccessLevel.ReadOnly,
  });
  templateMemory(page).guestSourceShared = true;
}

export async function expectGuestCannotReadDatabase(page: Page, request: APIRequestContext, name: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, name);
  const guest = templateMemory(page).guest;

  if (!guest?.session) throw new Error('The guest session is missing');
  const response = await request.get(
    `${TestConfig.apiUrl}/api/workspace/v1/${world.workspaceId}/collab/${database.databaseId}/json?collab_type=1`,
    { headers: apiHeaders(guest.session.accessToken) }
  );
  const payload = await response.json();

  expect(response.status(), 'permission denial must not be a server error').toBeLessThan(500);
  expect(typeof payload.code, 'the server returned a structured permission error').toBe('number');
  expect(payload.code, 'a page-only guest cannot fetch the source database').not.toBe(0);
  expect(payload.data, 'a denied request discloses no database data').toBeFalsy();
  for (const title of Object.keys(database.rowIds)) {
    await expect(actorPage(page, 'guest').locator('body')).not.toContainText(title);
  }
}

/** The teammate (the workspace member) or the guest opens a document in their own browser. */
export async function openDocumentAs(page: Page, persona: 'teammate' | 'guest', name: string) {
  const world = dashboardWorld(page);
  const actor = persona === 'teammate' ? world.member : templateMemory(page).guest;

  if (!actor?.session) throw new Error(`No ${persona} has been invited in this scenario`);
  if (!actor.page) Object.assign(actor, await signInActor(page, actor.session));
  const scope = actor.page as Page;
  const viewId = documentId(page, name);

  await scope.goto(`/app/${world.workspaceId}/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(documentEditor(scope, viewId)).toBeVisible(FIXTURE_WAIT);
  if (persona === 'guest' && !templateMemory(page).guestSourceShared) return;
  await expect(DashboardSelectors.view(scope)).toBeVisible(FIXTURE_WAIT);
  activateDashboard(page, name);
  await waitForWidgetsLoaded(scope, allWidgets(await readDashboardSetting(page)).length);
}

/** Readers get the widgets and nothing that edits the layout. */
export async function expectReadOnlyDashboard(scope: Page) {
  await expect(DashboardSelectors.view(scope)).toBeVisible(TEMPLATE_WAIT);
  await expect(DashboardSelectors.widgets(scope).first()).toBeVisible(TEMPLATE_WAIT);
  await expect(DashboardSelectors.editButton(scope)).toHaveCount(0);
  await expect(DashboardSelectors.doneButton(scope)).toHaveCount(0);
  await expect(DashboardSelectors.widthHandles(scope)).toHaveCount(0);
  await expect(DashboardSelectors.addWidgetButton(scope).filter({ visible: true })).toHaveCount(0);
}

export async function expectActorNumber(page: Page, persona: Persona, viewName: string, value: string) {
  await expect(namedWidget(actorPage(page, persona), page, viewName).getByTestId('number-chart-value')).toHaveText(
    value,
    TEMPLATE_WAIT
  );
}

/** Publish a document from its Share popover, as the owner does, and remember the published URL. */
export async function publishDocument(page: Page, name: string) {
  await openDocument(page, name);
  if (scenarioState(page).dashboards[name]) {
    // The embedded dashboard mounts its host database after the editor shows.
    await expect(DashboardSelectors.view(page)).toBeVisible(FIXTURE_WAIT);
    let widgetCount = 0;

    await expect
      .poll(
        async () => {
          try {
            widgetCount = allWidgets(await readDashboardSetting(page)).length;
            return true;
          } catch {
            return false;
          }
        },
        { timeout: FIXTURE_TIMEOUT, message: `waiting for the dashboard embedded in "${name}" to mount` }
      )
      .toBe(true);
    await waitForWidgetsLoaded(page, widgetCount);
  }

  // The sticky header can sit over the share button; a DOM click reaches it.
  await expect(ShareSelectors.shareButton(page)).toBeVisible(TEMPLATE_WAIT);
  await ShareSelectors.shareButton(page).evaluate((element: HTMLElement) => element.click());
  await expect(ShareSelectors.sharePopover(page)).toBeVisible(TEMPLATE_WAIT);
  await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled(TEMPLATE_WAIT);
  await ShareSelectors.publishConfirmButton(page).click({ force: true });
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible(FIXTURE_WAIT);
  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace, 'the publish panel shows a namespace').not.toBe('');
  expect(publishName, 'the publish panel shows a publish name').not.toBe('');
  templateMemory(page).publishedUrls[name] = `${new URL(page.url()).origin}/${namespace}/${publishName}`;
  await page.keyboard.press('Escape');
  await expect(ShareSelectors.sharePopover(page)).toBeHidden(TEMPLATE_WAIT);
}

/** Someone without an account opens the published page in a browser of their own. */
export async function openPublishedPageAsVisitor(page: Page, name: string) {
  const memory = templateMemory(page);
  const url = memory.publishedUrls[name];
  const browser = page.context().browser();

  if (!url) throw new Error(`"${name}" has not been published in this scenario`);
  if (!browser) throw new Error('The scenario page has no browser');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await installRuntimeTestConfig(context);
  const visitor = await context.newPage();

  setupPageErrorHandling(visitor);
  memory.visitor = { context, page: visitor };
  activateDashboard(page, name);
  memory.visitorWidgetCount = allWidgets(await readDashboardSetting(page)).length;
  await visitor.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(visitor)).toBeVisible(FIXTURE_WAIT);
  await waitForWidgetsLoaded(visitor, memory.visitorWidgetCount);
}

export async function reloadVisitorPage(page: Page) {
  const visitor = actorPage(page, 'visitor');

  await visitor.reload({ waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(visitor)).toBeVisible(FIXTURE_WAIT);
  await waitForWidgetsLoaded(visitor, templateMemory(page).visitorWidgetCount ?? 1);
}

// ---------------------------------------------------------------------------
// Trash, views and properties
// ---------------------------------------------------------------------------

/** Restore a trashed database from the Trash page, and wait until the server has it back. */
export async function restoreDatabaseFromTrash(page: Page, request: APIRequestContext, databaseName: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const rows = TrashSelectors.rows(page).filter({ hasText: databaseName });

  await TrashSelectors.sidebarTrashButton(page).click();
  await expect(page).toHaveURL(/\/app\/trash/, TEMPLATE_WAIT);
  await expect(TrashSelectors.table(page)).toBeVisible(TEMPLATE_WAIT);
  await expect(rows.first()).toBeVisible(TEMPLATE_WAIT);
  await rows.first().getByTestId('trash-restore-button').click();
  await expect(rows).toHaveCount(0, TEMPLATE_WAIT);
  await expect
    .poll(
      async () => {
        const trash = await apiGet<{ views?: { view_id: string }[] }>(
          request,
          world.owner.accessToken,
          `/api/workspace/${world.workspaceId}/trash`
        );

        return (trash.views ?? []).some((view) => view.view_id === database.pageId);
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for "${databaseName}" to leave the trash` }
    )
    .toBe(false);
}

/** Delete a view from the tab bar of its database (right-click › Delete), and wait for the server. */
export async function deleteDatabaseView(
  page: Page,
  request: APIRequestContext,
  viewName: string,
  databaseName: string
) {
  const world = dashboardWorld(page);
  const view = namedView(page, viewName);
  const database = fixtureDatabase(page, databaseName);
  const tab = DatabaseViewSelectors.viewTab(page, view.viewId);

  expect(view.database, `"${viewName}" is not a view of "${databaseName}"`).toBe(databaseName);
  await openDatabasePage(page, databaseName, view.viewId);
  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionDelete(page)).toBeVisible(TEMPLATE_WAIT);
  await DatabaseViewSelectors.tabActionDelete(page).click();
  await DatabaseViewSelectors.deleteViewConfirmButton(page).click();
  await expect(tab).toHaveCount(0, TEMPLATE_WAIT);
  await expect
    .poll(
      () =>
        readServerDatabaseDoc(
          request,
          { token: world.owner.accessToken, workspaceId: world.workspaceId },
          database.databaseId,
          (doc) => Boolean((doc?.get('views') as Y.Map<unknown> | undefined)?.get(view.viewId))
        ).catch(() => true),
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the server to delete the "${viewName}" view` }
    )
    .toBe(false);
}

async function browserFieldType(page: Page, databaseId: string, fieldId: string): Promise<number> {
  return page.evaluate(
    ({ databaseId, fieldId }) => {
      const field = (window as any).__DASHBOARD_TEST__
        ?.byDatabase(databaseId)
        ?.databaseDoc.getMap('data')
        .get('database')
        ?.get('fields')
        ?.get(fieldId);

      return field ? Number(field.get('ty')) : -1;
    },
    { databaseId, fieldId }
  );
}

/** Change a property's type from its column header menu, as a user does, and wait for the server. */
export async function changePropertyType(
  page: Page,
  request: APIRequestContext,
  property: string,
  databaseName: string,
  typeName: string
) {
  const world = dashboardWorld(page);
  const type = FIELD_TYPE_BY_NAME[typeName];
  const database = fixtureDatabase(page, databaseName);
  const fieldId = database.fieldIds[property];

  if (type === undefined) throw new Error(`Unknown property type "${typeName}"`);
  if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
  await openDatabasePage(page, databaseName, database.views.Grid);
  await expect(page.getByTestId(`grid-field-header-${fieldId}`).last()).toBeVisible(TEMPLATE_WAIT);
  await changeFieldTypeById(page, fieldId, type);
  await expect.poll(() => browserFieldType(page, database.databaseId, fieldId), TEMPLATE_WAIT).toBe(type);
  await expect
    .poll(
      () =>
        readServerDatabaseDoc(
          request,
          { token: world.owner.accessToken, workspaceId: world.workspaceId },
          database.databaseId,
          (doc) => Number((doc?.get('fields') as Y.Map<Y.Map<unknown>> | undefined)?.get(fieldId)?.get('ty') ?? -1)
        ).catch(() => -1),
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the server to retype "${property}"` }
    )
    .toBe(type);
}

/**
 * The filter is still saved with its mapping to `databaseName`, but the
 * mapped property no longer has the filter's type: the pill counts no usable
 * source and narrows nothing.
 */
export async function expectGlobalFilterUnusable(page: Page, name: string, databaseName: string) {
  const chip = globalFilterChip(page, name);
  const database = fixtureDatabase(page, databaseName);

  await expect(chip).toBeVisible(TEMPLATE_WAIT);
  await expect(chip).toHaveAttribute('data-source-count', '0', TEMPLATE_WAIT);
  await expect(chip).toHaveAttribute('data-active', 'false');
  const saved = (await readDashboardSetting(page)).global_filters.find((filter) => filter.name === name);

  expect(saved?.targets[database.databaseId], `the "${name}" filter no longer maps "${databaseName}"`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

const SAVED_VERSION_NAME = 'Before the quarterly clean-up';
/** The server reads these on history requests (`version-history-restore.spec.ts`). */
const HISTORY_CLIENT_HEADERS = { 'client-version': '0.18.10', 'x-platform': 'web' };

async function historyData<T>(response: APIResponse, operation: string): Promise<T> {
  const text = await response.text();
  const body = parseJson<{ code?: number; data?: T }>(text);

  if (!response.ok() || body?.code !== 0) throw new Error(`${operation} failed: HTTP ${response.status()} ${text}`);
  return body.data as T;
}

function historyModal(page: Page): Locator {
  return page.getByTestId('database-version-history-modal');
}

/** Save a named version of a database through the history API (as the server's snapshots do). */
export async function saveDatabaseVersion(page: Page, request: APIRequestContext, databaseName: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const headers = { ...HISTORY_CLIENT_HEADERS, Authorization: `Bearer ${world.owner.accessToken}` };
  const capabilities = await historyData<{ enable_database_history?: boolean }>(
    await request.get(`${TestConfig.apiUrl}/api/server-info`, { headers: HISTORY_CLIENT_HEADERS }),
    'Reading the server capabilities'
  );

  expect(capabilities.enable_database_history, 'database version history needs the server capability').toBe(true);
  const base = `${TestConfig.apiUrl}/api/workspace/${world.workspaceId}/database/${database.databaseId}`;

  await historyData(await request.get(`${base}/blob/generate`, { headers }), 'Generating the database snapshot source');
  await historyData<string>(
    await request.post(`${base}/history`, { headers, data: { name: SAVED_VERSION_NAME } }),
    'Saving a database version'
  );
  templateMemory(page).savedVersion = { database: databaseName, name: SAVED_VERSION_NAME };
}

/** Open the version history of the database whose page is open (its More menu). */
export async function openVersionHistory(page: Page, databaseName: string) {
  // The route names the page by its container or by the view it shows (a tab, a dashboard it hosts).
  const database = fixtureDatabase(page, databaseName);
  const hostedDashboardIds = Object.values(scenarioState(page).dashboards)
    .filter((dashboard) => dashboard.host === databaseName)
    .map((dashboard) => dashboard.viewId);
  const pageIds = [database.pageId, ...Object.values(database.views), ...hostedDashboardIds];

  expect(
    pageIds.some((id) => page.url().includes(id)),
    `the "${databaseName}" page is open (${page.url()})`
  ).toBe(true);
  // A dashboard tab shows no page actions in the top bar: open the history from the table tab, as a user does.
  if (!(await HeaderSelectors.moreActionsButton(page).isVisible())) {
    const gridTab = DatabaseViewSelectors.viewTab(page, database.views.Grid);

    await gridTab.click();
    await expect(gridTab).toHaveAttribute('data-state', 'active', TEMPLATE_WAIT);
  }

  await expect(HeaderSelectors.moreActionsButton(page)).toBeVisible(TEMPLATE_WAIT);
  await HeaderSelectors.moreActionsButton(page).click();
  await page.getByTestId('more-page-database-history').click();
  await expect(historyModal(page)).toBeVisible(TEMPLATE_WAIT);
}

/** Select the saved version and, when the preview has tabs, the view (a view or a dashboard) of that name. */
export async function previewSavedVersionView(page: Page, viewName: string) {
  const saved = templateMemory(page).savedVersion;
  const state = scenarioState(page);
  const viewId = state.views[viewName]?.viewId ?? state.dashboards[viewName]?.viewId;

  if (!saved) throw new Error('No database version was saved in this scenario');
  if (!viewId) throw new Error(`The scenario has no "${viewName}" view`);
  const history = historyModal(page);

  await history.getByTestId('database-history-version').filter({ hasText: saved.name }).first().click();
  const tab = history.getByTestId(`view-tab-${viewId}`);

  if ((await tab.count()) > 0 && (await tab.getAttribute('data-state')) !== 'active') await tab.click();
}

export async function expectHistoryDashboardPlaceholder(page: Page) {
  const history = historyModal(page);
  const placeholder = history.getByTestId('dashboard-history-placeholder');

  await expect(placeholder).toBeVisible(TEMPLATE_WAIT);
  await expect(placeholder).toContainText('Dashboards are not previewed in version history.');
  // Widgets mount live databases: none renders against the snapshot.
  await expect(history.getByTestId('dashboard-widget')).toHaveCount(0);
}

export async function restoreSavedVersion(page: Page) {
  const history = historyModal(page);

  await history.getByTestId('database-history-restore').click();
  await page.getByTestId('database-history-confirm-restore').click();
  await acknowledgeDatabaseRestore(page);
  await expect(history).toBeHidden(TEMPLATE_WAIT);
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/** Duplicate a page from its sidebar `···` menu and wait until the copy is in the use-case space. */
async function duplicateFromSidebar(page: Page, request: APIRequestContext, pageName: string): Promise<string> {
  const world = dashboardWorld(page);
  const copyName = `${pageName} (Copy)`;
  let copyId = '';

  await expandSpaceByName(page, world.spaceName);
  await duplicatePageByExactText(page, pageName);
  await expect
    .poll(
      async () => {
        copyId =
          (await folderChildren(request, page, world.spaceId)).find((child) => child.name === copyName)?.view_id ?? '';
        return copyId;
      },
      { timeout: 60_000, message: `waiting for "${copyName}"` }
    )
    .not.toBe('');
  return copyId;
}

export async function duplicateDocumentFromSidebar(page: Page, request: APIRequestContext, name: string) {
  const memory = templateMemory(page);

  documentId(page, name);
  memory.documents[`${name} (Copy)`] = await duplicateFromSidebar(page, request, name);
}

export async function duplicateDatabaseFromSidebar(page: Page, request: APIRequestContext, databaseName: string) {
  fixtureDatabase(page, databaseName);
  templateMemory(page).databaseCopies[databaseName] = await duplicateFromSidebar(page, request, databaseName);
}

async function databaseFields(page: Page, databaseId: string) {
  return page.evaluate((id) => {
    const fields = (window as any).__DASHBOARD_TEST__
      .byDatabase(id)
      .databaseDoc.getMap('data')
      .get('database')
      .get('fields');
    const entries: [string, any][] = Array.from(fields.entries());

    return entries.map(([fieldId, field]) => ({
      id: fieldId,
      name: String(field.get('name')),
      type: Number(field.get('ty')),
    }));
  }, databaseId);
}

/**
 * Open a dashboard of a database's sidebar copy. The copy becomes a fixture
 * database of its own ("<name> (Copy)"), and the dashboard's widgets are known
 * by their view names in whatever database they read (the copy's own views
 * once the copy is remapped, the original's until then).
 */
export async function openDashboardOfCopy(
  page: Page,
  request: APIRequestContext,
  dashboardName: string,
  databaseName: string
) {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const copyPageId = templateMemory(page).databaseCopies[databaseName];
  const copyName = `${databaseName} (Copy)`;
  let viewId = '';

  if (!copyPageId) throw new Error(`"${databaseName}" has not been duplicated in this scenario`);
  await expect
    .poll(
      async () => {
        viewId =
          (await folderChildren(request, page, copyPageId)).find(
            (child) => child.name === dashboardName && child.layout === ViewLayout.Dashboard
          )?.view_id ?? '';
        return viewId;
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the "${dashboardName}" dashboard of "${copyName}"` }
    )
    .not.toBe('');
  await page.goto(`/app/${world.workspaceId}/${copyPageId}?v=${viewId}`, { waitUntil: 'domcontentloaded' });
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toBeVisible(FIXTURE_WAIT);
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
  await expect(DashboardSelectors.view(page)).toBeVisible(FIXTURE_WAIT);
  let databaseId = '';

  await expect
    .poll(
      async () => {
        databaseId = await page.evaluate(
          (id) =>
            String(
              (window as any).__DASHBOARD_TEST__?.byView(id)?.databaseDoc.getMap('data').get('database')?.get('id') ?? ''
            ),
          viewId
        );
        return databaseId;
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the "${copyName}" database to mount` }
    )
    .not.toBe('');
  const fields = await databaseFields(page, databaseId);

  world.databases[copyName] = {
    name: copyName,
    spaceId: world.spaceId,
    pageId: copyPageId,
    databaseId,
    fieldIds: Object.fromEntries(fields.map((field) => [field.name, field.id])),
    rowIds: {},
    views: {},
  };
  rememberFieldTypes(
    page,
    copyName,
    fields.map((field) => ({ name: field.name, type: field.type as FieldType }))
  );
  const key = `${dashboardName} of ${copyName}`;
  const dashboard: UseCaseDashboard = { name: key, viewId, host: copyName, widgets: {} };
  const { rows } = await readDashboardSetting(page, viewId);

  for (const widget of rows.flatMap((row) => row.widgets)) {
    const source = Object.values(world.databases).find((database) => database.databaseId === widget.database_id);
    let name = '';

    if (!source) throw new Error(`A widget of the copy reads an unknown database ${widget.database_id}`);
    await expect
      .poll(
        async () => {
          name =
            (await readDatabaseViews(page, widget.database_id)).find((view) => view.id === widget.view_id)?.name ?? '';
          return name;
        },
        { timeout: FIXTURE_TIMEOUT, message: `waiting for the view of widget ${widget.id}` }
      )
      .not.toBe('');
    dashboard.widgets[name] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
    if (!Object.values(state.views).some((view) => view.viewId === widget.view_id)) {
      state.views[`${name} (${copyName})`] = {
        name,
        viewId: widget.view_id,
        database: source.name,
        layout: state.views[name]?.layout ?? '',
      };
    }

    world.viewsByName = { ...world.viewsByName, [name]: { viewId: widget.view_id, database: source.name } };
  }

  state.dashboards[key] = dashboard;
  activateDashboard(page, key);
  await waitForWidgetsLoaded(
    page,
    rows.reduce((sum, row) => sum + row.widgets.length, 0)
  );
}
