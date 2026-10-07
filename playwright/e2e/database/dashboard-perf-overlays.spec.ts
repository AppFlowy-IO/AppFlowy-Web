/**
 * Overlay and resize budgets of the 12-widget employees dashboard
 * (PERFORMANCE-REPORT 3.2 W10, W11, W13 step 2, W21 and 4.3): a plain grid,
 * four filtered or sorted grids, two boards, a bar, donut and line chart and
 * two Number charts over the employees database, laid out in four rows of
 * three, with a Department global filter. The drags resize row 3 (the Offices
 * board, the bar chart and the donut).
 *
 * Counts, on any build:
 * - while a dashboard popover is open (a widget's Filters popover, its
 *   property picker, a global filter editor) <body> has no inline
 *   pointer-events and no data-scroll-locked attribute (W11: a modal popover
 *   wrote both, and each restyled the whole page on open and on close);
 * - opening the Filters popover restyles fewer than 2,000 elements in any one
 *   style recalculation;
 * - during a row-height drag no element carries --dashboard-row-height and
 *   every widget of the row keeps its content at the height it had before
 *   the drag (W10; the drag rule shared with desktop).
 *
 * Times, only in perf mode (`DASHBOARD_PERF=1`, a production build served by
 * `vite preview`, one worker, three runs started at a load average under 8):
 * - the Filters popover and the global filter editor paint within 80 ms of
 *   the press (median of three);
 * - a 2 s row-height drag keeps at least 50 fps, with no long task over
 *   100 ms and under 250 ms of style recalculation per second (W10);
 * - a 2 s width drag keeps at least 57 fps, and the 1.5 s after a width or a
 *   height commit drop no frame (W21);
 * - at 4x CPU throttling a 4 s pointer sweep over the 8-bar chart keeps at
 *   least 55 fps (W13).
 *
 * The viewport is 1920 × 1080: a row of four 3-column widgets narrower than
 * that wraps (no width handles) or has no column to give (each widget at the
 * 240 px minimum), so its width handle cannot move.
 *
 * The employees suite is opt-in (seeding takes minutes):
 *   RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 [LARGE_DATABASE_CACHE=<file>] \
 *     npx playwright test playwright/e2e/database/dashboard-perf-overlays.spec.ts --workers=1
 * A server that requires a Pro plan for Dashboard views also needs
 * APPFLOWY_TEST_POSTGRES_CONTAINER (see subscription-test-helpers.ts).
 */
import { APIRequestContext, CDPSession, expect, Locator, Page, test } from '@playwright/test';

import {
  adoptEmployeesWorkspace,
  createDashboardOverEmployeesViews,
  EMPLOYEES,
  ensureEmployeesViews,
  loadingWidgets,
  openDashboardUntilLoaded,
  widgetLocatorOf,
} from '../../support/dashboard-loading-helpers';
import {
  FrameSummary,
  isDashboardPerfMode,
  LongTaskSummary,
  measureFrames,
  nextFrames,
  paintLatency,
  readLongTasks,
  startLongTasks,
  StyleRecalcSummary,
  traceStyleRecalc,
} from '../../support/dashboard-perf-probe';
import {
  DashboardSelectors,
  enterEditMode,
  fixtureDatabase,
  globalFilterChip,
  leaveEditMode,
  PersistedRow,
  readDashboardSetting,
  waitForDashboardSync,
  writeDashboardSetting,
} from '../../support/dashboard-test-helpers';
import {
  EMPLOYEE_FIELDS,
  openSeededEmployeesDatabase,
  resetEmployeesDatabaseSettings,
} from '../../support/employees-database';

/** Seeding the employees database takes minutes. */
const SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;
/** A grid with a Department rule: its Filter tool opens the Filters popover. */
const FILTERED_GRID = `${EMPLOYEES} Loading HR`;
/** The bar chart of the eight departments. */
const BAR_CHART = `${EMPLOYEES} Loading Bar`;
/** The global filter seeded for the editor: Department, a single select of the employees database. */
const GLOBAL_FILTER = 'Department';
/** `FieldType.SingleSelect` and `SelectOptionFilterCondition.OptionIs`. */
const SINGLE_SELECT = 3;
const OPTION_IS = 0;

