/**
 * Dashboard template scenarios, set 1 (`dashboard-usecases/saas-growth`,
 * `support-desk`, `marketing-budget` and `recruiting-pipeline`): what those
 * templates need on top of the use-case helpers (`dashboard-usecase-helpers.ts`).
 *
 * - A property table with every type the templates use (Multi-select,
 *   Created time, Last edited time) and Number formats in its options column
 *   (US dollar, Euro, Percent), written the way the app stores them.
 * - Views in a wider settings language: every calculation of the Calculate
 *   menu, date grouping, Cumulative, a custom Number title, and checkbox,
 *   text, number and multi-select view filters.
 * - Chart values of bar and line charts, line point clicks, the donut centre
 *   as printed, checkbox cells, row deletion, and filters added inside a
 *   widget that already has saved filters.
 * - Global filters of any property type, and a teammate who can edit the
 *   space (Edit button, Save for everyone, layout changes).
 *
 * Chart labels can name a date bucket relative to today ("week of today -
 * 14", "month of today + 35"); they resolve to the product's label for the
 * bucket ("Week of Sep 14 - Sep 20, 2026", "Sep 2026") when the step runs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { CheckboxFilterCondition } from '../../src/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '../../src/application/database-yjs/fields/date/date.type';
import { NumberFilterCondition } from '../../src/application/database-yjs/fields/number/number.type';
import { SelectOptionFilterCondition } from '../../src/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '../../src/application/database-yjs/fields/text/text.type';
import { ViewLayout } from '../../src/application/types';

import { categoryPoint, type TypeOptionUpdate, waitForTypeOptionSync, writeTypeOptions } from './chart-render-helpers';
import { backToChartPanelRoot, CHART_AGGREGATION_BY_NAME, chartPanel } from './chart-settings-helpers';
import { clickFilterBarControl, filterBarControl, isCheckedCell, readRowCells } from './dashboard-private-helpers';
import { pressEscapeUntilHidden } from './dashboard-shared-helpers';
import {
  createDatabaseViewThroughApi,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  databaseForLabel,
  DatabaseViewLayout,
  dragFromTo,
  enterEditMode,
  FieldSpec,
  FieldType,
  fillGlobalFilterText,
  fixtureDatabase,
  inviteDashboardMember,
  leaveEditMode,
  memberPage,
  namedOptionId,
  openDatabasePage,
  readDashboardSetting,
  rowColumnPitch,
  splitList,
  widgetLocator,
} from './dashboard-test-helpers';
import {
  addUseCaseDatabase,
  barChartValues,
  chartNumber,
  chooseFilterCondition,
  configureView,
  donutTotal,
  drillDown,
  editWidgetCell,
  expectPersistedCell,
  finishGlobalFilter,
  namedView,
  parseViewSettings,
  pickCalendarDay,
  relativeDayOffset,
  rememberFieldTypes,
  rememberSelectOptions,
  rowIdByTitle,
  scenarioState,
  startGlobalFilter,
  startOfDayUnix,
  toggleFilterOption,
  USE_CASE_TIMEOUT,
  type ViewConfig,
  type ViewFilterSpec,
  waitForViewSync,
} from './dashboard-usecase-helpers';
import { selectFilterOption } from './filter-test-helpers';
import { DatabaseFilterSelectors } from './selectors';

export const TEMPLATE_TIMEOUT = { timeout: USE_CASE_TIMEOUT };

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

type ApiError = Error & { message: string };

/** Retry an API write the server refuses while its folder projection catches up (`"code":-5`). */
async function retryTransient<T>(label: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!((error as ApiError).message ?? '').includes('"code":-5')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
    }
  }

  throw new Error(`${label} kept failing: ${(lastError as ApiError)?.message}`);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The fields of a database as the browser's database doc holds them. */
interface BrowserField {
  id: string;
  name: string;
  type: FieldType;
  primary: boolean;
}

async function browserFields(page: Page, databaseId: string): Promise<BrowserField[]> {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const fields = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('fields');
    const result: { id: string; name: string; type: number; primary: boolean }[] = [];

    fields?.forEach((field: any, fieldId: string) => {
      result.push({
        id: fieldId,
        name: String(field.get('name') ?? ''),
        type: Number(field.get('ty')),
        primary: Boolean(field.get('is_primary')),
      });
    });
    return result;
  }, databaseId);
}

function fieldNamed(fields: BrowserField[], databaseName: string, property: string): BrowserField {
  const field =
    property === 'Name' ? fields.find((candidate) => candidate.primary) : fields.find((candidate) => candidate.name === property);

  if (!field) throw new Error(`"${databaseName}" has no "${property}" property`);
  return field;
}

