/**
 * Template scenarios, set 4: the personal Life OS "Today" dashboard, the
 * training and body log, and the HR headcount dashboard on the
 * 5000-employee database (`dashboard-usecases/life-os.feature`,
 * `training-log.feature`, `hr-headcount.feature`).
 *
 * The scenarios build on the use-case world (`dashboard-usecase-helpers.ts`).
 * This module adds what those templates need beyond it:
 *
 * - a wider view-settings language (`parseTemplateView`): the aggregations
 *   of WP11 (`average of`, `min of`, `percent checked of`, ...), date
 *   grouping (`by Date per week`), the Number card's format and title
 *   (`, shown as compact`, `, titled "..."`), checkbox conditions
 *   (`where Done is checked`), select conditions on databases whose option
 *   ids are not the use-case named ids (the employees fixture), and the Feed
 *   layout;
 * - global filters with any condition, mapped across sources;
 * - the Free plan, the phone, the cold open with its load counters, the
 *   feed widget and the record checkbox;
 * - the 5000-employee database as a use-case database, seeded once per
 *   worker (seeding takes minutes) and restored before every scenario.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { execFileSync } from 'node:child_process';

import { APIRequestContext, CDPSession, expect, Locator, Page, TestInfo } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { ChartAggregationType, ChartType } from '../../src/application/database-yjs/chart-enums';
import { formatChartDateLabel } from '../../src/application/database-yjs/chart-config/date-labels';
import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { DateGroupCondition, SortCondition } from '../../src/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '../../src/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '../../src/application/database-yjs/fields/date/date.type';
import { SelectOptionFilterCondition } from '../../src/application/database-yjs/fields/select-option/select_option.type';
import { ViewLayout } from '../../src/application/types';

import { closeDockedPicker, newWidgetRecord } from './dashboard-add-widget-helpers';
import { loadStats, SourceRequestRecorder } from './dashboard-loading-helpers';
import { tabBarViewIds } from './dashboard-owned-views-helpers';
import { clearCachedDatabaseStorage, escapeRegExp } from './dashboard-shared-helpers';
import {
  apiGet,
  chooseGlobalFilterCondition,
  closeGlobalFilterMenu,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  dashboardWorld,
  databaseForLabel,
  DatabaseViewLayout,
  FieldSpec,
  FieldType,
  fixtureDatabase,
  FixtureDatabase,
  globalFilterChip,
  openDatabasePage,
  openGlobalFilterChip,
  openWidgetPicker,
  readDashboardSetting,
  readDatabaseViews,
  signBrowserInWithSession,
  signInFixtureAccount,
  splitList,
  waitForDashboardSync,
  widgetLocator,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import {
  activateDashboard,
  addUseCaseDatabase,
  chartTable,
  chooseFilterCondition,
  configureView,
  donutTotal,
  finishGlobalFilter,
  parseViewSettings,
  pickCalendarDay,
  relativeDayOffset,
  rememberFieldTypes,
  rememberSelectOptions,
  rowPage,
  scenarioState,
  startGlobalFilter,
  USE_CASE_TIMEOUT,
  ViewConfig,
  ViewFilterSpec,
  waitForViewSync,
} from './dashboard-usecase-helpers';
import {
  EMPLOYEE_FIELDS,
  expectEmployeesOnServer,
  loadEmployeesFixture,
  seedEmployeesDatabase,
} from './employees-database';
import { DatabaseViewSelectors } from './selectors';
import { grantWorkspaceProSubscription } from './subscription-test-helpers';

const WAIT = { timeout: USE_CASE_TIMEOUT };

/** Loading every row of the 5000-employee database, or a cold dashboard over four databases. */
export const LARGE_LOAD_TIMEOUT_MS = 300_000;
/** Seeding the 5000-employee database once per worker takes minutes. */
export const EMPLOYEES_SEED_TIMEOUT_MS = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// Views: the wider settings language
// ---------------------------------------------------------------------------

interface TemplateLayout {
  folderLayout: ViewLayout;
  databaseLayout: DatabaseViewLayout;
  chartType?: ChartType;
}

/** The use-case layouts plus Feed (`dashboard-usecase-helpers.ts` `LAYOUTS` has no Feed). */
const TEMPLATE_LAYOUTS: Record<string, TemplateLayout> = {
  Grid: { folderLayout: ViewLayout.Grid, databaseLayout: DatabaseViewLayout.Grid },
  Board: { folderLayout: ViewLayout.Board, databaseLayout: DatabaseViewLayout.Board },
  Calendar: { folderLayout: ViewLayout.Calendar, databaseLayout: DatabaseViewLayout.Calendar },
  List: { folderLayout: ViewLayout.List, databaseLayout: DatabaseViewLayout.List },
  Gallery: { folderLayout: ViewLayout.Gallery, databaseLayout: DatabaseViewLayout.Gallery },
  Timeline: { folderLayout: ViewLayout.Timeline, databaseLayout: DatabaseViewLayout.Timeline },
  Feed: { folderLayout: ViewLayout.Feed, databaseLayout: DatabaseViewLayout.Feed },
  'Bar chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: ChartType.Bar },
  'Horizontal bar chart': {
    folderLayout: ViewLayout.Chart,
    databaseLayout: DatabaseViewLayout.Chart,
    chartType: ChartType.HorizontalBar,
  },
  'Line chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: ChartType.Line },
  'Donut chart': {
    folderLayout: ViewLayout.Chart,
    databaseLayout: DatabaseViewLayout.Chart,
    chartType: ChartType.Donut,
  },
  'Number chart': {
    folderLayout: ViewLayout.Chart,
    databaseLayout: DatabaseViewLayout.Chart,
    chartType: ChartType.Number,
  },
};