/** PERFORMANCE-REPORT 4.3: counts. */
const MAX_ELEMENTS_PER_RECALC = 2_000;
/** PERFORMANCE-REPORT 4.3 B: targets after W1, W9, W10, W11, W13 and W21. */
const POPOVER_PAINT_MS = 80;
const HEIGHT_DRAG_MIN_FPS = 50;
const HEIGHT_DRAG_MAX_LONG_TASK_MS = 100;
const HEIGHT_DRAG_STYLE_MS_PER_S = 250;
const WIDTH_DRAG_MIN_FPS = 57;
const CHART_SWEEP_MIN_FPS = 55;
const CPU_THROTTLE = 4;
/** 120 pointer moves at 60 Hz. */
const DRAG_MOVES = 120;
const FRAME_INTERVAL_MS = 1000 / 60;
const AFTER_COMMIT_MS = 1_500;

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.RUN_LARGE_DATABASE, 'the employees suite is opt-in (RUN_LARGE_DATABASE=1)');

/** The employees database, its 12 views and a new database with a dashboard showing them, open in View mode. */
async function prepareEmployeesDashboard(page: Page, request: APIRequestContext) {
  const seeded = await openSeededEmployeesDatabase(page, request);

  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
  await ensureEmployeesViews(page, request);
  await createDashboardOverEmployeesViews(page, request);
}

/** A Department global filter over the employees database, with no option picked. */
async function addDepartmentGlobalFilter(page: Page, request: APIRequestContext) {
  const { global_filters: current } = await readDashboardSetting(page);

  if (!current.some((filter) => filter.name === GLOBAL_FILTER)) {
    const employees = fixtureDatabase(page, EMPLOYEES);

    await writeDashboardSetting(page, {
      global_filters: [
        ...current,
        {
          id: 'gf-perf-overlays',
          name: GLOBAL_FILTER,
          ty: SINGLE_SELECT,
          condition: OPTION_IS,
          content: '',
          targets: { [employees.databaseId]: EMPLOYEE_FIELDS.Department },
          target_order: [employees.databaseId],
        },
      ],
    });
    await waitForDashboardSync(page, request);
  }

  await expect(globalFilterChip(page, GLOBAL_FILTER)).toBeVisible({ timeout: 60_000 });
}

/**
 * The same twelve widgets in four rows of three (4 columns each): a full row
 * of four 3-column widgets has no column to give at any common width, so its
 * width handles cannot move. Row 3 then holds the Offices board, the bar
 * chart and the donut.
 */
async function layOutInRowsOfThree(page: Page, request: APIRequestContext) {
  const { rows } = await readDashboardSetting(page);

  if (rows.length === 4 && rows.every((row) => row.widgets.length === 3)) return;
  const widgets = rows.flatMap((row) => row.widgets);
  const next: PersistedRow[] = Array.from({ length: Math.ceil(widgets.length / 3) }, (_, index) => ({
    id: rows[index]?.id ?? `perf-overlays-row-${index + 1}`,
    height: 360,
    widgets: widgets.slice(index * 3, index * 3 + 3).map((widget) => ({ ...widget, width: 4 })),
  }));

  await writeDashboardSetting(page, { rows: next });
  await waitForDashboardSync(page, request);
}

