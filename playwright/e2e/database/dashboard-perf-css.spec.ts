/**
 * CSS budgets of the 12-widget employees dashboard (PERFORMANCE-REPORT 3.2
 * W1, W9, W13 and 4.3): a plain grid, four filtered or sorted grids, two
 * boards, three charts and two Number charts over the employees database,
 * in three rows of four.
 *
 * Counts, on any build:
 * - opening a widget menu restyles fewer than 2,000 elements in any one
 *   style recalculation (W1: a sibling rule under `#body :is()` made every
 *   child inserted into <body> restyle the whole page);
 * - showing and hiding a widget title tooltip produces no long task (W1);
 * - no select or person cell is a scroll container at rest, and the page
 *   has at most 70 compositor layers (W13: those cells were horizontal
 *   scroll containers at rest, two compositor layers each).
 *
 * Times, only in perf mode (`DASHBOARD_PERF=1`, a production build served by
 * `vite preview`, one worker, three runs started at a load average under 8):
 * - the widget menu paints within 60 ms of the click (median of five);
 * - a 4 s pointer sweep across the widgets spends under 100 ms in style
 *   recalculation (W9: a universal subject under :hover made every hover
 *   change restyle the hovered row or widget);
 * - the plain grid widget, with 225 rows after "Load more", scrolled by the
 *   wheel at 2,400 px/s keeps at least 55 fps with under 5% dropped frames.
 *
 * The employees suite is opt-in (seeding takes minutes):
 *   RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 [LARGE_DATABASE_CACHE=<file>] \
 *     npx playwright test playwright/e2e/database/dashboard-perf-css.spec.ts --workers=1
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
  isDashboardPerfMode,
  layerCount,
  measureFrames,
  nextFrames,
  paintLatency,
  readLongTasks,
  startLongTasks,
  traceStyleRecalc,
} from '../../support/dashboard-perf-probe';
import { DashboardSelectors } from '../../support/dashboard-test-helpers';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from '../../support/employees-database';

/** Seeding the employees database takes minutes. */
const SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;
/** The widget whose menu, tooltip and rows are measured: the employees database's own grid. */
const PLAIN_GRID = `${EMPLOYEES} Grid`;

/** PERFORMANCE-REPORT 4.3: counts. */
const MAX_ELEMENTS_PER_RECALC = 2_000;
const MAX_LAYERS = 70;
/** PERFORMANCE-REPORT 4.3 B: targets after W1, W9 and W13. */
const MENU_PAINT_MS = 60;
/** The menu paint budget holds for the median of this many opens. */
const MENU_PAINT_ROUNDS = 5;
const SWEEP_STYLE_MS = 100;
const GRID_MIN_FPS = 55;
const GRID_MAX_DROPPED_PCT = 5;
/** The long grid: 25 rows, and 25 more per "Load more". */
const LONG_GRID_ROWS = 225;
/** 40 px per 60 Hz frame. */
const WHEEL_STEP_PX = 40;
const WHEEL_STEPS = 120;

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