/** The Calculate menu's names (WP11 §1.14), lower-cased as the settings column writes them. */
const AGGREGATIONS: Record<string, ChartAggregationType> = {
  sum: ChartAggregationType.Sum,
  average: ChartAggregationType.Average,
  min: ChartAggregationType.Min,
  max: ChartAggregationType.Max,
  median: ChartAggregationType.Median,
  'percent checked': ChartAggregationType.PercentChecked,
  'percent unchecked': ChartAggregationType.PercentUnchecked,
};

const DATE_GROUPS: Record<string, DateGroupCondition> = {
  day: DateGroupCondition.Day,
  week: DateGroupCondition.Week,
  month: DateGroupCondition.Month,
  year: DateGroupCondition.Year,
};

/**
 * `count`, or `<aggregation> of <property>`; then ` by <property>` with an
 * optional ` per day|week|month|year`; then `, shown as compact|percent`
 * (the Number card's format) and `, titled "<caption>"` (its custom title).
 */
const CHART_SETTINGS =
  /^(?:count|(sum|average|min|max|median|percent checked|percent unchecked) of (.+?))(?: by (.+?)(?: per (day|week|month|year))?)?(?:, shown as (compact|percent))?(?:, titled "(.*)")?$/;

/** Chart settings the use-case `configureView` does not write (it always groups dates by month). */
export interface TemplateChartExtras {
  dateCondition?: DateGroupCondition;
  numberFormat?: 'compact' | 'percent';
  titleText?: string;
}

export interface TemplateViewSpec {
  name: string;
  layoutName: string;
  layout: TemplateLayout;
  config: ViewConfig;
  extras: TemplateChartExtras;
}

/** A property of a database as the browser's doc holds it: its id, type and select options. */
export interface DocField {
  id: string;
  name: string;
  type: number;
  isPrimary: boolean;
  options: { id: string; name: string }[];
}

/** The properties of an open database by name ("Name" is the primary property). */
export async function readDocFields(page: Page, databaseId: string): Promise<Record<string, DocField>> {
  const fields: DocField[] = await page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const database = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database');
    const entries: [string, any][] = Array.from(database?.get('fields')?.entries() ?? []);
    const optionsOf = (field: any, type: number) => {
      const raw = field.get('type_option')?.get(String(type))?.get('content');
      const content = typeof raw === 'string' ? (raw ? JSON.parse(raw) : {}) : raw?.toJSON?.() ?? raw ?? {};

      return ((content?.options ?? []) as { id: string; name: string }[]).map((option) => ({
        id: option.id,
        name: option.name,
      }));
    };

    return entries.map(([fieldId, field]) => {
      const type = Number(field.get('ty'));

      return {
        id: fieldId,
        name: String(field.get('name') ?? ''),
        type,
        isPrimary: Boolean(field.get('is_primary')),
        options: type === 3 || type === 4 ? optionsOf(field, type) : [],
      };
    });
  }, databaseId);

  if (fields.length === 0) throw new Error(`The browser has no open database ${databaseId}`);
  const byName: Record<string, DocField> = {};

  fields.forEach((field) => {
    byName[field.name] = field;
    if (field.isPrimary) byName.Name = field;
  });
  return byName;
}

function docField(fields: Record<string, DocField>, databaseName: string, property: string): DocField {
  const field = fields[property.trim()];

  if (!field) throw new Error(`"${databaseName}" has no "${property}" property`);
  return field;
}

function optionIds(field: DocField, databaseName: string, list: string): string {
  return splitList(list)
    .map((name) => {
      const option = field.options.find((candidate) => candidate.name === name);

      if (!option) throw new Error(`"${field.name}" of "${databaseName}" has no "${name}" option`);
      return option.id;
    })
    .join(',');
}

/**
 * `where` clauses joined with ` and `. Checkbox (`is checked|unchecked`) and
 * select clauses (`is X`, `is not X`, `is empty`, by option name) are read
 * here; dates and text go to the use-case parser, which knows them.
 */
function parseTemplateWhere(
  page: Page,
  databaseName: string,
  fields: Record<string, DocField>,
  where: string
): ViewFilterSpec[] {
  return where.split(' and ').flatMap((clause) => {
    const trimmed = clause.trim();
    const match = /^(.+?) is (.+)$/.exec(trimmed);

    if (!match) throw new Error(`Cannot read the filter "${trimmed}"`);
    const [, property, value] = match;
    const field = docField(fields, databaseName, property);
    const filter = (condition: number, content = ''): ViewFilterSpec => ({
      fieldId: field.id,
      fieldType: field.type as FieldType,
      condition,
      content,
    });

    if (field.type === FieldType.Checkbox) {
      if (value === 'checked') return [filter(CheckboxFilterCondition.IsChecked)];
      if (value === 'unchecked') return [filter(CheckboxFilterCondition.IsUnChecked)];
      throw new Error(`A checkbox filter is "checked" or "unchecked", got "${trimmed}"`);
    }

    if (field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect) {
      if (value === 'empty') return [filter(SelectOptionFilterCondition.OptionIsEmpty)];
      const not = /^not (.+)$/.exec(value);

      if (not) return [filter(SelectOptionFilterCondition.OptionIsNot, optionIds(field, databaseName, not[1]))];
      return [filter(SelectOptionFilterCondition.OptionIs, optionIds(field, databaseName, value))];
    }

    return parseViewSettings(page, databaseName, 'Grid', `where ${trimmed}`).filters;
  });
}

