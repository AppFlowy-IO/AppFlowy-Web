/**
 * Helpers of the shared `dashboard-chart-render` feature (WP10 §6.4).
 *
 * The scenario world comes from `dashboard-parity/bdd/chart-fixtures.json`,
 * which desktop seeds too: databases with option colors and number / date
 * formats, rows with absolute dates and chart views. Charts are read through
 * their test hooks: the hidden data table (raw values and colors), the data
 * label and category label hooks, the category anchors and the portal
 * tooltip.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';

import { Types } from '../../src/application/types';

import {
  apiGet,
  apiPost,
  dashboardWorld,
  FieldSpec,
  FieldType,
  fixtureDatabase,
  namedOptionId,
  openDatabasePage,
  readDashboardSetting,
  splitList,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import {
  addUseCaseDatabase,
  addUseCaseViews,
  namedView,
  rememberFieldTypes,
  rememberSelectOptions,
  USE_CASE_TIMEOUT,
  waitForViewSync,
} from './dashboard-usecase-helpers';

export const CHART_TIMEOUT = { timeout: USE_CASE_TIMEOUT };

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface FixtureProperty {
  name: string;
  type: 'SingleSelect' | 'Number' | 'DateTime';
  options?: [string, string][];
  numberFormat?: string;
  dateFormat?: string;
}

interface FixtureView {
  name: string;
  layout: 'Chart';
  chart: { chart_type: number; x_field: string; aggregation_type: number; y_field?: string; date_condition?: number };
}

interface FixtureDatabaseSpec {
  name: string;
  properties: FixtureProperty[];
  rows: (string | number | null)[][];
  rowColumns?: string[];
  views: FixtureView[];
}

type ChartFixtures = Record<string, { databases?: FixtureDatabaseSpec[] } | string | number>;

const FIXTURE_PATH = fileURLToPath(
  new URL('../../src/application/database-yjs/__fixtures__/dashboard-parity/bdd/chart-fixtures.json', import.meta.url)
);

/** `NumberFormat` ids by the fixture's names. */
const NUMBER_FORMATS: Record<string, number> = { Num: 0, USD: 1 };
/** `DateFormat` ids by the fixture's names. */
const DATE_FORMATS: Record<string, number> = { Local: 0, US: 1, ISO: 2, Friendly: 3, DayMonthYear: 4 };
const FIELD_TYPES: Record<FixtureProperty['type'], FieldType> = {
  SingleSelect: FieldType.SingleSelect,
  Number: FieldType.Number,
  DateTime: FieldType.DateTime,
};
/** The use-case view layout names by `ChartTypePB`; horizontal bars are created as bars and switched after. */
const LAYOUT_BY_CHART_TYPE: Record<number, string> = { 0: 'Bar chart', 1: 'Line chart', 2: 'Bar chart', 3: 'Donut chart' };
const CHART_TYPE_HORIZONTAL_BAR = 2;

function loadChartFixture(key: string): FixtureDatabaseSpec[] {
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ChartFixtures;
  const entry = fixtures[key];

  if (typeof entry !== 'object' || !entry.databases) throw new Error(`chart-fixtures.json has no "${key}" fixture`);
  return entry.databases;
}

/** Local noon of an absolute `YYYY-MM-DD` day, as the web stores a picked date. */
function localNoonIso(day: string) {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(year, month - 1, date, 12).toISOString();
}

interface TypeOptionUpdate {
  fieldId: string;
  type: FieldType;
  entries: Record<string, unknown>;
}