/** A local day `offset` days from today, at noon (as the web stores a picked date). */
function localDay(offset: number): Date {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

const DATE_TYPES: ReadonlySet<FieldType> = new Set([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime]);

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

/** Property type names of the template tables: the use-case names, and the types they lack. */
const TEMPLATE_FIELD_TYPES: Record<string, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  Date: FieldType.DateTime,
  Select: FieldType.SingleSelect,
  'Multi-select': FieldType.MultiSelect,
  Checkbox: FieldType.Checkbox,
  URL: FieldType.URL,
  'Created time': FieldType.CreatedTime,
  'Last edited time': FieldType.LastEditedTime,
};

/** Number formats by the names of the property's format menu (`NumberFormat` ids). */
const NUMBER_FORMATS: Record<string, number> = {
  number: 0,
  'us dollar': 1,
  'canadian dollar': 2,
  euro: 4,
  pound: 5,
  yen: 6,
  percent: 36,
};

const OPTION_COLORS = ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue'];

interface TemplateProperty {
  name: string;
  type: FieldType;
  /** Select and Multi-select option names. */
  options: string[];
  /** A Number property's `NumberFormat` id. */
  format?: number;
}

/** `| property | type | options |`: the options column lists a select's options, or names a Number format. */
function parseTemplateProperties(rows: Record<string, string>[]): TemplateProperty[] {
  return rows.map((row) => {
    const name = row.property.trim();
    const type = TEMPLATE_FIELD_TYPES[row.type.trim()];
    const options = (row.options ?? '').trim();

    if (type === undefined) throw new Error(`Unknown property type "${row.type}"`);
    if (type === FieldType.Number && options) {
      const format = NUMBER_FORMATS[options.toLowerCase()];

      if (format === undefined) throw new Error(`Unknown number format "${options}"`);
      return { name, type, options: [], format };
    }

    if (options && type !== FieldType.SingleSelect && type !== FieldType.MultiSelect) {
      throw new Error(`"${name}" (${row.type}) takes no options, got "${options}"`);
    }

    return { name, type, options: splitList(options) };
  });
}

/**
 * Create a use-case database from a template property table. The use-case
 * seeding creates the fields (single-select options included); the
 * multi-select options and the number formats are then written into the
 * database doc, as the property menu does, and awaited on the server before
 * any row is added (the server resolves option names when it adds a row).
 * Option ids are the shared named ids, so the use-case steps find them by name.
 */
