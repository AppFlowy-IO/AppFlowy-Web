/* eslint-disable import/no-named-as-default-member -- protobufjs is CommonJS; its named runtime exports are unavailable in Node ESM. */
/* eslint-disable @typescript-eslint/no-explicit-any -- The dashboard test bridge exposes Yjs state. */
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Page, Request } from '@playwright/test';
import protobuf from 'protobufjs';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';

import {
  addSmallDatabases,
  createDashboardOfViews,
  EMPLOYEES,
  ensureEmployeesViews,
  loadingScenario,
  loadingWidgets,
  loadStats,
  prepareLoadingWorkspace,
  readPageRecord,
  sourceDatabaseNames,
  visibleWidgets,
  waitForWidgetData,
  widgetLocatorOf,
  widgetsBelowTheFold,
} from './dashboard-loading-helpers';
import { ChangeMeasure, measureChange } from './dashboard-performance-timeline';
import { fixtureDatabase } from './dashboard-test-helpers';
import { EMPLOYEE_FIELDS, rememberEmployeeCell, seededEmployeesDatabase } from './employees-database';

interface BudgetRecord {
  requests: { at: number; rowId: string; url: string }[];
  edit?: ChangeMeasure;
  changedDepartments?: { from: string; to: string };
  chartBefore?: Record<string, Record<string, number>>;
  chartAfter?: Record<string, Record<string, number>>;
  mounted?: Record<string, string[]>;
  snapshotAt?: number;
  listener?: (request: Request) => void;
}

const records = new WeakMap<Page, BudgetRecord>();
const ROWS_KEY = '__DASHBOARD_BUDGET_ROWS__';
const batchType = protobuf
  .loadSync(fileURLToPath(new URL('../../src/proto/collab.proto', import.meta.url)))
  .lookupType('collab.CollabBatchSyncRequest');

export function budgetRecord(page: Page): BudgetRecord {
  let record = records.get(page);

  if (!record) {
    record = { requests: [] };
    records.set(page, record);
  }

  return record;
}

function recordMountedRows(key: string) {
  const win = window as any;

  win[key]?.observer?.disconnect();
  const rows: Record<string, Set<string>> = {};
  const read = () => {
    document.querySelectorAll<HTMLElement>('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.dataset.widgetId ?? '';
      const seen = (rows[id] ??= new Set<string>());

      widget
        .querySelectorAll<HTMLElement>(
          '[data-testid^="list-row-"][data-row-id], [data-testid^="gallery-tile-"][data-row-id]'
        )
        .forEach((row) => {
          const testId = row.dataset.testid ?? '';

          // The outer row/card only; their child controls have longer prefixes.
          if (testId.startsWith('list-row-') && !row.hasAttribute('data-row-id')) return;
          const rowId = row.dataset.rowId ?? testId.replace(/^(list-row-|gallery-card-)/, '');

          if (rowId) seen.add(rowId);
        });
    });
  };

  const observer = new MutationObserver(read);

  observer.observe(document, { childList: true, subtree: true });
  read();
  win[key] = { rows, observer };
}

/** Observe requests and mounted rows across the cold navigation as well as warm returns. */
export async function startBudgetRecording(page: Page) {
  const previous = records.get(page);

  if (previous?.listener) page.off('request', previous.listener);
  const record: BudgetRecord = { requests: [] };

  records.set(page, record);
  const employees = sourceDatabaseNames(page).includes(EMPLOYEES);
  const rowIds = new Set(employees ? seededEmployeesDatabase().rowIds : []);

  record.listener = (request) => {
    const url = request.url();
    let ids: string[] = [];

    if (url.endsWith('/collab/full-sync/batch')) {
      const body = request.postDataBuffer();

      if (body) {
        const batch = batchType.decode(body) as unknown as { items?: { objectId?: string }[] };

        ids = (batch.items ?? []).map((item) => item.objectId ?? '').filter((id) => rowIds.has(id));
      }
    } else {
      ids = (url.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi) ?? []).filter((id) => rowIds.has(id));
    }

    for (const rowId of ids) record.requests.push({ at: Date.now(), rowId, url });
  };

  page.on('request', record.listener);
  await page.addInitScript(recordMountedRows, ROWS_KEY);
  await page.evaluate(recordMountedRows, ROWS_KEY);
}

