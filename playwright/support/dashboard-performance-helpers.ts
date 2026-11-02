/* eslint-disable @typescript-eslint/no-explicit-any -- Browser probes and test bridges. */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { budgetRecord } from './dashboard-loading-budget-helpers';
import {
  EMPLOYEES,
  LOAD_TIMEOUT_MS,
  loadingScenario,
  loadingWidgets,
  loadStats,
  readPageRecord,
  resetPageRecorder,
  startLoadRecording,
  visibleWidgets,
  waitForWidgetData,
  widgetLocatorOf,
  widgetsInViewport,
} from './dashboard-loading-helpers';
import { domCounts, DomCounts, heapAfterGc, measureFrames, FrameSummary } from './dashboard-perf-probe';
import { ChangeMeasure, measureChange } from './dashboard-performance-timeline';
import {
  dashboardViewId,
  DashboardSelectors,
  enterEditMode,
  fixtureDatabase,
  globalFilterChip,
  hostDatabase,
  leaveEditMode,
  openWidgetPicker,
  pickExistingView,
  readDashboardSetting,
  waitForDashboardSync,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import { EMPLOYEE_FIELDS } from './employees-database';
import { DatabaseViewSelectors } from './selectors';

interface PerformanceWorld {
  phaseAt: number;
  frames?: FrameSummary;
  settledMs?: number;
  changes?: ChangeMeasure[];
  unchangedLabels?: string[];
  addedWidget?: string;
  memory?: number[];
  baseline?: { heap: number; dom: DomCounts };
  measurements: Record<string, number>;
  samples: Record<string, number[]>;
}

const worlds = new WeakMap<Page, PerformanceWorld>();
const PROBE = '__DASHBOARD_PERFORMANCE_BDD__';

export function performanceWorld(page: Page): PerformanceWorld {
  const world = worlds.get(page);

  if (!world) throw new Error('Dashboard performance has not been recorded');
  return world;
}

/** Installed before navigation, so cold-open stalls are included. */
function installProbe(key: string) {
  const win = window as any;

  win[key]?.observer?.disconnect();
  const state = { tasks: [] as { at: number; ms: number }[], observer: null as PerformanceObserver | null };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      state.tasks.push({ at: performance.timeOrigin + entry.startTime, ms: entry.duration });
  });

  if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('Long Tasks API unavailable');
  observer.observe({ type: 'longtask', buffered: false });
  state.observer = observer;
  win[key] = state;
}

export async function beginDashboardPerformance(page: Page) {
  expect(
    await page.locator('script[src*="/@vite/client"]').count(),
    'performance budgets require a production build'
  ).toBe(0);
  worlds.set(page, { phaseAt: Date.now(), measurements: {}, samples: {} });
  await startLoadRecording(page);
  await page.addInitScript(installProbe, PROBE);
  await page.evaluate(installProbe, PROBE);
}

/** Existing loading steps are also the performance feature's actions. */
export async function performanceOpenAction<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const world = worlds.get(page);

  if (world) world.phaseAt = Date.now();
  const result = await action();

  if (world) world.phaseAt = loadingScenario(page).openedAt ?? world.phaseAt;
  return result;
}

export async function maximumStall(page: Page): Promise<number> {
  const world = performanceWorld(page);

  return page.evaluate(
    ({ key, since }) => {
      const state = (window as any)[key];

      if (!state) throw new Error('The long-task probe is missing');
      for (const entry of state.observer.takeRecords())
        state.tasks.push({ at: performance.timeOrigin + entry.startTime, ms: entry.duration });
      return Math.max(
        0,
        ...state.tasks.filter((entry: { at: number }) => entry.at >= since).map((entry: { ms: number }) => entry.ms)
      );
    },
    { key: PROBE, since: world.phaseAt }
  );
}

export async function recordOpenTime(page: Page, kind: 'first' | 'visible' | 'all'): Promise<number> {
  const world = performanceWorld(page);
  const widgets = kind === 'visible' ? visibleWidgets(page) : loadingWidgets(page);

  if (kind === 'first') {
    await expect
      .poll(async () => Object.keys((await readPageRecord(page)).data).length, { timeout: LOAD_TIMEOUT_MS })
      .toBeGreaterThan(0);
    const first = Math.min(...Object.values((await readPageRecord(page)).data));

    return first - world.phaseAt;
  }

  await expect
    .poll(
      async () => {
        const stats = await loadStats(page);

        return widgets.filter((widget) => stats.widgetComplete[widget.id] === undefined).map((widget) => widget.label);
      },
      { timeout: LOAD_TIMEOUT_MS, message: `waiting for ${kind} widgets to complete` }
    )
    .toEqual([]);
  const stats = await loadStats(page);

  return Math.max(...widgets.map((widget) => stats.widgetComplete[widget.id])) - world.phaseAt;
}