/** One row of a `"…" has these views:` table, in the wider language. */
export function parseTemplateView(
  page: Page,
  databaseName: string,
  fields: Record<string, DocField>,
  row: Record<string, string>
): TemplateViewSpec {
  const name = row.view.trim();
  const layoutName = row.layout.trim();
  const layout = TEMPLATE_LAYOUTS[layoutName];

  if (!layout) throw new Error(`Unknown view layout "${layoutName}"`);
  let rest = (row.settings ?? '').trim();
  let filters: ViewFilterSpec[] = [];
  const whereIndex = rest.search(/(^|\s)where /);

  if (whereIndex !== -1) {
    filters = parseTemplateWhere(
      page,
      databaseName,
      fields,
      rest
        .slice(whereIndex)
        .trim()
        .replace(/^where /, '')
    );
    rest = rest.slice(0, whereIndex).trim();
  }

  if (layout.chartType !== undefined) {
    const match = CHART_SETTINGS.exec(rest);

    if (!match) throw new Error(`Cannot read the chart settings "${row.settings}" of "${name}"`);
    const [, aggregation, yProperty, xProperty, per, shownAs, title] = match;

    if (layout.chartType !== ChartType.Number && !xProperty) {
      throw new Error(`"${layoutName}" needs "by <property>": "${row.settings}"`);
    }

    if (per && docField(fields, databaseName, xProperty).type !== FieldType.DateTime) {
      throw new Error(`"per ${per}" groups a date property, not "${xProperty}"`);
    }

    return {
      name,
      layoutName,
      layout,
      config: {
        layout: DatabaseViewLayout.Chart,
        filters,
        sorts: [],
        chart: {
          chartType: layout.chartType,
          xFieldId: xProperty ? docField(fields, databaseName, xProperty).id : '',
          aggregationType: aggregation ? AGGREGATIONS[aggregation] : ChartAggregationType.Count,
          yFieldId: yProperty ? docField(fields, databaseName, yProperty).id : '',
        },
      },
      extras: {
        dateCondition: per ? DATE_GROUPS[per] : undefined,
        numberFormat: shownAs as TemplateChartExtras['numberFormat'],
        titleText: title,
      },
    };
  }

  if (layout.databaseLayout === DatabaseViewLayout.Feed) {
    if (rest) throw new Error(`A Feed view takes only "where" settings, got "${row.settings}"`);
    return { name, layoutName, layout, config: { layout: DatabaseViewLayout.Feed, filters, sorts: [] }, extras: {} };
  }

  const config = parseViewSettings(page, databaseName, layoutName, rest);

  return { name, layoutName, layout, config: { ...config, filters: [...config.filters, ...filters] }, extras: {} };
}

/** Write the chart settings `configureView` leaves at their defaults. */
async function writeChartExtras(page: Page, databaseId: string, viewId: string, extras: TemplateChartExtras) {
  if (extras.dateCondition === undefined && !extras.numberFormat && extras.titleText === undefined) return;
  await page.evaluate(
    ({ databaseId, viewId, extras }) => {
      const doc = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const chart = doc.getMap('data').get('database').get('views').get(viewId).get('layout_settings').get('3');

      doc.transact(() => {
        if (extras.dateCondition !== undefined) chart.set('date_condition', extras.dateCondition);
        if (extras.numberFormat) chart.set('numberFormat', extras.numberFormat);
        if (extras.titleText !== undefined) chart.set('titleText', extras.titleText);
      });
    },
    { databaseId, viewId, extras }
  );
}

/**
 * Turn a created view into a Feed the way the web's Feed creation does
 * (`normalizeCreatedDatabaseFeedView`): no grouping, only the primary
 * property shown on the cards, a Created time descending sort when the
 * database has a Created time property (`ensureFeedDefaultSort`; without one
 * the Feed shows the newest rows first by itself), and the Feed layout.
 */
async function makeFeedView(page: Page, databaseId: string, viewId: string) {
  await page.evaluate(
    ({ databaseId, viewId, createdTime, descending, feedLayout }) => {
      const win = window as any;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(viewId);
      const fields = database.get('fields');
      const ordered: string[] = [];

      (view.get('field_orders')?.toArray() ?? []).forEach((order: { id: string }) => {
        if (fields.has(order.id) && !ordered.includes(order.id)) ordered.push(order.id);
      });
      Array.from(fields.keys() as Iterable<string>).forEach((fieldId) => {
        if (!ordered.includes(fieldId)) ordered.push(fieldId);
      });
      const createdTimeId = ordered.find((fieldId) => Number(fields.get(fieldId)?.get('ty')) === createdTime);

      doc.transact(() => {
        const groups = view.get('groups');
        const settings = new win.Y.Map();

        if (groups?.length) groups.delete(0, groups.length);
        ordered.forEach((fieldId) => {
          const setting = new win.Y.Map();

          // FieldVisibility: AlwaysShown 0, AlwaysHidden 2.
          setting.set('visibility', fields.get(fieldId)?.get('is_primary') ? 0 : 2);
          setting.set('wrap', false);
          settings.set(fieldId, setting);
        });
        view.set('field_settings', settings);
        if (createdTimeId && !(view.get('sorts')?.length > 0)) {
          let sorts = view.get('sorts');

          if (!sorts) {
            sorts = new win.Y.Array();
            view.set('sorts', sorts);
          }

          const sort = new win.Y.Map();

          sort.set('id', Math.random().toString(36).slice(2, 8));
          sort.set('field_id', createdTimeId);
          sort.set('condition', descending);
          sorts.push([sort]);
        }

        view.set('layout', feedLayout);
      });
    },
    {
      databaseId,
      viewId,
      createdTime: FieldType.CreatedTime,
      descending: SortCondition.Descending,
      feedLayout: DatabaseViewLayout.Feed,
    }
  );
}

async function applyTemplateView(page: Page, databaseId: string, viewId: string, spec: TemplateViewSpec) {
  await configureView(page, databaseId, viewId, spec.config);
  await writeChartExtras(page, databaseId, viewId, spec.extras);
  if (spec.layout.databaseLayout === DatabaseViewLayout.Feed) await makeFeedView(page, databaseId, viewId);
}

/** Retry a create the server refuses while its folder projection catches up (`"code":-5`). */
async function retryTransient<T>(label: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!String((error as Error).message ?? '').includes('"code":-5')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
    }
  }

  throw new Error(`${label} kept failing: ${(lastError as Error)?.message}`);
}