export async function addTemplateDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  rows: Record<string, string>[]
) {
  const properties = parseTemplateProperties(rows);
  const fields: FieldSpec[] = properties.map((property) => ({
    name: property.name,
    type: property.type,
    options: property.type === FieldType.SingleSelect ? property.options : undefined,
  }));

  await addUseCaseDatabase(page, request, name, fields);
  const database = fixtureDatabase(page, name);
  const updates: TypeOptionUpdate[] = [];

  properties.forEach((property) => {
    const fieldId = database.fieldIds[property.name];

    if (property.type === FieldType.MultiSelect) {
      const options = property.options.map((option, index) => ({
        id: namedOptionId(option),
        name: option,
        color: OPTION_COLORS[index % OPTION_COLORS.length],
      }));

      updates.push({
        fieldId,
        type: FieldType.MultiSelect,
        entries: { content: JSON.stringify({ options, disable_color: false }) },
      });
    }

    if (property.format !== undefined) updates.push({ fieldId, type: FieldType.Number, entries: { format: property.format } });
  });

  if (updates.length > 0) {
    await openDatabasePage(page, name, database.views.Grid);
    await writeTypeOptions(page, database.databaseId, updates);
    await waitForTypeOptionSync(page, request, database.databaseId, updates);
  }

  rememberFieldTypes(page, name, fields);
  // "grouped by" reads the option order of select and multi-select properties.
  rememberSelectOptions(
    page,
    name,
    properties
      .filter((property) => property.type === FieldType.SingleSelect || property.type === FieldType.MultiSelect)
      .map((property) => ({ name: property.name, type: property.type, options: property.options }))
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface TemplateLayout {
  folderLayout: number;
  databaseLayout: DatabaseViewLayout;
  chartType?: number;
}

const TEMPLATE_LAYOUTS: Record<string, TemplateLayout> = {
  Grid: { folderLayout: ViewLayout.Grid, databaseLayout: DatabaseViewLayout.Grid },
  Board: { folderLayout: ViewLayout.Board, databaseLayout: DatabaseViewLayout.Board },
  Calendar: { folderLayout: ViewLayout.Calendar, databaseLayout: DatabaseViewLayout.Calendar },
  List: { folderLayout: ViewLayout.List, databaseLayout: DatabaseViewLayout.List },
  Gallery: { folderLayout: ViewLayout.Gallery, databaseLayout: DatabaseViewLayout.Gallery },
  Timeline: { folderLayout: ViewLayout.Timeline, databaseLayout: DatabaseViewLayout.Timeline },
  'Bar chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 0 },
  'Line chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 1 },
  'Horizontal bar chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 2 },
  'Donut chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 3 },
  'Number chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 4 },
};

/** Calculations by their lowercase Calculate menu names ("percent checked" → 11). */
const AGGREGATIONS: Record<string, number> = Object.fromEntries(
  Object.entries(CHART_AGGREGATION_BY_NAME).map(([name, value]) => [name.toLowerCase(), value])
);

/** `per …` of a date X axis (`DateGroupCondition`). */
const DATE_GROUPINGS: Record<string, number> = { 'relative date': 0, day: 1, week: 2, month: 3, year: 4 };

/** Chart keys written beside the use-case chart setting (`ChartLayoutKeys`). */
type ChartExtras = Record<string, string | number | boolean>;

interface TemplateViewSpec {
  layout: TemplateLayout;
  config: ViewConfig;
  chartExtras: ChartExtras;
}

/**
 * The view filter clauses of the settings language, joined with ` and `:
 * `P is V[, V]`, `P is not V[, V]`, `P is empty`, `P is not empty`,
 * `P is checked`, `P is unchecked`, `P contains V`, `P is at least N`,
 * `P is today`, `P is before today`.
 */
function parseTemplateWhere(fields: BrowserField[], databaseName: string, text: string): ViewFilterSpec[] {
  return text.split(' and ').map((clause) => {
    const trimmed = clause.trim();
    const match =
      /^(.+?) is (not empty|empty|checked|unchecked|today|before today)$/.exec(trimmed) ??
      /^(.+?) is (at least) (.+)$/.exec(trimmed) ??
      /^(.+?) is (not) (.+)$/.exec(trimmed) ??
      /^(.+?) (contains) (.+)$/.exec(trimmed) ??
      /^(.+?) is ()(.+)$/.exec(trimmed);

    if (!match) throw new Error(`Cannot read the filter "${trimmed}"`);
    const [, property, kind, value = ''] = match;
    const field = fieldNamed(fields, databaseName, property);
    const filter = (condition: number, content = ''): ViewFilterSpec => ({
      fieldId: field.id,
      fieldType: field.type,
      condition,
      content,
    });
    const optionIds = () => splitList(value).map(namedOptionId).join(',');

    switch (field.type) {
      case FieldType.SingleSelect:
      case FieldType.MultiSelect: {
        const multi = field.type === FieldType.MultiSelect;

        if (kind === 'empty') return filter(SelectOptionFilterCondition.OptionIsEmpty);
        if (kind === 'not empty') return filter(SelectOptionFilterCondition.OptionIsNotEmpty);
        if (kind === 'not') {
          return filter(
            multi ? SelectOptionFilterCondition.OptionDoesNotContain : SelectOptionFilterCondition.OptionIsNot,
            optionIds()
          );
        }

        if (kind === 'contains' || (kind === '' && multi)) {
          return filter(SelectOptionFilterCondition.OptionContains, optionIds());
        }

        if (kind === '') return filter(SelectOptionFilterCondition.OptionIs, optionIds());
        break;
      }

      case FieldType.Checkbox:
        if (kind === 'checked') return filter(CheckboxFilterCondition.IsChecked);
        if (kind === 'unchecked') return filter(CheckboxFilterCondition.IsUnChecked);
        break;
      case FieldType.RichText:
      case FieldType.URL:
        if (kind === 'empty') return filter(TextFilterCondition.TextIsEmpty);
        if (kind === 'not empty') return filter(TextFilterCondition.TextIsNotEmpty);
        if (kind === 'contains') return filter(TextFilterCondition.TextContains, value);
        if (kind === 'not') return filter(TextFilterCondition.TextIsNot, value);
        if (kind === '') return filter(TextFilterCondition.TextIs, value);
        break;
      case FieldType.Number:
        if (kind === 'empty') return filter(NumberFilterCondition.NumberIsEmpty);
        if (kind === 'not empty') return filter(NumberFilterCondition.NumberIsNotEmpty);
        if (kind === 'at least') return filter(NumberFilterCondition.GreaterThanOrEqualTo, value);
        if (kind === '') return filter(NumberFilterCondition.Equal, value);
        break;
      default:
        if (DATE_TYPES.has(field.type)) {
          if (kind === 'empty') return filter(DateFilterCondition.DateStartIsEmpty);
          if (kind === 'not empty') return filter(DateFilterCondition.DateStartIsNotEmpty);
          if (kind === 'today') return filter(DateFilterCondition.DateStartsToday);
          if (kind === 'before today') {
            return filter(DateFilterCondition.DateStartsBefore, JSON.stringify({ timestamp: startOfDayUnix() }));
          }
        }
    }

    throw new Error(`Unsupported filter "${trimmed}" on a property of type ${field.type}`);
  });
}

/**
 * The chart part of the settings language: `count` or `<calculation> of P`
 * (any calculation of the Calculate menu: sum, average, median, min, max,
 * range, count values, count unique values, count empty, percent checked,
 * …), then ` by Q` (and ` per day|week|month|year|relative date` for a date
 * Q), then options: `, cumulative`, `, titled "…"`, `, shown as
 * compact|percent`, `, hiding empty values`.
 */
function parseTemplateChart(
  fields: BrowserField[],
  databaseName: string,
  layoutName: string,
  layout: TemplateLayout,
  text: string
): { chart: NonNullable<ViewConfig['chart']>; extras: ChartExtras } {
  const extras: ChartExtras = {};
  let measure = text.trim();
  const option = /, (cumulative|hiding empty values|titled "([^"]*)"|shown as (compact|percent))$/;
  let found = option.exec(measure);

  while (found) {
    if (found[1] === 'cumulative') extras.cumulative = true;
    else if (found[1] === 'hiding empty values') extras.show_empty_values = false;
    else if (found[2] !== undefined) extras.titleText = found[2];
    else if (found[3]) extras.numberFormat = found[3];
    measure = measure.slice(0, found.index).trim();
    found = option.exec(measure);
  }

  const parsed = /^(count|(.+?) of (.+?))(?: by (.+?))?(?: per (day|week|month|year|relative date))?$/.exec(measure);

  if (!parsed) throw new Error(`A chart view needs "count" or "<calculation> of <property>", got "${text}"`);
  const [, , calculation, yProperty, xProperty, per] = parsed;
  const aggregationType = calculation ? AGGREGATIONS[calculation.toLowerCase()] : 0;

  if (aggregationType === undefined) throw new Error(`Unknown chart calculation "${calculation}"`);
  if (layout.chartType !== 4 && !xProperty) throw new Error(`"${layoutName}" needs "by <property>": "${text}"`);
  const xField = xProperty ? fieldNamed(fields, databaseName, xProperty) : undefined;

  if (per) {
    if (!xField || !DATE_TYPES.has(xField.type)) throw new Error(`"per ${per}" needs a date property: "${text}"`);
    extras.date_condition = DATE_GROUPINGS[per];
  }

  return {
    chart: {
      chartType: layout.chartType as number,
      aggregationType,
      yFieldId: yProperty ? fieldNamed(fields, databaseName, yProperty).id : '',
      xFieldId: xField?.id ?? '',
    },
    extras,
  };
}

/** One row of a template view table: the use-case settings language plus the chart and filter extensions above. */
function parseTemplateView(
  page: Page,
  fields: BrowserField[],
  databaseName: string,
  layoutName: string,
  text: string
): TemplateViewSpec {
  const layout = TEMPLATE_LAYOUTS[layoutName];

  if (!layout) throw new Error(`Unknown view layout "${layoutName}"`);
  let rest = text.trim();
  let filters: ViewFilterSpec[] = [];
  const whereIndex = rest.search(/(^|\s)where /);

  if (whereIndex !== -1) {
    filters = parseTemplateWhere(fields, databaseName, rest.slice(whereIndex).trim().replace(/^where /, ''));
    rest = rest.slice(0, whereIndex).trim();
  }

  if (layout.chartType !== undefined) {
    const { chart, extras } = parseTemplateChart(fields, databaseName, layoutName, layout, rest);

    return { layout, config: { layout: layout.databaseLayout, filters, sorts: [], chart }, chartExtras: extras };
  }

  // Sorts, grouping, calendar and timeline settings read as in the use-case tables.
  const config = parseViewSettings(page, databaseName, layoutName, rest);

  return { layout, config: { ...config, filters }, chartExtras: {} };
}

/** Write the chart keys the use-case chart setting leaves at their defaults (date grouping, Cumulative, title, …). */
async function writeChartExtras(page: Page, databaseId: string, viewId: string, extras: ChartExtras) {
  if (Object.keys(extras).length === 0) return;
  await page.evaluate(
    ({ databaseId, viewId, extras }) => {
      const doc = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const chart = doc.getMap('data').get('database').get('views').get(viewId).get('layout_settings').get('3');

      doc.transact(() => Object.entries(extras).forEach(([key, value]) => chart.set(key, value)));
    },
    { databaseId, viewId, extras }
  );
}

async function applyTemplateView(page: Page, databaseId: string, viewId: string, spec: TemplateViewSpec) {
  await configureView(page, databaseId, viewId, spec.config);
  await writeChartExtras(page, databaseId, viewId, spec.chartExtras);
}

/**
 * `| view | layout | settings |` rows: each view is created as a tab of the
 * database (after the last one), configured in the browser and awaited on the
 * server, and remembered by its name for the dashboard and widget steps.
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
  const fields = await browserFields(page, database.databaseId);
  const created: { viewId: string; spec: TemplateViewSpec }[] = [];

  for (const row of rows) {
    const name = row.view.trim();
    const layoutName = row.layout.trim();
    const spec = parseTemplateView(page, fields, databaseName, layoutName, row.settings ?? '');
    const viewId = await retryTransient(`Creating the "${name}" view`, () =>
      createDatabaseViewThroughApi(page, request, {
        database: databaseName,
        name,
        folderLayout: spec.layout.folderLayout,
        prevViewId: state.lastViewIds[databaseName],
      })
    );

    state.lastViewIds[databaseName] = viewId;
    await applyTemplateView(page, database.databaseId, viewId, spec);
    created.push({ viewId, spec });
    state.views[name] = { name, viewId, database: databaseName, layout: layoutName };
    world.viewsByName = { ...world.viewsByName, [name]: { viewId, database: databaseName } };
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
// Chart labels relative to today
// ---------------------------------------------------------------------------

const SHORT_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const LONG_DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
const MONTH: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short' };

/**
 * The week bucket of a day: its Monday to its Sunday, written as English
 * charts write it ("Week of Sep 14 - Sep 20, 2026"; the Monday gets its year
 * too when the week spans two years).
 */
function weekBucketLabel(offset: number): string {
  const day = localDay(offset);
  const monday = new Date(day);

  monday.setDate(day.getDate() - (day.getDay() === 0 ? 6 : day.getDay() - 1));
  const sunday = new Date(monday);

  sunday.setDate(monday.getDate() + 6);
  const start = new Intl.DateTimeFormat('en-US', monday.getFullYear() === sunday.getFullYear() ? SHORT_DAY : LONG_DAY);

  return `Week of ${start.format(monday)} - ${new Intl.DateTimeFormat('en-US', LONG_DAY).format(sunday)}`;
}

/** `week of today - 14`, `month of today + 35` → the bucket's label; any other label is kept. */
export function resolveTemplateChartLabel(label: string): string {
  const text = label.trim();
  const week = /^week of (today.*)$/i.exec(text);

  if (week) return weekBucketLabel(relativeDayOffset(week[1]));
  const month = /^month of (today.*)$/i.exec(text);

  if (month) return new Intl.DateTimeFormat('en-US', MONTH).format(localDay(relativeDayOffset(month[1])));
  return text;
}

// ---------------------------------------------------------------------------
// Chart checks
// ---------------------------------------------------------------------------

/**
 * Every category of a bar or line chart with its raw value, from the chart's
 * hidden data table (axis labels can be thinned out, data labels are compact).
 */
export async function expectTemplateChartValues(page: Page, viewName: string, rows: Record<string, string>[]) {
  const widget = widgetLocator(page, viewName);
  const expected = Object.fromEntries(
    rows.map((row) => [resolveTemplateChartLabel(row.label), chartNumber(row.value)])
  );

  // The chart has laid out (a line through one point draws no visible curve, so wait for its frame and data).
  await expect(widget.getByTestId('chart-frame')).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(widget.locator('[data-testid="chart-data-table"] tr[data-label]').first()).toBeAttached(TEMPLATE_TIMEOUT);
  await expect.poll(() => barChartValues(widget), TEMPLATE_TIMEOUT).toEqual(expected);
}

/**
 * Click a point of a line chart the way a user does: point at its category
 * (the band shows), then click. A desktop click drills into the category.
 */
export async function clickLinePoint(page: Page, viewName: string, label: string) {
  const widget = widgetLocator(page, viewName);
  const category = resolveTemplateChartLabel(label);

  await expect(widget.getByTestId('line-chart-widget')).toBeVisible(TEMPLATE_TIMEOUT);
  await widget.scrollIntoViewIfNeeded();
  await expect
    .poll(() => categoryPoint(widget, category).then(() => true).catch(() => false), TEMPLATE_TIMEOUT)
    .toBe(true);
  // The line animates in: click once the category's band holds still.
  await expect(async () => {
    const before = await categoryPoint(widget, category);

    await page.waitForTimeout(150);
    expect(await categoryPoint(widget, category)).toEqual(before);
  }).toPass(TEMPLATE_TIMEOUT);
  const point = await categoryPoint(widget, category);

  await page.mouse.move(point.x - 2, point.y);
  await page.mouse.move(point.x, point.y, { steps: 2 });
  await page.mouse.click(point.x, point.y);
  await expect(drillDown(page)).toBeVisible(TEMPLATE_TIMEOUT);
}

/** The donut centre as printed: R-FORMAT `center` (the Y property's currency, compact from 10,000 on). */
export async function expectDonutTotalText(page: Page, viewName: string, text: string) {
  const widget = widgetLocator(page, viewName);

  await expect(widget.locator('.recharts-pie')).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(donutTotal(widget)).toHaveText(text, TEMPLATE_TIMEOUT);
}

/** The Number card prints its whole value: no ellipsis, nothing clipped. */
export async function expectNumberNotTruncated(page: Page, viewName: string) {
  const value = widgetLocator(page, viewName).getByTestId('number-chart-value');

  await expect(value).toBeVisible(TEMPLATE_TIMEOUT);
  await expect
    .poll(() => value.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), TEMPLATE_TIMEOUT)
    .toBe(true);
}