export function assertMeasuredBudget(page: Page, step: string, value: number, budget: number) {
  expect(Number.isFinite(value) && value >= 0, `${step} was measured`).toBe(true);
  performanceWorld(page).measurements[step] = Math.max(value, performanceWorld(page).measurements[step] ?? 0);
  (performanceWorld(page).samples[step] ??= []).push(value);
  // Calibrations collect actual measurements while retaining all assertions.
  // A caller can read failed runs' attachments; calibration never passes a
  // violated starting budget or silently alters a fix-tied threshold.
  expect.soft(value, step).toBeLessThanOrEqual(budget);
}

async function actionFrames(page: Page, action: () => Promise<unknown>) {
  const world = performanceWorld(page);

  world.phaseAt = Date.now();
  world.frames = await measureFrames(page, action);
  expect(world.frames.frames, 'the phase sampled frames').toBeGreaterThan(1);
}

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();

  if (!box) throw new Error('The interaction target has no bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pacedInputs(page: Page, count: number, action: (index: number) => Promise<unknown>) {
  const started = Date.now();

  for (let index = 0; index < count; index += 1) {
    const delay = started + index * (1000 / 60) - Date.now();

    if (delay > 0) await page.waitForTimeout(delay);
    await action(index);
  }
}

export async function scrollPerformancePage(page: Page) {
  const dashboard = DashboardSelectors.view(page);
  const box = await dashboard.boundingBox();

  if (!box) throw new Error('No dashboard is open');
  const range = await dashboard.evaluate((element) => element.scrollHeight - element.clientHeight);

  expect(range, 'the fixture requires page scrolling').toBeGreaterThan(0);
  await dashboard.evaluate((element) => {
    element.scrollTop = 0;
  });
  // The dashboard's inset receives page wheels without hitting a widget scroller.
  await page.mouse.move(box.x + 2, Math.min(box.y + box.height - 2, box.y + 150));
  let furthest = 0;

  await actionFrames(page, async () => {
    await pacedInputs(page, 80, () => page.mouse.wheel(0, 40));
    furthest = await dashboard.evaluate((element) => element.scrollTop);
    await pacedInputs(page, 80, () => page.mouse.wheel(0, -40));
  });
  expect(furthest, 'the wheel gesture moved the dashboard').toBeGreaterThan(0);
  await expect.poll(() => dashboard.evaluate((element) => element.scrollTop)).toBe(0);
}

export async function scrollPerformanceGrid(page: Page, count: number) {
  const widget = loadingWidgets(page).find((entry) => entry.label === `${EMPLOYEES} Grid`)!;
  const grid = widgetLocatorOf(page, widget).locator('[data-parity-id="dash-widget-grid-scrollbar"]');
  const point = await center(grid);

  await page.mouse.move(point.x, point.y);
  const before = await grid.evaluate((element) => element.scrollTop);

  await actionFrames(page, () => pacedInputs(page, count, () => page.mouse.wheel(0, 40)));
  expect(await grid.evaluate((element) => element.scrollTop), 'the wheel gesture moved the grid').toBeGreaterThan(
    before
  );
}

export async function pointerPerformance(page: Page, chart: boolean) {
  const selectors = chart
    ? [
        widgetLocatorOf(page, loadingWidgets(page).find((entry) => entry.label === `${EMPLOYEES} Loading Bar`)!)
          .locator('svg')
          .first(),
      ]
    : await DashboardSelectors.rows(page).all();

  for (const locator of selectors) await locator.scrollIntoViewIfNeeded();
  await actionFrames(page, async () => {
    for (const locator of selectors) {
      if (!chart) await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();

      if (!box) throw new Error('A pointer target is absent');
      await pacedInputs(page, 80, (index) =>
        page.mouse.move(box.x + 10 + ((box.width - 20) * index) / 79, box.y + box.height / 2)
      );
    }
  });
}