/**
 * `"…" has these views:` in the wider language: each view is created as a
 * tab of the database (after the last one, like the use-case views), its
 * settings written in one transaction, and the step returns once the server
 * holds them.
 */
export async function addTemplateViews(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const database = fixtureDatabase(page, databaseName);

  await openDatabasePage(page, databaseName, database.views.Grid);
  const fields = await readDocFields(page, database.databaseId);
  const created: { viewId: string; spec: TemplateViewSpec }[] = [];

  for (const row of rows) {
    const spec = parseTemplateView(page, databaseName, fields, row);
    const viewId = await retryTransient(`Creating the "${spec.name}" view`, () =>
      createDatabaseViewThroughApi(page, request, {
        database: databaseName,
        name: spec.name,
        folderLayout: spec.layout.folderLayout,
        prevViewId: state.lastViewIds[databaseName],
      })
    );

    state.lastViewIds[databaseName] = viewId;
    await applyTemplateView(page, database.databaseId, viewId, spec);
    created.push({ viewId, spec });
    state.views[spec.name] = { name: spec.name, viewId, database: databaseName, layout: spec.layoutName };
    world.viewsByName = { ...world.viewsByName, [spec.name]: { viewId, database: databaseName } };
  }

  await waitForViewSync(
    page,
    request,
    databaseName,
    created.map(({ viewId }) => viewId),
    async () => {
      for (const { viewId, spec } of created) await applyTemplateView(page, database.databaseId, viewId, spec);
    }
  );
}

// ---------------------------------------------------------------------------
// Chart content
// ---------------------------------------------------------------------------

/** `day of today - 2`, `week of today`, `month of today + 1` → the chart's label of that bucket (en-US). */
export function resolveChartLabel(label: string): string {
  const match = /^(day|week|month|year) of (today.*)$/.exec(label.trim());

  if (!match) return label.trim();
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + relativeDayOffset(match[2]));
  // Weeks start on Monday (WP11 group keys).
  if (match[1] === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = String(date.getFullYear());
  const month = `${year}-${pad(date.getMonth() + 1)}`;
  const day = `${month}-${pad(date.getDate())}`;
  const keys: Record<string, [string, DateGroupCondition]> = {
    day: [day, DateGroupCondition.Day],
    week: [day, DateGroupCondition.Week],
    month: [month, DateGroupCondition.Month],
    year: [year, DateGroupCondition.Year],
  };
  const [key, condition] = keys[match[1]];

  return formatChartDateLabel(key, condition, 'en-US', 'Week of {} - {}');
}