/** Turn a switch row of the open chart settings panel off ("Cumulative", "Show empty values"). */
export async function turnOffChartSetting(page: Page, label: string) {
  const panel = chartPanel(page);

  await backToChartPanelRoot(page);
  const toggle = panel
    .locator('[data-row-id][role="switch"]')
    .filter({ has: page.locator('span.flex-1', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) })
    .first();

  await expect(toggle).toBeVisible(TEMPLATE_TIMEOUT);
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
}

// ---------------------------------------------------------------------------
// Widget content
// ---------------------------------------------------------------------------

function propertyTypeOf(page: Page, viewName: string, property: string): Promise<FieldType> {
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));

  return browserFields(page, database.databaseId).then((fields) => fieldNamed(fields, database.name, property).type);
}

/** Tick or untick a checkbox cell of a grid widget (a click on the cell toggles it). */
async function setWidgetCheckbox(page: Page, viewName: string, title: string, property: string, checked: boolean) {
  const widget = widgetLocator(page, viewName);
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const rowId = await rowIdByTitle(page, viewName, title);
  const fieldId = database.fieldIds[property];
  const cell = widget.getByTestId(`grid-cell-${rowId}-${fieldId}`);
  const checkbox = widget.getByTestId(`checkbox-cell-${rowId}-${fieldId}`);

  await expect(cell).toBeAttached(TEMPLATE_TIMEOUT);
  await cell.scrollIntoViewIfNeeded();
  await expect(checkbox).toBeVisible(TEMPLATE_TIMEOUT);
  if ((await checkbox.getAttribute('data-checked')) !== String(checked)) await cell.click();
  await expect(checkbox).toHaveAttribute('data-checked', String(checked), TEMPLATE_TIMEOUT);
}