/** Settle time excludes the final 100ms observation period, includes mutations and long tasks. */
export async function togglePerformanceMode(page: Page, editing: boolean) {
  const world = performanceWorld(page);

  await page.evaluate(() => {
    const state = { last: performance.now(), observer: null as MutationObserver | null };

    state.observer = new MutationObserver(() => {
      state.last = performance.now();
    });
    state.observer.observe(document.querySelector('[data-testid="dashboard-view"]')!, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    (window as any).__DASHBOARD_MODE_SETTLE__ = state;
  });
  world.phaseAt = Date.now();
  if (editing) await enterEditMode(page);
  else await leaveEditMode(page);
  world.settledMs = await page.evaluate(
    async ({ key, since }) => {
      const state = (window as any).__DASHBOARD_MODE_SETTLE__;
      const began = performance.now();

      try {
        for (;;) {
          const tasks = (window as any)[key].tasks as { at: number; ms: number }[];
          const lastTask = Math.max(since, ...tasks.filter((t) => t.at >= since).map((t) => t.at + t.ms));
          const last = Math.max(performance.timeOrigin + state.last, lastTask);

          if (performance.timeOrigin + performance.now() - last >= 100) return Math.max(0, last - since);
          if (performance.now() - began > 10_000) throw new Error('The dashboard mode did not settle');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        state.observer.disconnect();
      }
    },
    { key: PROBE, since: world.phaseAt }
  );
}

export async function dragPerformanceHandle(page: Page, dimension: 'height' | 'width', seconds: number) {
  const rowId = (await DashboardSelectors.rows(page).first().getAttribute('data-row-id'))!;
  const handle =
    dimension === 'height'
      ? DashboardSelectors.heightHandle(page, rowId)
      : DashboardSelectors.widthHandle(page, rowId, 0);
  const point = await center(handle);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try {
    await actionFrames(page, () =>
      pacedInputs(page, seconds * 60, (index) =>
        page.mouse.move(
          point.x + (dimension === 'width' ? index * 2 : 0),
          point.y + (dimension === 'height' ? index * 2 : 0)
        )
      )
    );
  } finally {
    await page.mouse.up();
  }
}

export async function addPerformanceFilter(page: Page, request: APIRequestContext, kind: 'text' | 'select') {
  const name = kind === 'text' ? 'Name' : 'Department';
  const databaseId = fixtureDatabase(page, EMPLOYEES).databaseId;
  const setting = await readDashboardSetting(page);

  await writeDashboardSetting(page, {
    global_filters: [
      ...setting.global_filters.filter((filter) => filter.name !== name),
      {
        id: `perf-${kind}`,
        name,
        ty: kind === 'text' ? 0 : 3,
        condition: kind === 'text' ? 2 : 0,
        content: '',
        targets: { [databaseId]: EMPLOYEE_FIELDS[name] },
        target_order: [databaseId],
      },
    ],
  });
  await waitForDashboardSync(page, request);
  await expect(globalFilterChip(page, name)).toBeVisible();
}

export async function typePerformanceFilter(page: Page) {
  const world = performanceWorld(page);

  await globalFilterChip(page, 'Name').click();
  const input = page.getByTestId('dashboard-global-filter-content');

  await expect(input).toBeVisible();
  await input.focus();
  world.phaseAt = Date.now();
  world.changes = [];
  world.unchangedLabels = [];
  for (const letter of ['a', 'n']) world.changes.push(await measureChange(page, 'keydown', () => input.press(letter)));
}

export async function togglePerformanceFilter(page: Page, clear: boolean) {
  const world = performanceWorld(page);
  const option = page.locator('[data-testid="dashboard-global-filter-option"][data-option-id="engr"]');

  if (!(await option.isVisible())) await globalFilterChip(page, 'Department').click();
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('data-checked', clear ? 'true' : 'false');
  world.phaseAt = Date.now();
  world.changes = [await measureChange(page, 'pointerdown', () => option.click())];
  // This source view already has the same Engineering filter. Its result must stay identical.
  world.unchangedLabels = [`${EMPLOYEES} Loading Engineering`];
  await expect(option).toHaveAttribute('data-checked', clear ? 'false' : 'true');
}

export function expectPerformanceChanges(page: Page, maximum: number) {
  const world = performanceWorld(page);
  const expected = loadingWidgets(page)
    .map((widget) => widget.label)
    .sort();
  const unchanged = world.unchangedLabels ?? [];
  const measures = world.changes ?? [];

  expect(measures.length, 'at least one filter input was measured').toBeGreaterThan(0);
  for (const measure of measures) {
    expect(Object.keys(measure.changes).sort(), 'every widget was observed').toEqual(expected);
    expect([...measure.changed].sort(), 'all widgets affected by the filter show their new result').toEqual(
      expected.filter((label) => !unchanged.includes(label))
    );
    for (const [label, count] of Object.entries(measure.changes)) expect(count, label).toBeLessThanOrEqual(maximum);
    for (const label of unchanged) expect(measure.changes[label], `${label} keeps its existing result`).toBe(0);
  }
}

export async function addPerformanceWidget(page: Page) {
  // Both clients start with a full fixture and release its last slot before
  // measuring source selection. The 12-widget product limit stays asserted.
  const setting = await readDashboardSetting(page);
  const rows = setting.rows.map((row) => ({ ...row, widgets: [...row.widgets] }));
  const last = rows[rows.length - 1];

  last.widgets.pop();
  if (last.widgets.length === 0) rows.pop();
  await writeDashboardSetting(page, { rows });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(11);
  const id = await openWidgetPicker(page);
  const viewId = fixtureDatabase(page, EMPLOYEES).views.Grid;

  await DashboardSelectors.pickerSearch(page).fill('Grid');
  if (
    !(await DashboardSelectors.pickerOption(page, viewId).isVisible()) &&
    (await DashboardSelectors.pickerOtherSources(page).isVisible())
  ) {
    await DashboardSelectors.pickerOtherSources(page).click();
  }

  const world = performanceWorld(page);

  await resetPageRecorder(page);
  world.phaseAt = Date.now();
  world.addedWidget = id;
  await pickExistingView(page, viewId);
}

export async function newWidgetDataTime(page: Page) {
  const world = performanceWorld(page);

  expect(world.addedWidget).toBeTruthy();
  await expect
    .poll(async () => (await readPageRecord(page)).data[world.addedWidget!], { timeout: LOAD_TIMEOUT_MS })
    .toBeDefined();
  return (await readPageRecord(page)).data[world.addedWidget!] - world.phaseAt;
}

export async function leavePerformanceDashboard(page: Page) {
  const world = performanceWorld(page);

  world.phaseAt = Date.now();
  await DatabaseViewSelectors.viewTab(page, hostDatabase(page).views.Grid).click();
  await expect(DashboardSelectors.view(page)).toHaveCount(0);
  await page.waitForTimeout(200);
}

export async function visitForMemory(page: Page, count: number) {
  if (!worlds.has(page)) await beginDashboardPerformance(page);
  const world = performanceWorld(page);

  await leavePerformanceDashboard(page);
  // The pre-open reference is the same host tab as the final post-leave state.
  await page.waitForTimeout(75_000);
  world.baseline = { heap: await heapAfterGc(page), dom: await domCounts(page) };
  world.memory = [];
  for (let index = 0; index < count; index += 1) {
    await resetPageRecorder(page);
    loadingScenario(page).openedAt = Date.now();
    await DatabaseViewSelectors.viewTab(page, dashboardViewId(page)).click();
    await expect(DashboardSelectors.view(page)).toBeVisible();
    loadingScenario(page).visibleAtOpen = new Set(await widgetsInViewport(page));
    await waitForWidgetData(page, loadingWidgets(page));
    world.memory.push(await heapAfterGc(page));
    if (index < count - 1) await leavePerformanceDashboard(page);
  }
}

export async function expectNoDashboardRetained(page: Page) {
  const baseline = performanceWorld(page).baseline;

  expect(baseline, 'pre-open memory and DOM baseline').toBeDefined();
  const heap = await heapAfterGc(page);
  const dom = await domCounts(page);

  expect(dom.elements, 'post-leave elements').toBeLessThanOrEqual(baseline!.dom.elements);
  expect(dom.listeners, 'CDP listener count is available').not.toBeNull();
  expect(baseline!.dom.listeners, 'baseline CDP listener count is available').not.toBeNull();
  expect(dom.listeners!).toBeLessThanOrEqual(baseline!.dom.listeners!);
  expect(heap, 'post-leave heap, MB').toBeLessThanOrEqual(baseline!.heap + 30);
}

export function editedWidgetsTime(page: Page): number {
  const measure = budgetRecord(page).edit;

  expect(measure, 'the row edit was measured').toBeDefined();
  return measure!.everyWidgetMs;
}

export function performanceMeasurements(page: Page): Record<string, number> {
  return worlds.get(page)?.measurements ?? {};
}

export function performanceSamples(page: Page): Record<string, number[]> {
  return worlds.get(page)?.samples ?? {};
}