/** The fixture's type options (option colors, number and date formats), written into the database doc. */
function typeOptionUpdates(spec: FixtureDatabaseSpec, fieldIds: Record<string, string>): TypeOptionUpdate[] {
  return spec.properties.flatMap((property): TypeOptionUpdate[] => {
    const fieldId = fieldIds[property.name];
    const type = FIELD_TYPES[property.type];

    if (property.type === 'SingleSelect') {
      const options = (property.options ?? []).map(([name, color]) => ({ id: namedOptionId(name), name, color }));

      return [{ fieldId, type, entries: { content: JSON.stringify({ options, disable_color: false }) } }];
    }

    if (property.type === 'Number' && property.numberFormat) {
      return [{ fieldId, type, entries: { format: NUMBER_FORMATS[property.numberFormat] ?? 0 } }];
    }

    if (property.type === 'DateTime' && property.dateFormat) {
      return [{ fieldId, type, entries: { date_format: DATE_FORMATS[property.dateFormat] ?? 0 } }];
    }

    return [];
  });
}

async function writeTypeOptions(page: Page, databaseId: string, updates: TypeOptionUpdate[]) {
  await page.evaluate(
    ({ databaseId, updates }) => {
      const win = window as any;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const fields = doc.getMap('data').get('database').get('fields');

      doc.transact(() => {
        updates.forEach(({ fieldId, type, entries }: { fieldId: string; type: number; entries: Record<string, unknown> }) => {
          const field = fields.get(fieldId);
          let typeOptions = field.get('type_option');

          if (!typeOptions) {
            typeOptions = new win.Y.Map();
            field.set('type_option', typeOptions);
          }

          let option = typeOptions.get(String(type));

          if (!option) {
            option = new win.Y.Map();
            typeOptions.set(String(type), option);
          }

          Object.entries(entries).forEach(([key, value]) => option.set(key, value));
        });
      });
    },
    { databaseId, updates }
  );
}

/** Wait until the server holds the type options the browser wrote. */
async function waitForTypeOptionSync(
  page: Page,
  request: APIRequestContext,
  databaseId: string,
  updates: TypeOptionUpdate[]
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

        Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
        const fields = (doc.getMap('data').get('database') as Y.Map<any> | undefined)?.get('fields') as
          | Y.Map<Y.Map<any>>
          | undefined;

        return updates.every(({ fieldId, type, entries }) => {
          const option = fields?.get(fieldId)?.get('type_option')?.get(String(type));

          return Object.entries(entries).every(([key, value]) => option?.get(key) === value);
        });
      },
      { timeout: USE_CASE_TIMEOUT, message: 'waiting for the chart fixture type options to reach the server' }
    )
    .toBe(true);
}

async function browserRowIds(page: Page, databaseId: string, viewId: string): Promise<string[]> {
  return page.evaluate(
    ({ databaseId, viewId }) => {
      const ctx = (window as any).__DASHBOARD_TEST__?.byDatabase(databaseId);
      const orders = ctx?.databaseDoc.getMap('data').get('database')?.get('views')?.get(viewId)?.get('row_orders');

      return orders ? orders.toArray().map((order: { id: string }) => order.id) : [];
    },
    { databaseId, viewId }
  );
}

async function addFixtureRows(page: Page, request: APIRequestContext, spec: FixtureDatabaseSpec) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, spec.name);
  const columns = spec.rowColumns ?? ['Name', ...spec.properties.map((property) => property.name)];
  const types = new Map(spec.properties.map((property) => [property.name, property.type]));
  const base = `/api/workspace/${world.workspaceId}/database/${database.databaseId}`;

  for (const row of spec.rows) {
    const cells: Record<string, string | number> = {};

    row.forEach((value, index) => {
      const column = columns[index];

      if (value === null || value === undefined || value === '') return;
      cells[column] = types.get(column) === 'DateTime' ? localNoonIso(String(value)) : value;
    });
    database.rowIds[String(row[0])] = await apiPost<string>(request, world.owner.accessToken, `${base}/row`, {
      cells,
      document: null,
      parse_link_as_link_preview: false,
    });
  }

  if (spec.rows.length === 0) return;
  await openDatabasePage(page, spec.name, database.views.Grid);
  const expected = Object.values(database.rowIds);

  await expect
    .poll(
      async () => {
        const ids = await browserRowIds(page, database.databaseId, database.views.Grid);

        return expected.every((id) => ids.includes(id));
      },
      { timeout: USE_CASE_TIMEOUT, message: `waiting for the "${spec.name}" rows to reach the browser` }
    )
    .toBe(true);
}