/**
 * Edit a grid cell of a widget: "checked" / "unchecked" for a checkbox
 * (clicking the cell), anything else as the use-case edit does it.
 */
export async function editTemplateCell(page: Page, viewName: string, title: string, property: string, value: string) {
  if ((await propertyTypeOf(page, viewName, property)) === FieldType.Checkbox) {
    if (value !== 'checked' && value !== 'unchecked') throw new Error(`A checkbox is "checked" or "unchecked", got "${value}"`);
    await setWidgetCheckbox(page, viewName, title, property, value === 'checked');
    return;
  }

  await editWidgetCell(page, viewName, title, property, value);
}

/** A saved cell, as the Cloud API returns it: "checked" / "unchecked" for a checkbox, else its text. */
export async function expectTemplatePersistedCell(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  title: string,
  property: string,
  value: string
) {
  const database = fixtureDatabase(page, databaseName);
  const type = fieldNamed(await browserFields(page, database.databaseId), databaseName, property).type;

  if (type !== FieldType.Checkbox) {
    await expectPersistedCell(page, request, databaseName, title, property, value);
    return;
  }

  if (value !== 'checked' && value !== 'unchecked') throw new Error(`A checkbox is "checked" or "unchecked", got "${value}"`);
  await expect
    .poll(
      async () => isCheckedCell((await readRowCells(page, request, databaseName, title))[property]),
      { timeout: USE_CASE_TIMEOUT, message: `waiting for "${property}" of "${title}" to be saved` }
    )
    .toBe(value === 'checked');
}