function widgetNamed(page: Page, label: string): Locator {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === label);

  if (!widget) throw new Error(`The dashboard has no "${label}" widget`);
  return widgetLocatorOf(page, widget);
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) throw new Error('The element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What a modal layer writes on <body>. */
async function bodyLocks(page: Page) {
  return page.evaluate(() => ({
    pointerEvents: document.body.style.pointerEvents,
    scrollLocked: document.body.hasAttribute('data-scroll-locked'),
  }));
}

const NO_LOCKS = { pointerEvents: '', scrollLocked: false };

/** Escape until no popover, menu or editor is open, the pointer off the dashboard, and two quiet frames. */
async function restAt(page: Page) {
  const open = page.locator('[data-slot="popover-content"], [role="menu"]');

  for (let attempt = 0; attempt < 5 && (await open.count()) > 0; attempt += 1) await page.keyboard.press('Escape');
  await expect(open).toHaveCount(0);
  const view = await DashboardSelectors.view(page).boundingBox();

  await page.mouse.move(Math.max(1, (view?.x ?? 300) - 30), 450);
  await page.waitForTimeout(600);
  await nextFrames(page);
}

/** Hovers the widget so its tools show, and returns the press on its Filter tool. */
async function reachFilterTool(page: Page, widget: Locator) {
  await widget.scrollIntoViewIfNeeded();
  await widget.hover();
  const tool = widget.getByTestId('database-actions-filter');

  await expect(tool).toBeVisible();
  const point = await centerOf(tool);

  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(300);
  return async () => {
    await page.mouse.down();
    await page.mouse.up();
  };
}

/** Moves onto the global filter pill (its menu code preloads on hover) and returns the press on it. */
async function reachGlobalFilterChip(page: Page) {
  const point = await centerOf(globalFilterChip(page, GLOBAL_FILTER));

  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(400);
  return async () => {
    await page.mouse.down();
    await page.mouse.up();
  };
}

/** Sends `count` CDP inputs at a fixed rate without waiting for each (an open loop, like a real pointer). */
async function paced(count: number, intervalMs: number, send: (index: number) => Promise<unknown>) {
  const startedAt = Date.now();
  const sent: Promise<unknown>[] = [];

  for (let index = 0; index < count; index += 1) {
    const wait = startedAt + index * intervalMs - Date.now();

    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    sent.push(send(index).catch(() => undefined));
  }

  await Promise.all(sent);
}

function mouse(
  cdp: CDPSession,
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  x: number,
  y: number,
  held: boolean
) {
  return cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' && !held ? 'none' : 'left',
    buttons: held || type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'mouse',
  });
}

/** A 2 s drag of `handle`: a slow sine of ±`amplitude` px along the axis, released where it started. */
async function sineDrag(page: Page, cdp: CDPSession, handle: Locator, axis: 'x' | 'y', amplitude: number) {
  const from = await centerOf(handle);

  await mouse(cdp, 'mouseMoved', from.x, from.y, false);
  await page.waitForTimeout(300);
  return async () => {
    await mouse(cdp, 'mousePressed', from.x, from.y, true);
    await paced(DRAG_MOVES, FRAME_INTERVAL_MS, (index) => {
      const offset = Math.sin((index / DRAG_MOVES) * Math.PI * 4) * amplitude;

      return mouse(cdp, 'mouseMoved', from.x + (axis === 'x' ? offset : 0), from.y + (axis === 'y' ? offset : 0), true);
    });
    await mouse(cdp, 'mouseMoved', from.x, from.y, true);
    await page.waitForTimeout(100);
    await mouse(cdp, 'mouseReleased', from.x, from.y, false);
  };
}

/** Drags `handle` by `dx, dy` in 12 steps and returns the release, which commits the new size. */
async function prepareCommit(page: Page, cdp: CDPSession, handle: Locator, dx: number, dy: number) {
  const from = await centerOf(handle);

  await mouse(cdp, 'mouseMoved', from.x, from.y, false);
  await page.waitForTimeout(300);
  await mouse(cdp, 'mousePressed', from.x, from.y, true);
  await paced(12, FRAME_INTERVAL_MS, (index) =>
    mouse(cdp, 'mouseMoved', from.x + (dx * (index + 1)) / 12, from.y + (dy * (index + 1)) / 12, true)
  );
  await page.waitForTimeout(250);
  return async () => {
    await mouse(cdp, 'mouseReleased', from.x + dx, from.y + dy, false);
    await page.waitForTimeout(AFTER_COMMIT_MS);
  };
}