/** Category → the value as the chart prints it (its tooltip text, from the hidden data table). */
export async function printedChartValues(widget: Locator): Promise<Record<string, string>> {
  return widget.evaluate((element) =>
    Object.fromEntries(
      Array.from(element.querySelectorAll('[data-testid="chart-data-table"] tr[data-label]')).map((row) => [
        row.getAttribute('data-label') ?? '',
        (row.querySelector('td')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ])
    )
  );
}

export async function expectPrintedChartValues(page: Page, view: string, rows: Record<string, string>[]) {
  const widget = widgetLocator(page, view);
  const expected = Object.fromEntries(rows.map((row) => [resolveChartLabel(row.label), row.value.trim()]));

  await expect(widget.getByTestId('chart-data-table')).toBeAttached(WAIT);
  await expect.poll(() => printedChartValues(widget), WAIT).toEqual(expected);
}

/**
 * Every row of the chart's database is counted: a donut's total, or the sum
 * of a count chart's categories. Charts count a row once its document has
 * loaded, so this waits for the whole database.
 */
export async function expectChartCountsAllRows(page: Page, view: string, count: number) {
  const widget = widgetLocator(page, view);

  await expect(widget).toBeVisible(WAIT);
  await expect
    .poll(
      async () => {
        if ((await widget.locator('.recharts-pie').count()) > 0) {
          return Number(await donutTotal(widget).getAttribute('data-value'));
        }

        return (await chartTable(widget)).reduce((sum, row) => sum + row.value, 0);
      },
      { timeout: LARGE_LOAD_TIMEOUT_MS, message: `waiting for "${view}" to count all ${count} rows` }
    )
    .toBe(count);
}

export async function expectChartShowsNoData(page: Page, view: string) {
  const state = widgetLocator(page, view).getByTestId('chart-no-data');

  await expect(state).toBeVisible(WAIT);
  await expect(state).toContainText('No data');
}

// ---------------------------------------------------------------------------
// Feed and grid widgets, the record page
// ---------------------------------------------------------------------------

const FEED_POST_TITLES = '[data-testid^="feed-card-"][data-row-id]:not([hidden]) [data-testid^="feed-card-title-"]';

export async function feedPostTitles(widget: Locator): Promise<string[]> {
  return (await widget.locator(FEED_POST_TITLES).allTextContents()).map((title) => title.trim());
}

export async function expectFeedPosts(page: Page, view: string, titles: string[]) {
  const widget = widgetLocator(page, view);

  await expect(widget.getByTestId('database-feed')).toBeVisible(WAIT);
  await expect.poll(async () => (await feedPostTitles(widget)).sort(), WAIT).toEqual([...titles].sort());
}

export async function expectNoFeedPosts(page: Page, view: string) {
  const widget = widgetLocator(page, view);

  await expect(widget.getByTestId('feed-empty')).toBeVisible(WAIT);
  expect(await feedPostTitles(widget)).toEqual([]);
}

/**
 * A grid widget lists `count` rows (its virtualized grid's row count) and
 * shows `first` at the top, in that order.
 */
export async function expectGridRowsStartingWith(page: Page, view: string, count: number, first: string[]) {
  const widget = widgetLocator(page, view);
  const grid = widget.getByTestId('database-grid');
  const primaryId = fixtureDatabase(page, databaseForLabel(page, view)).fieldIds.Name;

  await expect(grid).toHaveAttribute('data-row-count', String(count), { timeout: LARGE_LOAD_TIMEOUT_MS });
  await expect
    .poll(
      () =>
        grid.evaluate(
          (element, { primaryId, take }) =>
            Array.from(element.querySelectorAll('[data-testid^="grid-row-"]'))
              .filter((row) => row.getAttribute('data-testid') !== 'grid-row-undefined')
              .map((row) => {
                const rowId = (row.getAttribute('data-testid') ?? '').replace('grid-row-', '');
                const cell = row.querySelector(`[data-testid="grid-cell-${rowId}-${primaryId}"]`);

                return { top: row.getBoundingClientRect().top, title: (cell?.textContent ?? '').trim() };
              })
              .sort((a, b) => a.top - b.top)
              .slice(0, take)
              .map((row) => row.title),
          { primaryId, take: first.length }
        ),
      WAIT
    )
    .toEqual(first);
}

/** Tick a checkbox property on the open record page (revealing hidden properties first, as a user would). */
export async function tickRecordCheckbox(page: Page, property: string) {
  const dialog = rowPage(page);

  await expect(dialog).toBeVisible(WAIT);
  const label = dialog
    .locator('.property-label')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(property)}\\s*$`) })
    .first();
  const showHidden = dialog.getByRole('button', { name: /^Show \d+ hidden fields?$/ });

  await expect(label.or(showHidden).first()).toBeVisible(WAIT);
  if (!(await label.isVisible())) await showHidden.click();
  await expect(label).toBeVisible(WAIT);
  const checkbox = label.locator('xpath=following-sibling::*[1]').locator('[data-testid^="checkbox-cell-"]').first();

  await expect(checkbox).toHaveAttribute('data-checked', 'false', WAIT);
  await checkbox.click();
  await expect(checkbox).toHaveAttribute('data-checked', 'true', WAIT);
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

/** `| property | database |` → the property each other database maps to the filter. */
export function parseFilterMapping(rows: Record<string, string>[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.database.trim(), row.property.trim()]));
}

/** Toggle a select option on by its name in the open filter (option ids differ between databases). */
export async function selectGlobalFilterOptionByName(page: Page, name: string) {
  const option = DashboardSelectors.globalFilterContent(page)
    .locator('[data-testid="dashboard-global-filter-option"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();

  await expect(option).toBeVisible(WAIT);
  await expect(option).toHaveAttribute('data-checked', 'false');
  await option.click();
  await expect(option).toHaveAttribute('data-checked', 'true');
}

/**
 * Add a global filter on `property` (and `mapping`'s properties of the other
 * sources) the way a writer does, then choose `condition` and, when given,
 * the value: a date written as "today - N", or select option names. In View
 * mode the filter is saved for everyone with its default condition; the
 * condition and value chosen afterwards stay private until saved (WP07).
 */
export async function addTemplateGlobalFilter(
  page: Page,
  property: string,
  condition: string,
  value = '',
  mapping: Record<string, string> = {}
) {
  const type = await startGlobalFilter(page, page, property, mapping);

  await chooseFilterCondition(page, condition);
  if (value.trim()) {
    if (type === FieldType.DateTime) {
      await pickCalendarDay(page, relativeDayOffset(value), page.getByTestId('dashboard-global-filter-date-calendar'));
      await expect(page.getByTestId('dashboard-global-filter-date-value')).not.toHaveText(/Type a value/);
    } else if (type === FieldType.SingleSelect || type === FieldType.MultiSelect) {
      for (const option of splitList(value)) await selectGlobalFilterOptionByName(page, option);
    } else {
      throw new Error(`A "${property}" filter takes no value here`);
    }
  }

  await finishGlobalFilter(page);
}

/** A select filter on `property` matching option names (any database, named ids or not). */
export async function addTemplateSelectGlobalFilter(page: Page, property: string, options: string) {
  await addTemplateGlobalFilter(page, property, 'Is', options);
}

/** The relative-date conditions a saved date filter can have without a value. */
const DATE_CONDITIONS: Record<string, DateFilterCondition> = {
  Today: DateFilterCondition.DateStartsToday,
  Yesterday: DateFilterCondition.DateStartsYesterday,
  Tomorrow: DateFilterCondition.DateStartsTomorrow,
};

/**
 * Seed a saved date filter named after `property` of the dashboard's host,
 * also mapped to `mapping`'s properties, with a relative condition
 * ("Today"): what everyone sees when they open the dashboard.
 */
export async function seedSavedDateGlobalFilter(
  page: Page,
  request: APIRequestContext,
  dashboardName: string,
  property: string,
  condition: string,
  mapping: Record<string, string>
) {
  const dashboard = activateDashboard(page, dashboardName);
  const value = DATE_CONDITIONS[condition];

  if (value === undefined) throw new Error(`A saved date filter is "${Object.keys(DATE_CONDITIONS).join('", "')}"`);
  const targets = Object.fromEntries(
    Object.entries({ [dashboard.host]: property, ...mapping }).map(([database, name]) => {
      const fixture = fixtureDatabase(page, database);
      const fieldId = fixture.fieldIds[name];

      if (!fieldId) throw new Error(`"${database}" has no "${name}" property`);
      return [fixture.databaseId, fieldId];
    })
  );
  const filter = {
    id: `gf-${uuidv4().slice(0, 12)}`,
    name: property,
    ty: FieldType.DateTime,
    condition: value,
    content: '',
    targets,
  };
  const { global_filters: current } = await readDashboardSetting(page);

  await writeDashboardSetting(page, { global_filters: [...current, filter] });
  await expect(globalFilterChip(page, property)).toBeVisible(WAIT);
  await waitForDashboardSync(page, request);
}

/** Change the condition of a filter from its pill (a value change: private in View mode). */
export async function switchGlobalFilterCondition(page: Page, name: string, condition: string) {
  await openGlobalFilterChip(page, name);
  await chooseGlobalFilterCondition(page, condition);
  await closeGlobalFilterMenu(page);
}

// ---------------------------------------------------------------------------
// Adding a widget with a row's add button
// ---------------------------------------------------------------------------

/** The `+` of a dashboard row (Edit mode): it inserts a Count all Number widget and docks the picker beside it. */
export async function addWidgetWithRowButton(page: Page, rowIndex: number) {
  const row = DashboardSelectors.rows(page).nth(rowIndex - 1);
  const rowId = (await row.getAttribute('data-row-id')) ?? '';

  expect(rowId, `the dashboard has no row ${rowIndex}`).not.toBe('');
  await row.hover();
  await openWidgetPicker(page, DashboardSelectors.addWidgetRowButton(page, rowId));
}

export async function closeWidgetPicker(page: Page) {
  await closeDockedPicker(page);
}

/** The view the add flow created for its widget belongs to the dashboard: no tab shows it. */
export async function expectNewWidgetViewHiddenFromTabs(page: Page, databaseName: string) {
  const { view_id: viewId, database_id: databaseId } = await newWidgetRecord(page);

  expect(databaseId, `the new widget does not show "${databaseName}"`).toBe(
    fixtureDatabase(page, databaseName).databaseId
  );
  await expect(DatabaseViewSelectors.viewTab(page, dashboardWorld(page).dashboardViewId ?? '')).toHaveAttribute(
    'data-state',
    'active',
    WAIT
  );
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveCount(0, WAIT);
  expect(await tabBarViewIds(page)).not.toContain(viewId);
}

// ---------------------------------------------------------------------------
// The Free plan
// ---------------------------------------------------------------------------

/**
 * Whether the app is a Vite development build. Development and test builds
 * skip the workspace plan check (`useTimelineCreationDisabledReason`:
 * `isDevelopmentOrTestEnvironment()`), so a Free plan cannot be shown there.
 */
export async function isDevelopmentBuild(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.querySelector('script[src="/@vite/client"]')));
}

/**
 * Undo the Background's server-side Pro grant (`grantWorkspaceProSubscription`):
 * the workspace's subscriptions become inactive. CI provides the Postgres
 * container; a local server without one does not enforce the plan.
 */
export function revokeWorkspaceProSubscription(workspaceId: string) {
  const container = process.env.APPFLOWY_TEST_POSTGRES_CONTAINER;

  if (!container) {
    if (process.env.CI) throw new Error('CI must provide APPFLOWY_TEST_POSTGRES_CONTAINER for plan fixtures');
    return;
  }

  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'sh',
      '-c',
      'exec psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -v "workspace_id=$1"',
      'psql',
      workspaceId,
    ],
    {
      input: `UPDATE af_workspace_subscription SET active = FALSE WHERE workspace_id = :'workspace_id'::uuid;`,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}

/**
 * Put the scenario's workspace on the Free plan: the server subscription is
 * made inactive and the billing endpoints answer that no plan is active
 * (these routes win over `mockProSubscription`'s, registered earlier), then
 * the app reloads so it reads the plan again.
 */
export async function putWorkspaceOnFreePlan(page: Page, testInfo: TestInfo) {
  testInfo.skip(
    await isDevelopmentBuild(page),
    'A development build skips the workspace plan check (isDevelopmentOrTestEnvironment); run against a production build'
  );
  revokeWorkspaceProSubscription(dashboardWorld(page).workspaceId);
  const noPlan = (data: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 0, data, message: '' }),
  });

  await page.route('**/billing/api/v1/active-subscription/**', (route) => route.fulfill(noPlan([])));
  await page.route('**/billing/api/v1/subscriptions', (route) => route.fulfill(noPlan([])));
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Open a database's view tab "+" menu and try its Dashboard option. */
export async function tryAddingDashboard(page: Page, databaseName: string) {
  const database = fixtureDatabase(page, databaseName);

  await openDatabasePage(page, databaseName, database.views.Grid);
  await DatabaseViewSelectors.addViewButton(page).click();
  const option = DashboardSelectors.addDashboardViewOption(page);

  await expect(option).toBeVisible(WAIT);
  // A refused option is disabled; a click must not create a view.
  await option.click({ force: true });
}

/** The reason the open "+" menu gives on its disabled Dashboard option (its tooltip). */
export async function expectDashboardRefusedWith(page: Page, message: string) {
  const option = DashboardSelectors.addDashboardViewOption(page);
  // The tooltip's own popper layer (the "+" menu is another one, which never holds this text).
  const tooltip = page.locator('[data-radix-popper-content-wrapper]').filter({ hasText: message }).first();

  await expect(option).toBeVisible(WAIT);
  await expect(option).toHaveAttribute('data-disabled', '');
  // The tooltip trigger wraps the disabled item; its text follows the plan check.
  await expect(async () => {
    await option.locator('xpath=..').hover({ force: true });
    await expect(tooltip).toBeVisible({ timeout: 2_000 });
  }).toPass(WAIT);
}

export async function expectNoDashboardView(page: Page, databaseName: string) {
  const database = fixtureDatabase(page, databaseName);
  const dashboards = async () =>
    (await readDatabaseViews(page, database.databaseId)).filter((view) => view.layout === DatabaseViewLayout.Dashboard);

  // Give a refused click time to show up as a view, then close the menu.
  await page.waitForTimeout(1_000);
  expect(await dashboards()).toEqual([]);
  await page.keyboard.press('Escape');
  expect(await dashboards()).toEqual([]);
}

// ---------------------------------------------------------------------------
// Opening a dashboard on a phone, or with nothing cached
// ---------------------------------------------------------------------------

interface ColdOpen {
  recorder: SourceRequestRecorder;
  openedAt: number;
  /** The databases of the dashboard's widgets other than its host (the host needs no load slot). */
  sourceIds: string[];
  /** Database id → name, for failure messages. */
  names: Record<string, string>;
}

const coldOpens = new WeakMap<Page, ColdOpen>();

/**
 * Open a use-case dashboard in a new document with nothing cached (IndexedDB
 * and the delta cursors deleted), recording the document and blob/diff
 * requests of its source databases.
 */
export async function openTemplateDashboardCold(page: Page, name: string) {
  const world = dashboardWorld(page);
  const dashboard = activateDashboard(page, name);
  const host = fixtureDatabase(page, dashboard.host);
  const widgets = Object.values(dashboard.widgets);
  const sources = Object.values(world.databases).filter(
    (database) =>
      database.databaseId !== host.databaseId && widgets.some((widget) => widget.databaseId === database.databaseId)
  );
  const recorder = new SourceRequestRecorder(
    page,
    sources.map((database) => ({
      databaseId: database.databaseId,
      viewIds: [
        database.pageId,
        ...Object.values(database.views),
        ...widgets.filter((widget) => widget.databaseId === database.databaseId).map((widget) => widget.viewId),
      ],
    }))
  );

  await clearCachedDatabaseStorage(page);
  const openedAt = Date.now();

  coldOpens.set(page, {
    recorder,
    openedAt,
    sourceIds: sources.map((database) => database.databaseId),
    names: Object.fromEntries(sources.map((database) => [database.databaseId, database.name])),
  });
  await page.goto(`/app/${world.workspaceId}/${host.pageId}?v=${dashboard.viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: LARGE_LOAD_TIMEOUT_MS });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(widgets.length, { timeout: LARGE_LOAD_TIMEOUT_MS });
}