/** Switch a chart view's `chart_type` (horizontal bars have no use-case layout name). */
async function setChartType(page: Page, databaseId: string, viewId: string, chartType: number) {
  await page.evaluate(
    ({ databaseId, viewId, chartType }) => {
      const ctx = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId);
      const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(viewId);

      ctx.databaseDoc.transact(() => view.get('layout_settings').get('3').set('chart_type', chartType));
    },
    { databaseId, viewId, chartType }
  );
}

/** Seed every database of a `chart-fixtures.json` entry: properties, type options, rows and chart views. */
export async function seedChartFixture(page: Page, request: APIRequestContext, key: string) {
  for (const spec of loadChartFixture(key)) {
    const fields: FieldSpec[] = spec.properties.map((property) => ({
      name: property.name,
      type: FIELD_TYPES[property.type],
      options: property.type === 'SingleSelect' ? (property.options ?? []).map(([name]) => name) : undefined,
    }));

    await addUseCaseDatabase(page, request, spec.name, fields);
    rememberFieldTypes(page, spec.name, fields);
    rememberSelectOptions(page, spec.name, fields);
    const database = fixtureDatabase(page, spec.name);
    const updates = typeOptionUpdates(spec, database.fieldIds);

    await openDatabasePage(page, spec.name, database.views.Grid);
    await writeTypeOptions(page, database.databaseId, updates);
    await waitForTypeOptionSync(page, request, database.databaseId, updates);
    await addFixtureRows(page, request, spec);

    await addUseCaseViews(
      page,
      request,
      spec.name,
      spec.views.map((view) => ({
        view: view.name,
        layout: LAYOUT_BY_CHART_TYPE[view.chart.chart_type],
        settings:
          view.chart.aggregation_type === 0
            ? `count by ${view.chart.x_field}`
            : `sum of ${view.chart.y_field} by ${view.chart.x_field}`,
      }))
    );
    const horizontal = spec.views
      .filter((view) => view.chart.chart_type === CHART_TYPE_HORIZONTAL_BAR)
      .map((view) => namedView(page, view.name).viewId);

    if (horizontal.length === 0) continue;
    const rewrite = async () => {
      for (const viewId of horizontal) await setChartType(page, database.databaseId, viewId, CHART_TYPE_HORIZONTAL_BAR);
    };

    await rewrite();
    await waitForViewSync(page, request, spec.name, horizontal, rewrite);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** `'a, b | c'` → `[['a', 'b'], ['c']]`. */
export function parseWidgetRows(text: string): string[][] {
  return text.split('|').map((row) => splitList(row));
}

/** `'Alice: $48.5K, Bob: $1.3M'` → `{ Alice: '$48.5K', Bob: '$1.3M' }` (values may hold commas). */
export function parseLabelMap(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split(/,\s+(?=[^:,]+:\s)/).map((entry) => {
      const separator = entry.indexOf(': ');

      return [entry.slice(0, separator).trim(), entry.slice(separator + 2).trim()];
    })
  );
}

// ---------------------------------------------------------------------------
// Reading a chart
// ---------------------------------------------------------------------------

/** The chart inside a widget, or on a standalone chart page. */
export function chartRoot(scope: Locator | Page): Locator {
  return scope.getByTestId('database-chart').first();
}

/** `data-label` → text of every data label. */
export async function dataLabels(scope: Locator): Promise<Record<string, string>> {
  return scope.evaluate((element) => {
    const result: Record<string, string> = {};

    element.querySelectorAll('[data-testid="chart-data-label"]').forEach((label) => {
      result[label.getAttribute('data-label') ?? ''] = (label.textContent ?? '').trim();
    });
    return result;
  });
}

/** Value-axis tick texts, bottom to top (left to right for horizontal bars). */
export async function valueTicks(scope: Locator): Promise<string[]> {
  return scope.evaluate((element) => {
    const ticks = Array.from(element.querySelectorAll('[data-testid="chart-value-tick"]')).map((tick) => {
      const rect = tick.getBoundingClientRect();

      return { text: (tick.textContent ?? '').trim(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    // A horizontal bar chart's ticks share one row; a value axis on the left reads bottom to top.
    const onOneRow = ticks.every((tick) => Math.abs(tick.y - ticks[0].y) < 2);

    return (onOneRow ? ticks.sort((a, b) => a.x - b.x) : ticks.sort((a, b) => b.y - a.y)).map((tick) => tick.text);
  });
}

export interface ChartTableRow {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** The hidden data table: every category in display order with its raw value and color. */
export async function chartTable(scope: Locator): Promise<ChartTableRow[]> {
  return scope.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-testid="chart-data-table"] tr[data-label]')).map((row) => ({
      key: row.getAttribute('data-key') ?? '',
      label: row.getAttribute('data-label') ?? '',
      value: Number(row.getAttribute('data-value')),
      color: (row.getAttribute('data-color') ?? '').toUpperCase(),
    }))
  );
}

/** The centre of the category's hover target, in viewport coordinates. */
export async function categoryPoint(scope: Locator, label: string): Promise<{ x: number; y: number }> {
  const point = await scope.evaluate((element, label) => {
    const anchor = Array.from(element.querySelectorAll('[data-testid="chart-category-anchor"]')).find(
      (candidate) => candidate.getAttribute('data-label') === label
    );

    if (anchor) {
      const rect = anchor.getBoundingClientRect();

      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }

    const slice = Array.from(element.querySelectorAll('[data-testid="chart-donut-slice-anchor"]')).find(
      (candidate) => candidate.getAttribute('data-label') === label
    );
    const surface = slice?.closest('svg');

    if (!slice || !surface) return null;
    const rect = surface.getBoundingClientRect();

    return { x: rect.x + Number(slice.getAttribute('data-x')), y: rect.y + Number(slice.getAttribute('data-y')) };
  }, label);

  if (!point) throw new Error(`The chart has no "${label}" category`);
  return point;
}

/** Point at a category the way a user does. */
export async function hoverChartCategory(page: Page, scope: Locator, label: string) {
  await expect
    .poll(() => categoryPoint(scope, label).then(() => true).catch(() => false), CHART_TIMEOUT)
    .toBe(true);
  const point = await categoryPoint(scope, label);

  await page.mouse.move(point.x - 2, point.y);
  await page.mouse.move(point.x, point.y);
}

export function chartTooltip(page: Page): Locator {
  return page.getByTestId('chart-tooltip');
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Resize a dashboard row by writing its height, as a finished drag does. */
export async function setDashboardRowHeight(page: Page, oneBasedRow: number, height: number) {
  const setting = await readDashboardSetting(page);
  const rows = setting.rows.map((row, index) => (index === oneBasedRow - 1 ? { ...row, height } : row));

  await writeDashboardSetting(page, { rows, global_filters: setting.global_filters });
}

/** A collaborator edits a cell: written straight into the row doc the dashboard holds. */
export async function writeCellInBackground(
  page: Page,
  databaseName: string,
  rowTitle: string,
  property: string,
  value: string
) {
  const database = fixtureDatabase(page, databaseName);
  const rowId = database.rowIds[rowTitle];
  const fieldId = database.fieldIds[property];

  if (!rowId || !fieldId) throw new Error(`"${databaseName}" has no "${rowTitle}" row or "${property}" property`);
  const written = await page.evaluate(
    ({ databaseId, rowId, fieldId, value }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      // The same match as the bridge's `byDatabase`, newest context first.
      const contexts = (bridge?.contexts ?? []).filter(
        (ctx: any) =>
          ctx.databaseDoc?.getMap('data')?.get('database')?.get('id') === databaseId || ctx.databaseDoc?.guid === databaseId
      );

      for (const ctx of contexts.reverse()) {
        const rowDoc = ctx.rowMap?.[rowId];
        // The row's data section ('data') holds the database row under 'data'.
        const cell = rowDoc?.getMap('data')?.get('data')?.get('cells')?.get(fieldId);

        if (!cell) continue;
        rowDoc.transact(() => cell.set('data', value));
        return true;
      }

      return false;
    },
    { databaseId: database.databaseId, rowId, fieldId, value }
  );

  if (!written) throw new Error(`No mounted row doc holds "${rowTitle}"`);
}

/** Open the chart settings menu of the open chart page (gear → Chart settings). */
export async function openChartSettingsMenu(page: Page) {
  await closeMenus(page);
  await page.getByTestId('database-actions-settings').first().click();
  const chartSettings = page.getByRole('menuitem', { name: /chart settings/i });

  await expect(chartSettings).toBeVisible(CHART_TIMEOUT);
  await chartSettings.click();
}

/**
 * Point at a row of the open Chart settings submenu the way a user does:
 * across into the submenu first, then along it to the row. (A straight jump
 * from the trigger crosses the root menu, which closes the submenu.)
 */
async function pointAtChartSettingsRow(page: Page, row: Locator) {
  await expect(row).toBeVisible(CHART_TIMEOUT);
  const trigger = await page.getByRole('menuitem', { name: /chart settings/i }).boundingBox();
  const submenu = await row.locator('xpath=ancestor::*[@role="menu"][1]').boundingBox();

  if (!trigger || !submenu) throw new Error('The Chart settings submenu is not open');
  await page.mouse.move(submenu.x + submenu.width / 2, trigger.y + trigger.height / 2, { steps: 10 });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();

  if (!box) throw new Error('The chart settings row is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
}

/** Pick `optionTestId` in the chart style submenu behind `rowTestId`. */
export async function pickChartStyleOption(page: Page, rowTestId: string, optionTestId: string) {
  await openChartSettingsMenu(page);
  const row = page.getByTestId(rowTestId);

  await pointAtChartSettingsRow(page, row);
  await row.click();
  const option = page.getByTestId(optionTestId);

  await expect(option).toBeVisible(CHART_TIMEOUT);
  await option.click();
  await closeMenus(page);
}

export async function toggleChartStyleRow(page: Page, rowTestId: string) {
  await openChartSettingsMenu(page);
  const row = page.getByTestId(rowTestId);

  await pointAtChartSettingsRow(page, row);
  await row.click();
  await closeMenus(page);
}

export async function closeMenus(page: Page) {
  for (let attempt = 0; attempt < 4 && (await page.locator('[role="menu"]').count()) > 0; attempt += 1) {
    await page.keyboard.press('Escape');
  }

  await expect(page.locator('[role="menu"]')).toHaveCount(0);
}

/** A chart view's raw stored value of `key` (`null` for a stored null, `undefined` when absent). */
export async function storedChartValue(page: Page, viewName: string, key: string): Promise<unknown> {
  const view = namedView(page, viewName);
  const database = fixtureDatabase(page, view.database);

  return page.evaluate(
    ({ databaseId, viewId, key }) => {
      const ctx = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId);
      const chart = ctx?.databaseDoc.getMap('data').get('database')?.get('views')?.get(viewId)?.get('layout_settings')?.get('3');

      if (!chart || !chart.has(key)) return { absent: true };
      const value = chart.get(key);

      return { value: typeof value === 'bigint' ? Number(value) : value };
    },
    { databaseId: database.databaseId, viewId: view.viewId, key }
  ).then((result: { absent?: boolean; value?: unknown }) => (result.absent ? undefined : result.value));
}

/** The stored value as the feature spells it: `null`, `false`, `2`, `blue`. */
export function spellStoredValue(value: unknown): string {
  if (value === undefined) return '<absent>';
  if (value === null) return 'null';
  return String(value);
}