export async function snapshotMountedBudgetRows(page: Page) {
  budgetRecord(page).snapshotAt = Date.now();
  budgetRecord(page).mounted = await page.evaluate((key) => {
    const state = (window as any)[key];

    if (!state) return {};
    return Object.fromEntries(Object.entries(state.rows).map(([id, rows]) => [id, [...(rows as Set<string>)]]));
  }, ROWS_KEY);
}

export async function createSmallBindingBudgetDashboard(page: Page, request: APIRequestContext) {
  await prepareLoadingWorkspace(page, request);
  await addSmallDatabases(page, request, { Small300: 300, Small60: 60, Small20: 20 });
}

export async function ensureEmployeesListGallery(page: Page, request: APIRequestContext) {
  await ensureEmployeesViews(page, request, ['Loading List', 'Loading Gallery']);
}

export async function createEmployeesListGalleryDashboard(page: Page, request: APIRequestContext) {
  await createDashboardOfViews(page, request, [[`${EMPLOYEES} Loading List`, `${EMPLOYEES} Loading Gallery`]]);
}

export async function expectBelowFoldWaitedForDataOrTimeout(page: Page, seconds: number) {
  expect(seconds * 1000).toBe(DASHBOARD_LOADING.deferredStartTimeoutMs);
  const visible = visibleWidgets(page);
  const below = widgetsBelowTheFold(page);

  expect(visible.length).toBeGreaterThan(0);
  expect(below.length).toBeGreaterThan(0);
  await waitForWidgetData(page, loadingWidgets(page));
  const stats = await loadStats(page);
  const first = Math.min(
    ...stats.widgetStarts.filter((start) => visible.some((w) => w.id === start.widgetId)).map((s) => s.at)
  );
  const lastData = Math.max(...visible.map((widget) => stats.widgetFirstData[widget.id]));

  expect(Number.isFinite(first) && Number.isFinite(lastData), 'visible widget times were recorded').toBe(true);
  const earliest = Math.min(lastData, first + seconds * 1000);

  for (const widget of below) {
    const start = stats.widgetStarts.find((entry) => entry.widgetId === widget.id);

    expect(start, `${widget.label} started`).toBeDefined();
    expect(start!.at, `${widget.label} started after visible data or the deferral`).toBeGreaterThanOrEqual(earliest);
  }
}

export async function expectVisibleDataWithin(page: Page, seconds: number) {
  const widgets = visibleWidgets(page);

  await waitForWidgetData(page, widgets);
  const record = await readPageRecord(page);
  const at = loadingScenario(page).openedAt!;

  for (const widget of widgets) expect(record.data[widget.id] - at, widget.label).toBeLessThanOrEqual(seconds * 1000);
}

export async function expectEmployeesReadBudget(page: Page, maximum: 'once' | 'none') {
  const stats = loadingScenario(page).completedStats ?? (await loadStats(page));
  const databaseId = fixtureDatabase(page, EMPLOYEES).databaseId;

  expect(stats.rowsRead[databaseId] ?? 0, 'employees rows read outside resident memory').toBeLessThanOrEqual(
    maximum === 'once' ? seededEmployeesDatabase().rowIds.length : 0
  );
}

async function departmentChartValues(page: Page): Promise<Record<string, Record<string, number>>> {
  const values: Record<string, Record<string, number>> = {};

  for (const name of ['Loading Bar', 'Loading Line']) {
    const widget = loadingWidgets(page).find((entry) => entry.label === `${EMPLOYEES} ${name}`)!;

    values[name] = await widgetLocatorOf(page, widget)
      .locator('[data-testid="chart-data-table"] tr[data-key]')
      .evaluateAll((rows) =>
        Object.fromEntries(
          rows.map((row) => [row.getAttribute('data-key') ?? '', Number(row.getAttribute('data-value'))])
        )
      );
    expect(Object.keys(values[name]).length, `${name} has data before the edit`).toBeGreaterThan(0);
  }

  return values;
}