function plainGrid(page: Page): Locator {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === PLAIN_GRID);

  if (!widget) throw new Error(`The dashboard has no "${PLAIN_GRID}" widget`);
  return widgetLocatorOf(page, widget);
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) throw new Error('The element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The page scrolled to the top, the pointer off the dashboard, no layer open, and two quiet frames. */
async function restAt(page: Page, top = 0) {
  for (let attempt = 0; attempt < 4 && (await DashboardSelectors.widgetMenu(page).count()) > 0; attempt += 1) {
    await page.keyboard.press('Escape');
  }

  await expect(DashboardSelectors.widgetMenu(page)).toHaveCount(0);
  const view = await DashboardSelectors.view(page).boundingBox();

  await page.mouse.move(Math.max(1, (view?.x ?? 300) - 30), 450);
  await page.evaluate((scrollTop) => document.querySelector('.appflowy-scroll-container')?.scrollTo({ top: scrollTop }), top);
  await page.waitForTimeout(600);
  // Escape restores title focus. Pure pointer measurements must start without
  // that keyboard focus keeping the title tooltip open after the pointer leaves.
  await page.evaluate(() => {
    const focused = document.activeElement;

    if (focused instanceof HTMLElement && focused.matches('[data-testid="dashboard-widget-title-button"]')) {
      focused.blur();
    }
  });
  await nextFrames(page);
  await expect(page.getByTestId('dashboard-widget-source-tooltip')).toHaveCount(0);
}

/** Moves the pointer onto the widget title, then presses it: the widget menu opens. */
async function clickTitle(page: Page, widget: Locator) {
  const title = await centerOf(widget.getByTestId('dashboard-widget-title-button'));

  await page.mouse.move(title.x, title.y);
  // The title tooltip opens on hover (no delay), as for a person reaching for the menu.
  await page.waitForTimeout(350);
  return async () => {
    await page.mouse.down();
    await page.mouse.up();
    await expect(DashboardSelectors.widgetMenu(page)).toBeVisible();
  };
}

/** Sends `count` CDP inputs at a fixed rate without waiting for each (an open loop, like a real pointer or wheel). */
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

function movePointer(cdp: CDPSession, x: number, y: number) {
  return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
}

function wheel(cdp: CDPSession, x: number, y: number, deltaY: number) {
  return cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse' });
}

/** 4 s: horizontal passes across the first two dashboard rows, 60 pointer moves each at 60 Hz. */
async function sweepAcrossWidgets(page: Page, cdp: CDPSession) {
  const view = await DashboardSelectors.view(page).boundingBox();
  const rows = DashboardSelectors.rows(page);
  const ys: number[] = [];

  if (!view) throw new Error('The dashboard is not rendered');
  for (const index of [0, 1]) {
    const box = await rows.nth(index).boundingBox();

    if (!box) throw new Error(`Dashboard row ${index + 1} is not rendered`);
    ys.push(Math.min(860, Math.max(60, box.y + box.height / 2)));
  }

  const left = view.x + 40;
  const right = view.x + view.width - 40;

  await movePointer(cdp, left, ys[0]);
  await page.waitForTimeout(400);
  return async () => {
    for (const y of [ys[0], ys[1], ys[0], ys[1]]) {
      await paced(60, 1000 / 60, (index) => movePointer(cdp, left + ((right - left) * index) / 59, y));
    }
  };
}

/** "Load more" in the grid widget until it holds `LONG_GRID_ROWS` rows (or all of them); returns the rows it holds. */
async function loadLongGrid(page: Page, widget: Locator): Promise<number> {
  const scroller = widget.locator('[data-parity-id="dash-widget-grid-scrollbar"]');
  const loadMore = widget.getByTestId('grid-load-more-row');
  const total = Number(await widget.getByTestId('database-grid').getAttribute('data-row-count'));
  // The "Load more" row is virtualized like the rows: it exists once the grid is scrolled to its end.
  const loaded = async () => {
    await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await page.waitForTimeout(300);
    if ((await loadMore.count()) === 0) return total;
    const remaining = Number(/\((\d+)\)\s*$/.exec((await loadMore.innerText()).trim())?.[1] ?? NaN);

    return total - remaining;
  };

  await widget.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  for (let click = 0; click < 12; click += 1) {
    const before = await loaded();

    if (before >= LONG_GRID_ROWS) break;
    const box = await widget.boundingBox();

    // The button is as wide as the grid's content: press it inside the widget.
    await loadMore.click({ position: { x: Math.min(80, Math.max(10, (box?.width ?? 200) / 4)), y: 18 } });
    await expect.poll(loaded, { message: 'rows after "Load more"' }).toBeGreaterThan(before);
  }

  const rows = await loaded();

  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  return rows;
}

/** Select and person cells that are scroll containers now, and how many such cells the page shows. */
async function scrollingCells(page: Page) {
  return page.evaluate(() => {
    const cells = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="select-option-cell-"], [data-testid^="person-cell-"]')
    );
    const scrolling = cells.filter((cell) => /^(auto|scroll)$/.test(getComputedStyle(cell).overflowX));

    return { cells: cells.length, scrolling: scrolling.length };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

test.describe('Dashboard CSS performance (12 widgets over the employees database)', () => {
  test('stays within the CSS budgets', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(SCENARIO_TIMEOUT_MS);
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareEmployeesDashboard(page, request);
    await openDashboardUntilLoaded(page);
    // The last rows and charts settle after their load completes.
    await page.waitForTimeout(2_000);
    const perf = isDashboardPerfMode();
    const grid = plainGrid(page);
    const results: Record<string, unknown> = { perfMode: perf, baseUrl: process.env.BASE_URL ?? null };

    // Compositor layers at rest (W13), and the select and person cells that are scroll containers at rest.
    await restAt(page);
    const layers = await layerCount(page);
    const cellsAtRest = await scrollingCells(page);

    results.layers = layers;
    results.cellsAtRest = cellsAtRest;
    await restAt(page);

    // Widget menu (W1): the time to paint. Untraced: the end of a CDP trace keeps the renderer busy for a moment.
    if (perf) {
      const paints: number[] = [];

      for (let round = 0; round < MENU_PAINT_ROUNDS; round += 1) {
        const open = await clickTitle(page, grid);

        paints.push((await paintLatency(page, open, { appears: '[data-testid="dashboard-widget-menu"]' })).toPaintMs);
        await restAt(page);
      }

      results.menuPaintMs = paints;
    }

    // Title tooltip (W1): shown, then hidden.
    const title = await centerOf(grid.getByTestId('dashboard-widget-title-button'));
    const tooltip = page.getByTestId('dashboard-widget-source-tooltip');

    await startLongTasks(page);
    await page.mouse.move(title.x, title.y);
    await expect(tooltip).toBeVisible();
    await page.waitForTimeout(1_000);
    await page.mouse.move(title.x - 200, title.y - 60, { steps: 8 });
    await expect(tooltip).toHaveCount(0);
    await page.waitForTimeout(600);
    const tooltipLongTasks = await readLongTasks(page);

    results.tooltipLongTasks = tooltipLongTasks;
    await restAt(page);

    // Every trace comes after the timed and long-task measurements above.
    const openMenu = await clickTitle(page, grid);
    const menuStyle = await traceStyleRecalc(page, openMenu);

    results.menuStyle = menuStyle;
    await restAt(page);

    if (perf) {
      const cdp = await page.context().newCDPSession(page);

      try {
        // Pointer sweep across the widgets of the first two rows (W9).
        const sweep = await sweepAcrossWidgets(page, cdp);

        results.sweepStyle = await traceStyleRecalc(page, sweep);
        await restAt(page);

        // The long grid, scrolled by the wheel at 2,400 px/s, down and back up (W1, W9).
        results.longGridRows = await loadLongGrid(page, grid);
        const scroller = grid.locator('[data-parity-id="dash-widget-grid-scrollbar"]');
        const point = await centerOf(scroller);

        await movePointer(cdp, point.x, point.y);
        await page.waitForTimeout(400);
        results.gridScroll = await measureFrames(page, async () => {
          await paced(WHEEL_STEPS, 1000 / 60, () => wheel(cdp, point.x, point.y, WHEEL_STEP_PX));
          await page.waitForTimeout(400);
          await paced(WHEEL_STEPS, 1000 / 60, () => wheel(cdp, point.x, point.y, -WHEEL_STEP_PX));
        });
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    }

    await testInfo.attach('dashboard-perf-css', { contentType: 'application/json', body: JSON.stringify(results, null, 2) });
    // One line per run, for the before and after tables of the report.
    console.log(`[dashboard-perf-css] ${JSON.stringify(results)}`);

    expect.soft(menuStyle.maxElements, 'elements restyled by the largest recalculation of the widget menu').toBeLessThan(
      MAX_ELEMENTS_PER_RECALC
    );
    expect.soft(tooltipLongTasks.count, 'long tasks while the title tooltip showed and hid').toBe(0);
    expect(cellsAtRest.cells, 'select and person cells on the dashboard').toBeGreaterThan(0);
    expect.soft(cellsAtRest.scrolling, 'select and person cells that are scroll containers at rest').toBe(0);
    expect.soft(layers, 'compositor layers of the dashboard at rest').toBeLessThanOrEqual(MAX_LAYERS);
    if (perf) {
      const gridScroll = results.gridScroll as Awaited<ReturnType<typeof measureFrames>>;

      expect.soft(median(results.menuPaintMs as number[]), 'ms from the click to the painted widget menu (median)').toBeLessThanOrEqual(
        MENU_PAINT_MS
      );
      expect
        .soft((results.sweepStyle as { totalMs: number }).totalMs, 'ms of style recalculation in a 4 s pointer sweep')
        .toBeLessThan(SWEEP_STYLE_MS);
      expect(results.longGridRows as number, 'rows in the long grid').toBeGreaterThanOrEqual(LONG_GRID_ROWS);
      expect.soft(gridScroll.fps, 'fps of the long grid scrolled at 2,400 px/s').toBeGreaterThanOrEqual(GRID_MIN_FPS);
      expect.soft(gridScroll.droppedPct, '% of frames dropped by the long grid scrolled at 2,400 px/s').toBeLessThan(
        GRID_MAX_DROPPED_PCT
      );
    }
  });
});