/**
 * At most `cap` source databases loaded at a time during the cold open: the
 * app's high-water mark and the requests in flight per source, once every
 * widget has its data. Every source took a slot (none skipped the queue), and
 * the request recorder saw each one load, so its peak is evidence (a recorder
 * that matched no request would report a peak of 0).
 */
export async function expectColdOpenSourceCap(page: Page, cap: number) {
  const open = coldOpens.get(page);

  if (!open) throw new Error('The dashboard was not opened with nothing cached in this scenario');
  expect(cap, 'tokens.json loading.maxConcurrentSources').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  await expect(
    page.getByTestId('dashboard-widget-placeholder').and(page.locator('[data-reason="loading"]'))
  ).toHaveCount(0, { timeout: LARGE_LOAD_TIMEOUT_MS });
  const stats = await loadStats(page);
  const loaded = new Set(stats.sourceLoads.map((load) => load.sourceId));
  const nameOf = (id: string) => open.names[id] ?? id;

  expect(stats.widgetStarts.length, 'no widget start was recorded').toBeGreaterThan(0);
  expect(
    open.sourceIds.filter((id) => !loaded.has(id)).map(nameOf),
    'source databases that loaded without a slot'
  ).toEqual([]);
  expect(
    open.sourceIds.filter((id) => open.recorder.ofSource(id, open.openedAt).length === 0).map(nameOf),
    'source databases whose document or blob/diff request the recorder never saw'
  ).toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'sources loading at once (the app counter)').toBeLessThanOrEqual(cap);
  expect(
    open.recorder.maxConcurrentSources(open.openedAt),
    `source databases with a document or blob/diff request in flight at once\n${open.recorder.describePeak(
      open.openedAt,
      nameOf
    )}`
  ).toBeLessThanOrEqual(cap);
}