/** Per row element: whether it sets the old inherited custom property, and the content-held widgets. */
async function rowDuringDrag(page: Page, rowId: string) {
  return page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(`[data-testid="dashboard-row"][data-row-id="${id}"]`);

    if (!row) throw new Error(`no row ${id}`);
    const elements = [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))];

    return {
      withRowHeightProperty: elements.filter((element) => element.style?.getPropertyValue('--dashboard-row-height'))
        .length,
      widgets: row.querySelectorAll('[data-testid="dashboard-widget"]').length,
      held: row.querySelectorAll('[data-content-held="true"]').length,
      // The drag's own evidence: the handle's value and the boxes' heights.
      handleValue: document
        .querySelector(`[data-testid="dashboard-height-handle"][data-row-id="${id}"]`)
        ?.getAttribute('aria-valuenow'),
      boxHeights: Array.from(
        row.querySelectorAll<HTMLElement>('[data-testid="dashboard-widget"]'),
        (box) => box.style.height
      ),
    };
  }, rowId);
}

/** Scrolls `locator` to the middle of the viewport (CDP input outside the viewport reaches nothing). */
async function centerInView(page: Page, locator: Locator) {
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.waitForTimeout(300);
}

const VALUES_KEY = '__DASHBOARD_PERF_OVERLAYS_VALUES__';

/** Records every `aria-valuenow` the element shows, once per frame, until `stopValueWatch`: proof that a drag engaged. */
async function startValueWatch(page: Page, selector: string) {
  await page.evaluate(
    ({ selector, key }) => {
      const win = window as unknown as Record<string, { on: boolean; seen: Set<string> }>;
      const state = { on: true, seen: new Set<string>() };
      const tick = () => {
        if (!state.on) return;
        const value = document.querySelector(selector)?.getAttribute('aria-valuenow');

        if (value) state.seen.add(value);
        requestAnimationFrame(tick);
      };

      win[key] = state;
      requestAnimationFrame(tick);
    },
    { selector, key: VALUES_KEY }
  );
}

async function stopValueWatch(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const state = (window as unknown as Record<string, { on: boolean; seen: Set<string> }>)[key];

    state.on = false;
    return Array.from(state.seen);
  }, VALUES_KEY);
}