/** Change a real rendered select cell and independently check the chart's arithmetic. */
export async function changeFirstEmployeeDepartment(page: Page) {
  const widget = loadingWidgets(page).find((entry) => entry.label === `${EMPLOYEES} Grid`)!;
  const scope = widgetLocatorOf(page, widget);
  const row = scope.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])').first();
  const rowId = (await row.getAttribute('data-testid'))!.slice('grid-row-'.length);
  const cell = scope.getByTestId(`grid-cell-${rowId}-${EMPLOYEE_FIELDS.Department}`);
  const record = budgetRecord(page);

  record.chartBefore = await departmentChartValues(page);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const menu = page.getByTestId('select-option-menu');

  await expect(menu).toBeVisible();
  const options = ['engr', 'mktg', 'prod', 'dsgn', 'sale', 'supp', 'hr01', 'fnce'];
  const previous = await page.evaluate(
    ({ databaseId, rowId, fieldId }) => {
      const context = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId);
      const doc = context.rowMap[rowId];

      return String(doc.getMap('data').get('data').get('cells').get(fieldId).get('data'));
    },
    { databaseId: fixtureDatabase(page, EMPLOYEES).databaseId, rowId, fieldId: EMPLOYEE_FIELDS.Department }
  );
  const next = options[(options.indexOf(previous) + 1) % options.length];

  expect(options).toContain(previous);
  record.changedDepartments = { from: previous, to: next };
  const option = menu.getByTestId(`select-option-${next}`);
  const nextLabel = (await option.innerText()).trim();

  await rememberEmployeeCell(page, fixtureDatabase(page, EMPLOYEES).databaseId, rowId, EMPLOYEE_FIELDS.Department);
  record.edit = await measureChange(
    page,
    'pointerdown',
    () => option.click(),
    { rowId, fieldId: EMPLOYEE_FIELDS.Department },
    async () => {
      await expect(cell).toContainText(nextLabel);
    }
  );
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  record.chartAfter = await departmentChartValues(page);
}

export function expectDepartmentChartEdit(page: Page) {
  const record = budgetRecord(page);

  expect(record.edit, 'the Department cell was edited').toBeDefined();
  for (const name of ['Loading Bar', 'Loading Line']) {
    const expected = { ...record.chartBefore![name] };
    const { from, to } = record.changedDepartments!;

    expected[from] = (expected[from] ?? 0) - 1;
    expected[to] = (expected[to] ?? 0) + 1;
    if (expected[from] === 0) delete expected[from];
    expect(record.chartAfter![name], `${name} reflects the Department change`).toEqual(expected);
    expect(record.edit!.changes[`${EMPLOYEES} ${name}`], `${name} content changes`).toBe(1);
  }
}

export function expectOtherChartsUnchanged(page: Page) {
  const changes = budgetRecord(page).edit?.changes;

  expect(changes, 'the Department edit was measured').toBeDefined();
  for (const name of ['Loading Donut', 'Loading Count', 'Loading Sum']) {
    expect(changes![`${EMPLOYEES} ${name}`], `${name} content changes`).toBe(0);
  }
}

export async function expectVisibleRowRequestsOnly(page: Page) {
  const record = budgetRecord(page);

  if (!record.mounted) await snapshotMountedBudgetRows(page);
  const mounted = new Set(Object.values(record.mounted!).flat());
  const requests = record.requests.filter(
    (entry) => entry.at >= loadingScenario(page).openedAt! && entry.at <= record.snapshotAt!
  );

  expect(mounted.size, 'the List and Gallery rendered rows').toBeGreaterThan(0);
  expect(mounted.size, 'the fixture has off-screen rows').toBeLessThan(seededEmployeesDatabase().rowIds.length);
  expect(
    requests.filter((entry) => !mounted.has(entry.rowId)),
    'requests for rows no widget mounted'
  ).toEqual([]);
  // A source may share a request across both views. It may not fetch the
  // entire database merely to obtain per-row metadata or comment counts.
  expect(new Set(requests.map((entry) => entry.rowId)).size).toBeLessThanOrEqual(mounted.size);
}

export async function expectRowsBoundBudget(page: Page, maximum: number) {
  const stats = loadingScenario(page).completedStats ?? (await loadStats(page));

  for (const name of sourceDatabaseNames(page)) {
    const id = fixtureDatabase(page, name).databaseId;

    expect(stats.rowsBound[id] ?? 0, `${name} bound rows`).toBeLessThanOrEqual(maximum);
  }
}