/** Delete a row from a grid widget: its row menu → Delete → confirm. */
export async function deleteWidgetRow(page: Page, viewName: string, title: string) {
  const widget = widgetLocator(page, viewName);
  const rowId = await rowIdByTitle(page, viewName, title);
  const row = widget.getByTestId(`grid-row-${rowId}`);

  await expect(row).toBeVisible(TEMPLATE_TIMEOUT);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  // The row's hover controls sit beside its cells, in the same row wrapper.
  const menuButton = row.locator('xpath=..').getByTestId('row-accessory-button');

  await expect(menuButton).toBeVisible(TEMPLATE_TIMEOUT);
  await menuButton.click();
  await page.getByTestId('row-menu-delete').click();
  const confirm = page.getByTestId('delete-row-confirm-button');

  await expect(confirm).toBeVisible(TEMPLATE_TIMEOUT);
  await confirm.click();
  await expect(widget.getByTestId(`grid-row-${rowId}`)).toHaveCount(0, TEMPLATE_TIMEOUT);
}

/**
 * Start a filter on `property` from a widget's Filter tool. Without rules the
 * tool opens the property list at once; with rules (saved or private) it
 * opens the widget's Filters popover, whose "Add filter" opens the list.
 */
async function startWidgetFilter(page: Page, widget: Locator, property: string) {
  const tool = widget.getByTestId('database-actions-filter');
  const popover = page.getByTestId('dashboard-widget-filters-popover');

  await expect(widget).toBeVisible(TEMPLATE_TIMEOUT);
  await widget.hover();
  await expect(tool).toBeVisible(TEMPLATE_TIMEOUT);
  const hasRules =
    (await tool.getAttribute('data-active')) === 'true' || (await tool.getAttribute('data-unsaved')) === 'true';

  await tool.click();
  if (hasRules) {
    await expect(popover).toBeVisible(TEMPLATE_TIMEOUT);
    await popover.getByTestId('database-add-filter-button').click();
  }

  const item = DatabaseFilterSelectors.propertyItemByName(page, property).filter({ visible: true }).first();

  await expect(item).toBeVisible(TEMPLATE_TIMEOUT);
  await item.click();
  return { tool, popover };
}