// ---------------------------------------------------------------------------
// The browser's time zone
// ---------------------------------------------------------------------------

const timeZoneSessions = new WeakMap<Page, CDPSession>();

/** Run the page in UTC (Chromium's emulation lasts as long as its CDP session, across navigations). */
export async function runBrowserInUtc(page: Page) {
  const session = await page.context().newCDPSession(page);

  await session.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  timeZoneSessions.set(page, session);
  await expectUtcTimeZone(page);
}

export async function expectUtcTimeZone(page: Page) {
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('UTC');
}

// ---------------------------------------------------------------------------
// The 5000-employee database
// ---------------------------------------------------------------------------

/** Rows a scenario edits (by unique name); their fixture cells are put back before every scenario. */
const EDITED_EMPLOYEES = ['Amelia Moore'];

interface SeededPeopleOps {
  email: string;
  workspaceId: string;
  spaceId: string;
  spaceName: string;
  database: FixtureDatabase;
  /** Row ids in fixture order. */
  rowIds: string[];
}

/** The worker's seeded copy (seeding 5000 rows takes minutes; a retry runs in a new worker and seeds again). */
let seededPeopleOps: SeededPeopleOps | undefined;

function ownerEmail(page: Page): string {
  const user = dashboardWorld(page).owner.tokenData.user as { email?: string } | undefined;

  if (!user?.email) throw new Error('The scenario owner has no email in its session');
  return user.email;
}

/** The fixture's properties as use-case field specs (for the use-case parsers). */
function employeeFieldSpecs(): FieldSpec[] {
  return loadEmployeesFixture().fields.map((field) => {
    const content = Object.values(field.type_options)
      .map((option) => option.content)
      .find((value): value is string => typeof value === 'string' && value.includes('options'));
    const options = content
      ? (JSON.parse(content).options as { name: string }[]).map((option) => option.name)
      : undefined;

    return { name: field.name, type: field.field_type as FieldType, options };
  });
}

/** Row ids by name, for the names only one employee has (the fixture repeats some names). */
function uniqueEmployeeRowIds(rowIds: string[]): Record<string, string> {
  const fixture = loadEmployeesFixture();
  const nameIndex = fixture.fields.findIndex((field) => field.id === EMPLOYEE_FIELDS.Name);
  const ids = new Map<string, string[]>();

  fixture.rows.forEach((cells, index) => {
    const name = cells[nameIndex].data;

    ids.set(name, [...(ids.get(name) ?? []), rowIds[index]]);
  });
  return Object.fromEntries(
    [...ids.entries()].filter(([, list]) => list.length === 1).map(([name, list]) => [name, list[0]])
  );
}