/** Runs `action` while watching the handle's values; returns them. */
async function watchingHandle(page: Page, handle: Locator, action: () => Promise<unknown>) {
  const testId = await handle.getAttribute('data-testid');
  const rowId = await handle.getAttribute('data-row-id');
  const index = await handle.getAttribute('data-index');
  const selector = `[data-testid="${testId}"][data-row-id="${rowId}"]${index === null ? '' : `[data-index="${index}"]`}`;

  await startValueWatch(page, selector);
  await action();
  return stopValueWatch(page);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

test.describe('Dashboard overlay and resize performance (12 widgets over the employees database)', () => {
  test('stays within the overlay and resize budgets', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(SCENARIO_TIMEOUT_MS);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepareEmployeesDashboard(page, request);
    await addDepartmentGlobalFilter(page, request);
    await layOutInRowsOfThree(page, request);
    await openDashboardUntilLoaded(page);
    // The last rows and charts settle after their load completes.
    await page.waitForTimeout(2_000);
    const perf = isDashboardPerfMode();
    const results: Record<string, unknown> = { perfMode: perf, baseUrl: process.env.BASE_URL ?? null };
    const filtered = widgetNamed(page, FILTERED_GRID);
    const filtersPopover = page.getByTestId('dashboard-widget-filters-popover');

    // --- W11: the widget's Filters popover -------------------------------------------------
    await restAt(page);
    const openFilters = await reachFilterTool(page, filtered);
    const filtersStyle = await traceStyleRecalc(page, async () => {
      await openFilters();
      await expect(filtersPopover).toBeVisible();
    });

    results.filtersStyle = filtersStyle;
    results.filtersBody = await bodyLocks(page);

    // Its property picker ("Add filter"), nested in it.
    await filtersPopover.getByTestId('database-add-filter-button').click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(2);
    results.propertyPickerBody = await bodyLocks(page);
    const closeStyle = await traceStyleRecalc(page, () => restAt(page));

    results.filtersCloseStyle = closeStyle;
    results.afterCloseBody = await bodyLocks(page);

    // --- W11: the global filter editor -----------------------------------------------------
    const openEditor = await reachGlobalFilterChip(page);
    const editorStyle = await traceStyleRecalc(page, async () => {
      await openEditor();
      await expect(page.getByTestId('dashboard-global-filter-option').first()).toBeVisible();
    });

    results.editorStyle = editorStyle;
    results.editorBody = await bodyLocks(page);
    await restAt(page);

    if (perf) {
      const filtersPaints: number[] = [];
      const editorPaints: number[] = [];

      for (let round = 0; round < 3; round += 1) {
        const open = await reachFilterTool(page, filtered);

        filtersPaints.push(
          (await paintLatency(page, open, { appears: '[data-testid="dashboard-widget-filters-popover"]' })).toPaintMs
        );
        await restAt(page);
        const openChip = await reachGlobalFilterChip(page);

        editorPaints.push(
          (await paintLatency(page, openChip, { appears: '[data-testid="dashboard-global-filter-option"]' })).toPaintMs
        );
        await restAt(page);
      }

      results.filtersPaintMs = filtersPaints;
      results.editorPaintMs = editorPaints;
    }

    // --- W10, W21: height and width drags in Edit mode -------------------------------------
    await enterEditMode(page);
    await page.waitForTimeout(800);
    const rows = DashboardSelectors.rows(page);
    // Row 3: the Offices board, the bar chart and the donut. Its height handle, and its width handle
    // between the two charts.
    const resizeRow = rows.nth(2);
    const dragRowId = (await resizeRow.getAttribute('data-row-id')) ?? '';
    const heightHandle = DashboardSelectors.heightHandle(page, dragRowId);
    const widthHandle = DashboardSelectors.widthHandle(page, dragRowId, 1);

    results.rowWrapColumns = await resizeRow.getAttribute('data-wrap-columns');
    await centerInView(page, heightHandle);
    const cdp = await page.context().newCDPSession(page);

    try {
      // Counts during a height drag: no inherited row height, every widget's content held.
      const from = await centerOf(heightHandle);
      const heightBefore = await heightHandle.getAttribute('aria-valuenow');

      await mouse(cdp, 'mouseMoved', from.x, from.y, false);
      await page.waitForTimeout(300);
      await mouse(cdp, 'mousePressed', from.x, from.y, true);
      await paced(12, FRAME_INTERVAL_MS, (index) => mouse(cdp, 'mouseMoved', from.x, from.y + (index + 1) * 10, true));
      await nextFrames(page);
      results.heightBefore = heightBefore;
      results.heightDragRow = await rowDuringDrag(page, dragRowId);
      await mouse(cdp, 'mouseMoved', from.x, from.y, true);
      await page.waitForTimeout(100);
      await mouse(cdp, 'mouseReleased', from.x, from.y, false);
      await page.waitForTimeout(800);

      // The width handle of the chart row: what the press lands on, and the value one column out.
      await centerInView(page, resizeRow);
      await resizeRow.hover();
      await expect(widthHandle).toBeVisible();
      const widthFrom = await centerOf(widthHandle);
      const widthPitch = ((await resizeRow.boundingBox())?.width ?? 1200) / 12;

      results.widthHit = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        const handle = hit?.closest('[data-testid="dashboard-width-handle"]');
        const grid = document.querySelector('[data-testid="dashboard-grid"]');
        const range = `${handle?.getAttribute('aria-valuemin')}-${handle?.getAttribute('aria-valuemax')}`;

        return hit
          ? `${hit.tagName} ${hit.getAttribute('data-testid') ?? ''} range ${range} track ${grid?.getAttribute(
              'data-track-width'
            )}`
          : null;
      }, widthFrom);
      await mouse(cdp, 'mouseMoved', widthFrom.x, widthFrom.y, false);
      await page.waitForTimeout(300);
      await mouse(cdp, 'mousePressed', widthFrom.x, widthFrom.y, true);
      await paced(12, FRAME_INTERVAL_MS, (index) =>
        mouse(cdp, 'mouseMoved', widthFrom.x + (widthPitch * 1.05 * (index + 1)) / 12, widthFrom.y, true)
      );
      await nextFrames(page);
      results.widthDragValue = [await widthHandle.getAttribute('aria-valuenow')];
      await mouse(cdp, 'mouseMoved', widthFrom.x, widthFrom.y, true);
      await page.waitForTimeout(100);
      await mouse(cdp, 'mouseReleased', widthFrom.x, widthFrom.y, false);
      await page.waitForTimeout(800);
      (results.widthDragValue as (string | null)[]).push(await widthHandle.getAttribute('aria-valuenow'));

      if (perf) {
        // Frames and long tasks without tracing, then the style time with it.
        await centerInView(page, heightHandle);
        const drag = await sineDrag(page, cdp, heightHandle, 'y', 120);

        await startLongTasks(page);
        results.heightDragValues = await watchingHandle(page, heightHandle, async () => {
          results.heightDrag = await measureFrames(page, drag);
        });
        results.heightDragLongTasks = await readLongTasks(page);
        await page.waitForTimeout(800);
        const tracedDrag = await sineDrag(page, cdp, heightHandle, 'y', 120);
        const startedAt = Date.now();

        results.heightDragStyle = await traceStyleRecalc(page, tracedDrag);
        results.heightDragStyleSeconds = (Date.now() - startedAt) / 1000;
        await page.waitForTimeout(800);

        // A height commit (+80 px), the 1.5 s after it, then back.
        const commitHeight = await prepareCommit(page, cdp, heightHandle, 0, 80);

        results.afterHeightCommit = await measureFrames(page, commitHeight);
        results.heightAfterCommit = await heightHandle.getAttribute('aria-valuenow');
        await centerInView(page, heightHandle);
        await (
          await prepareCommit(page, cdp, heightHandle, 0, -80)
        )();
        results.heightAfterUndo = await heightHandle.getAttribute('aria-valuenow');

        // A 2 s width drag of the chart row, a width commit (one column) and the 1.5 s after it, then back.
        await centerInView(page, resizeRow);
        await resizeRow.hover();
        await expect(widthHandle).toBeVisible();
        const widthDrag = await sineDrag(page, cdp, widthHandle, 'x', 170);

        results.widthDragValues = await watchingHandle(page, widthHandle, async () => {
          results.widthDrag = await measureFrames(page, widthDrag);
        });
        await page.waitForTimeout(800);
        const pitch = ((await resizeRow.boundingBox())?.width ?? 1200) / 12;
        const widthBefore = await widthHandle.getAttribute('aria-valuenow');
        const commitWidth = await prepareCommit(page, cdp, widthHandle, pitch * 1.05, 0);

        results.afterWidthCommit = await measureFrames(page, commitWidth);
        results.widthCommit = [widthBefore, await widthHandle.getAttribute('aria-valuenow')];
        await (
          await prepareCommit(page, cdp, widthHandle, -pitch * 1.05, 0)
        )();
      }

      await leaveEditMode(page);
      await restAt(page);

      // --- W13: a pointer sweep over the 8-bar chart at 4x CPU -------------------------------
      if (perf) {
        const chart = widgetNamed(page, BAR_CHART);

        await centerInView(page, chart);
        const plot = await chart.locator('.recharts-wrapper').boundingBox();

        if (!plot) throw new Error('The bar chart is not rendered');
        const left = plot.x + 12;
        const right = plot.x + plot.width - 12;
        const y = plot.y + plot.height / 2;

        await mouse(cdp, 'mouseMoved', left, y, false);
        await page.waitForTimeout(400);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
        try {
          results.chartSweep = await measureFrames(page, async () => {
            for (const [start, end] of [
              [left, right],
              [right, left],
              [left, right],
              [right, left],
            ]) {
              await paced(60, FRAME_INTERVAL_MS, (index) =>
                mouse(cdp, 'mouseMoved', start + ((end - start) * index) / 59, y, false)
              );
            }
          });
        } finally {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
      }
    } finally {
      await cdp.detach().catch(() => undefined);
    }

    await testInfo.attach('dashboard-perf-overlays', {
      contentType: 'application/json',
      body: JSON.stringify(results, null, 2),
    });
    // One line per run, for the before and after tables of the report.
    console.log(`[dashboard-perf-overlays] ${JSON.stringify(results)}`);

    expect.soft(results.filtersBody, '<body> while the Filters popover is open').toEqual(NO_LOCKS);
    expect.soft(results.propertyPickerBody, '<body> while its property picker is open').toEqual(NO_LOCKS);
    expect.soft(results.editorBody, '<body> while the global filter editor is open').toEqual(NO_LOCKS);
    expect.soft(results.afterCloseBody, '<body> after they closed').toEqual(NO_LOCKS);
    expect
      .soft(filtersStyle.maxElements, 'elements restyled by the largest recalculation of the Filters popover opening')
      .toBeLessThan(MAX_ELEMENTS_PER_RECALC);
    const heightDragRow = results.heightDragRow as Awaited<ReturnType<typeof rowDuringDrag>>;

    expect(heightDragRow.handleValue, 'the scripted height drag moved the handle').not.toBe(results.heightBefore);
    const [widthMidDrag, widthAfterRelease] = results.widthDragValue as (string | null)[];

    expect(widthMidDrag, 'the scripted width drag moved the handle a column').not.toBe(widthAfterRelease);
    expect.soft(heightDragRow.withRowHeightProperty, 'row elements carrying --dashboard-row-height mid-drag').toBe(0);
    expect.soft(heightDragRow.held, 'widgets of the row holding their content mid-drag').toBe(heightDragRow.widgets);

    if (perf) {
      const heightDrag = results.heightDrag as FrameSummary;
      const heightLongTasks = results.heightDragLongTasks as LongTaskSummary;
      const heightStyle = results.heightDragStyle as StyleRecalcSummary;
      const styleSeconds = results.heightDragStyleSeconds as number;

      expect
        .soft(median(results.filtersPaintMs as number[]), 'ms to the painted Filters popover (median)')
        .toBeLessThanOrEqual(POPOVER_PAINT_MS);
      expect
        .soft(median(results.editorPaintMs as number[]), 'ms to the painted global filter editor (median)')
        .toBeLessThanOrEqual(POPOVER_PAINT_MS);
      // The measured drags engaged: their handles showed more than one value.
      expect(
        (results.heightDragValues as string[]).length,
        'values of the height handle during its drag'
      ).toBeGreaterThan(1);
      expect((results.widthDragValues as string[]).length, 'values of the width handle during its drag').toBeGreaterThan(
        1
      );
      expect.soft(heightDrag.fps, 'fps of a 2 s row-height drag').toBeGreaterThanOrEqual(HEIGHT_DRAG_MIN_FPS);
      expect
        .soft(heightLongTasks.maxMs, 'longest task of a 2 s row-height drag (ms)')
        .toBeLessThanOrEqual(HEIGHT_DRAG_MAX_LONG_TASK_MS);
      expect
        .soft(heightStyle.totalMs / styleSeconds, 'ms of style recalculation per second of a height drag')
        .toBeLessThan(HEIGHT_DRAG_STYLE_MS_PER_S);
      expect
        .soft((results.widthDrag as FrameSummary).fps, 'fps of a 2 s width drag')
        .toBeGreaterThanOrEqual(WIDTH_DRAG_MIN_FPS);
      expect
        .soft(
          (results.afterHeightCommit as FrameSummary).droppedFrames,
          'frames dropped in the 1.5 s after a height commit'
        )
        .toBe(0);
      expect
        .soft(
          (results.afterWidthCommit as FrameSummary).droppedFrames,
          'frames dropped in the 1.5 s after a width commit'
        )
        .toBe(0);
      expect
        .soft((results.chartSweep as FrameSummary).fps, 'fps of a 4 s sweep over the 8-bar chart at 4x CPU')
        .toBeGreaterThanOrEqual(CHART_SWEEP_MIN_FPS);
    }
  });
});