/** Close the rule editor and the widget's Filters popover; the Filter tool shows the active filter. */
async function finishWidgetFilter(page: Page, tool: Locator, popover: Locator) {
  await pressEscapeUntilHidden(page, popover);
  await expect(tool).toHaveAttribute('data-active', 'true', TEMPLATE_TIMEOUT);
}

/** A select rule "is <option>" inside a widget, with or without rules already (private in View mode). */
export async function addWidgetSelectFilter(page: Page, viewName: string, property: string, option: string) {
  const { tool, popover } = await startWidgetFilter(page, widgetLocator(page, viewName), property);

  await selectFilterOption(page, option);
  await finishWidgetFilter(page, tool, popover);
}

/** A checkbox rule "is unchecked" inside a widget (private in View mode, saved to the view in Edit mode). */
export async function addWidgetUncheckedFilter(page: Page, viewName: string, property: string) {
  const { tool, popover } = await startWidgetFilter(page, widgetLocator(page, viewName), property);
  const unchecked = page
    .getByTestId('checkbox-filter')
    .filter({ visible: true })
    .last()
    .getByTestId(`filter-condition-${CheckboxFilterCondition.IsUnChecked}`);

  await expect(unchecked).toBeVisible(TEMPLATE_TIMEOUT);
  // Picking a value applies it and closes the rule editor.
  await unchecked.click();
  await finishWidgetFilter(page, tool, popover);
}

/** A text rule "contains" inside a widget: the editor opens on "Contains" with its value focused. */
export async function addWidgetContainsFilter(page: Page, viewName: string, property: string, text: string) {
  const { tool, popover } = await startWidgetFilter(page, widgetLocator(page, viewName), property);
  const input = page.getByTestId('text-filter-input').filter({ visible: true }).last();

  await expect(input).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(page.locator('[data-testid="filter-condition-trigger"]:visible').last()).toContainText('Contains');
  await input.fill(text);
  // The value is debounced: the rule's chip shows it once it is applied.
  await expect(page.getByTestId('database-filter-condition').filter({ hasText: text }).first()).toBeVisible(
    TEMPLATE_TIMEOUT
  );
  await finishWidgetFilter(page, tool, popover);
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

/** "today - 21 to today - 14" → the two day offsets of a date range. */
function dateRangeOffsets(value: string): [number, number] | null {
  const match = /^(.+?) to (.+)$/.exec(value.trim());

  return match ? [relativeDayOffset(match[1]), relativeDayOffset(match[2])] : null;
}

/**
 * Add a global filter the way a writer does (WP08): pick the property (or
 * build a filter over several sources, `overrides` naming the property of
 * each other database), choose the condition, then give the value its type
 * takes: option names (comma separated), a number or text, a day ("today -
 * 3"), a range ("today - 21 to today - 14"), or nothing for a condition
 * without a value ("Is checked", "Last week", "Yesterday").
 */
export async function addTemplateGlobalFilter(
  page: Page,
  property: string,
  condition: string,
  value: string,
  overrides: Record<string, string> = {}
) {
  const type = await startGlobalFilter(page, page, property, overrides);

  await chooseFilterCondition(page, condition);
  const text = value.trim();

  if (text) {
    if (type === FieldType.SingleSelect || type === FieldType.MultiSelect) {
      for (const option of splitList(text)) await toggleFilterOption(page, option);
    } else if (DATE_TYPES.has(type)) {
      const calendar = page.getByTestId('dashboard-global-filter-date-calendar');
      const range = dateRangeOffsets(text);

      if (range) {
        await pickCalendarDay(page, range[0], calendar);
        await pickCalendarDay(page, range[1], calendar);
      } else {
        await pickCalendarDay(page, relativeDayOffset(text), calendar);
      }

      await expect(page.getByTestId('dashboard-global-filter-date-value')).not.toHaveText(/Type a value/);
    } else if (type === FieldType.Checkbox) {
      throw new Error(`A checkbox filter takes no value, got "${value}"`);
    } else {
      await fillGlobalFilterText(page, text);
    }
  }

  await finishGlobalFilter(page);
}

/** `| property | database |` rows → the property each other database maps. */
export function globalFilterOverrides(rows: Record<string, string>[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.database.trim(), row.property.trim()]));
}