/** Seed the fixture into a new database of the scenario's use-case space. */
async function seedPeopleOps(page: Page, request: APIRequestContext, name: string): Promise<SeededPeopleOps> {
  const world = dashboardWorld(page);

  await addUseCaseDatabase(page, request, name, [], false);
  const database = fixtureDatabase(page, name);

  await openDatabasePage(page, name, database.views.Grid);
  // Every row: the totals of the feature are those of the whole fixture (EMPLOYEES_ROW_LIMIT does not apply).
  const rowIds = await seedEmployeesDatabase(page);

  await expectEmployeesOnServer(page, rowIds);
  database.fieldIds = { ...EMPLOYEE_FIELDS };
  return {
    email: ownerEmail(page),
    workspaceId: world.workspaceId,
    spaceId: world.spaceId,
    spaceName: world.spaceName,
    database: { ...database, fieldIds: { ...database.fieldIds }, rowIds: {}, views: { ...database.views } },
    rowIds,
  };
}

/**
 * Move the scenario world into the account that holds the worker's seeded
 * copy: sign the browser in as its owner and use its workspace, space and
 * database. The use-case state (views, dashboards) stays the scenario's own.
 */
async function adoptPeopleOps(page: Page, request: APIRequestContext, seeded: SeededPeopleOps, name: string) {
  const world = dashboardWorld(page);
  const owner = await signInFixtureAccount(request, seeded.email);

  await signBrowserInWithSession(page, owner);
  grantWorkspaceProSubscription(seeded.workspaceId);
  world.owner = owner;
  world.workspaceId = seeded.workspaceId;
  world.spaceId = seeded.spaceId;
  world.spaceName = seeded.spaceName;
  world.databases = {
    [name]: { ...seeded.database, fieldIds: { ...seeded.database.fieldIds }, views: { ...seeded.database.views } },
  };
  scenarioState(page).lastViewIds[name] = seeded.database.views.Grid;
}

/** Put back the fixture cells of the rows scenarios edit, and wait until the server holds them. */
async function restoreEditedEmployees(page: Page, request: APIRequestContext, seeded: SeededPeopleOps) {
  const fixture = loadEmployeesFixture();
  const byName = uniqueEmployeeRowIds(seeded.rowIds);
  const restored = EDITED_EMPLOYEES.map((employee) => {
    const rowId = byName[employee];

    if (!rowId) throw new Error(`"${employee}" is not a unique employee name`);
    return { rowId, cells: fixture.rows[seeded.rowIds.indexOf(rowId)] };
  });
  const changed: string[] = await page.evaluate(
    async ({ databaseId, fieldIds, restored }) => {
      const ctx = (window as any).__DASHBOARD_TEST__?.byDatabase(databaseId);
      const touched: string[] = [];

      for (const { rowId, cells } of restored) {
        const rowDoc = ctx?.rowMap?.[rowId] ?? (await ctx?.ensureRow?.(rowId));
        const yCells = rowDoc?.getMap('data').get('data')?.get('cells');

        if (!yCells) throw new Error(`Row ${rowId} is not loaded`);
        rowDoc.transact(() => {
          cells.forEach((cell: { data: string }, index: number) => {
            const yCell = yCells.get(fieldIds[index]);

            if (yCell && yCell.get('data') !== cell.data) {
              yCell.set('data', cell.data);
              if (!touched.includes(rowId)) touched.push(rowId);
            }
          });
        });
      }

      return touched;
    },
    { databaseId: seeded.database.databaseId, fieldIds: fixture.fields.map((field) => field.id), restored }
  );

  if (changed.length === 0) return;
  const world = dashboardWorld(page);
  const salaryIndex = fixture.fields.findIndex((field) => field.id === EMPLOYEE_FIELDS.Salary);

  for (const { rowId, cells } of restored.filter((entry) => changed.includes(entry.rowId))) {
    await expect
      .poll(
        async () => {
          const details = await apiGet<{ cells: Record<string, unknown> }[]>(
            request,
            world.owner.accessToken,
            `/api/workspace/${world.workspaceId}/database/${seeded.database.databaseId}/row/detail?ids=${rowId}`
          );
          const salary = details[0]?.cells?.Salary ?? details[0]?.cells?.[EMPLOYEE_FIELDS.Salary];
          const text = String(
            typeof salary === 'object' && salary !== null ? (salary as { data?: unknown }).data : salary
          );

          // The API may print the US dollar format ("$185,000"): compare the amounts.
          return Number(text.replace(/[^0-9.-]/g, ''));
        },
        { timeout: USE_CASE_TIMEOUT, message: 'waiting for the restored salary to reach the server' }
      )
      .toBe(Number(cells[salaryIndex].data));
  }
}

/**
 * `an "Employees" database holding the 5000-employee fixture`: the first
 * scenario of a worker seeds the pinned fixture into its use-case space; the
 * next ones sign in to that account and use the same database, with the
 * rows scenarios edit put back first. Either way the scenario world names it
 * `name`, with the fixture's field ids and the row ids of unique names.
 */
export async function provideEmployeesFixtureDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  testInfo: TestInfo
) {
  testInfo.setTimeout(Math.max(testInfo.timeout, EMPLOYEES_SEED_TIMEOUT_MS));
  if (seededPeopleOps) await adoptPeopleOps(page, request, seededPeopleOps, name);
  else seededPeopleOps = await seedPeopleOps(page, request, name);

  const seeded = seededPeopleOps;
  const database = fixtureDatabase(page, name);
  const specs = employeeFieldSpecs();

  database.rowIds = uniqueEmployeeRowIds(seeded.rowIds);
  rememberFieldTypes(page, name, specs);
  rememberSelectOptions(page, name, specs);
  await openDatabasePage(page, name, database.views.Grid);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: LARGE_LOAD_TIMEOUT_MS,
  });
  await restoreEditedEmployees(page, request, seeded);
  if (timeZoneSessions.has(page)) await expectUtcTimeZone(page);
}