// ---------------------------------------------------------------------------
// A teammate who can edit the space
// ---------------------------------------------------------------------------

/** Invite a workspace member with read-and-write access to the use-case space. */
export async function inviteEditingTeammate(page: Page, request: APIRequestContext, space: string) {
  // The use-case space is named after the use case.
  expect(space).toBe(dashboardWorld(page).spaceName);
  await retryTransient('Inviting an editing teammate', () => inviteDashboardMember(page, request, 'read-and-write'));
}

/** The teammate's dashboard opens in View mode and offers Edit (they can write). */
export async function expectTeammateCanEdit(page: Page) {
  const member = memberPage(page);

  await expect(DashboardSelectors.view(member)).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(DashboardSelectors.editButton(member)).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(DashboardSelectors.doneButton(member)).toHaveCount(0);
  await expect(DashboardSelectors.widthHandles(member)).toHaveCount(0);
}

export async function expectTeammateFilterBar(page: Page, first: string, second: string) {
  const member = memberPage(page);

  await expect(DashboardSelectors.privateControls(member)).toBeVisible(TEMPLATE_TIMEOUT);
  await expect(filterBarControl(member, first)).toHaveText(first);
  await expect(filterBarControl(member, second)).toHaveText(second);
}

export async function clickTeammateFilterBar(page: Page, label: string) {
  await clickFilterBarControl(memberPage(page), label);
}

export async function teammateEntersEditMode(page: Page) {
  await enterEditMode(memberPage(page));
}

export async function teammateLeavesEditMode(page: Page) {
  await leaveEditMode(memberPage(page));
}

/**
 * The teammate drags the width handle next to `viewName` until the widget
 * spans `columns` (the use-case resize, in the teammate's browser).
 */
export async function teammateResizesWidget(page: Page, viewName: string, columns: number) {
  const member = memberPage(page);
  const viewId = namedView(page, viewName).viewId;
  const dashboardId = dashboardViewId(page);

  await enterEditMode(member);
  const { rows } = await readDashboardSetting(member, dashboardId);
  const row = rows.find((candidate) => candidate.widgets.some((widget) => widget.view_id === viewId));

  if (!row) throw new Error(`The dashboard has no "${viewName}" widget`);
  const index = row.widgets.findIndex((widget) => widget.view_id === viewId);
  const delta = columns - row.widgets[index].width;
  const last = index === row.widgets.length - 1;

  if (last && row.widgets.length === 1) throw new Error(`"${viewName}" is alone in its row and spans every column`);
  // A handle sits after each widget but the last; the last widget grows from its left edge.
  const handle = DashboardSelectors.widthHandle(member, row.id, last ? index - 1 : index);
  const direction = last ? -1 : 1;
  const columnWidth = await rowColumnPitch(member, row.id, row.widgets.length);

  await DashboardSelectors.row(member, row.id).hover();
  await expect(handle).toBeVisible(TEMPLATE_TIMEOUT);
  const box = await handle.boundingBox();

  if (!box) throw new Error('The width handle is not visible');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await dragFromTo(member, from, { x: from.x + direction * delta * columnWidth, y: from.y });
  await expect
    .poll(async () => {
      const current = (await readDashboardSetting(member, dashboardId)).rows.find((candidate) => candidate.id === row.id);

      return current?.widgets.find((widget) => widget.view_id === viewId)?.width;
    }, TEMPLATE_TIMEOUT)
    .toBe(columns);
}
