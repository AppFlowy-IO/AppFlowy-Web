/**
 * Grid and board budgets of the 12-widget employees dashboard
 * (PERFORMANCE-REPORT 3.2 W5, W8, W15, W17, W18, W24 and 4.3 A 11, A 12):
 * five grids, two boards and five charts over the employees database, in
 * three rows of four.
 *
 * Counts, on any build:
 * - a grid widget mounts at most its visible rows plus 6, and a row at most
 *   its visible columns plus 4 cells (W18);
 * - a board widget mounts at most 2 cards per visible column plus 6, and
 *   inserts at most twice the cards it keeps while the dashboard loads (W5);
 * - the dashboard holds at most 8,000 elements (W5, W8, W18, W24), counted
 *   as the report counts them: under the dashboard view, so the sidebar of an
 *   account that earlier runs filled with spaces does not count;
 * - on the dev server, fewer than 1,500 `languageChanged` listeners (W8).
 *
 * Times, only in perf mode (`DASHBOARD_PERF=1`, a production build served by
 * `vite preview`, one worker, three runs started at a load average under 8):
 * - the plain grid widget, with 225 rows after 8 "Load more", scrolled by the
 *   wheel at 2,400 px/s keeps at least 55 fps with under 5% dropped frames,
 *   and at 7,200 px/s at least 50 fps (W15);
 * - "Load more" paints its rows within 100 ms (median, W15);
 * - the JS heap after a forced GC with the dashboard open is at most 180 MB
 *   (W17; the value is reported when it is not met);
 * - leaving the dashboard runs no main-thread task over 150 ms (W24).
 *
 * The employees suite is opt-in (seeding takes minutes):
 *   RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 [LARGE_DATABASE_CACHE=<file>] \
 *     npx playwright test playwright/e2e/database/dashboard-perf-grid-board.spec.ts --workers=1
 * A server that requires a Pro plan for Dashboard views also needs
 * APPFLOWY_TEST_POSTGRES_CONTAINER (see subscription-test-helpers.ts).
 */
import { createWriteStream } from 'fs';
import { finished } from 'stream/promises';

import { APIRequestContext, CDPSession, expect, Locator, Page, test, TestInfo } from '@playwright/test';

import {
  adoptEmployeesWorkspace,
  createDashboardOverEmployeesViews,
  EMPLOYEES,
  ensureEmployeesViews,
  HOST,
  loadingWidgets,
  openDashboardUntilLoaded,
  widgetLocatorOf,
} from '../../support/dashboard-loading-helpers';
import {
  domCounts,
  heapAfterGc,
  isDashboardPerfMode,
  measureFrames,
  nextFrames,
  paintLatency,
  readLongTasks,
  startLongTasks,
} from '../../support/dashboard-perf-probe';
import { DashboardSelectors, fixtureDatabase } from '../../support/dashboard-test-helpers';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from '../../support/employees-database';
import { DatabaseViewSelectors } from '../../support/selectors';

/** Seeding the employees database takes minutes. */
const SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;
/** The widget whose rows are scrolled and loaded: the employees database's own grid. */
const PLAIN_GRID = `${EMPLOYEES} Grid`;

/** PERFORMANCE-REPORT 4.3 A 11: mounted items (elements: under the dashboard view, as 2.2 counts its 12,230). */
const GRID_EXTRA_ROWS = 6;
const GRID_EXTRA_CELLS = 4;
const BOARD_CARDS_PER_VISIBLE_COLUMN = 2;
const BOARD_EXTRA_CARDS = 6;
const CARD_INSERTIONS_PER_KEPT_CARD = 2;
const MAX_ELEMENTS = 8_000;
/** PERFORMANCE-REPORT 4.3 A 12. */
const MAX_LANGUAGE_LISTENERS = 1_500;
/** PERFORMANCE-REPORT 4.3 B: targets after W15, W17 and W24. */
const GRID_SLOW_MIN_FPS = 55;
const GRID_SLOW_MAX_DROPPED_PCT = 5;
const GRID_FAST_MIN_FPS = 50;
const LOAD_MORE_PAINT_MS = 100;
const MAX_HEAP_MB = 180;
const LEAVE_LONGEST_TASK_MS = 150;
/** The long grid: 25 rows, and 25 more per "Load more". */
const LONG_GRID_ROWS = 225;
/** 40 px per 60 Hz frame is 2,400 px/s; 120 px is 7,200 px/s. */
const SLOW_WHEEL_STEP_PX = 40;
const FAST_WHEEL_STEP_PX = 120;
const WHEEL_STEPS = 120;

const CARD_INSERTIONS_KEY = '__DASHBOARD_PERF_CARD_INSERTIONS__';

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.RUN_LARGE_DATABASE, 'the employees suite is opt-in (RUN_LARGE_DATABASE=1)');

/** The employees database, its 12 views and a new database with a dashboard showing them. */
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

/**
 * From the next navigation on, counts the board cards mounted into each
 * dashboard widget: every card element counts once, so a card unmounted and
 * mounted again counts twice, and a card moved within the page counts once.
 */
async function countCardInsertions(page: Page) {
  await page.addInitScript((key) => {
    const counts: Record<string, number> = {};
    const cards: Record<string, Set<string>> = {};
    const seen = new WeakSet<Element>();
    const count = (card: Element) => {
      if (seen.has(card)) return;
      seen.add(card);
      const widgetId = card.closest('[data-widget-id]')?.getAttribute('data-widget-id') ?? 'none';

      counts[widgetId] = (counts[widgetId] ?? 0) + 1;
      (cards[widgetId] ??= new Set()).add(card.getAttribute('data-card-id') ?? '');
    };

    (window as unknown as Record<string, unknown>)[key] = { counts, cards };
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches('.board-card')) count(node);
          node.querySelectorAll('.board-card').forEach(count);
        });
      }
    }).observe(document, { childList: true, subtree: true });
  }, CARD_INSERTIONS_KEY);
}

function widgetNamed(page: Page, label: string): Locator {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === label);

  if (!widget) throw new Error(`The dashboard has no "${label}" widget`);
  return widgetLocatorOf(page, widget);
}

/** Read between measurements to distinguish scrolling work from condition recomputation. */
async function derivedComputeCount(page: Page) {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      __DASHBOARD_LOAD_STATS__?: { snapshot: () => { derivedComputes: Record<string, number> } };
    }).__DASHBOARD_LOAD_STATS__;

    return bridge ? Object.values(bridge.snapshot().derivedComputes).reduce((total, count) => total + count, 0) : null;
  });
}

/** The page scrolled to the top, the pointer off the dashboard, and two quiet frames. */
async function restAt(page: Page, top = 0) {
  const view = await DashboardSelectors.view(page).boundingBox();

  await page.mouse.move(Math.max(1, (view?.x ?? 300) - 30), 450);
  await page.evaluate((scrollTop) => document.querySelector('.appflowy-scroll-container')?.scrollTo({ top: scrollTop }), top);
  await page.waitForTimeout(600);
  await nextFrames(page);
}

interface GridCensus {
  label: string;
  rows: number;
  visibleRows: number;
  maxCellsPerRow: number;
  visibleColumns: number;
}

interface BoardCensus {
  label: string;
  cards: number;
  visibleCards: number;
  columns: number;
  visibleColumns: number;
  cardInsertions: number;
  /** Different cards among the insertions: the rest are cards mounted again. */
  distinctCardsInserted: number;
}

/** What every grid and board widget mounts, against what its viewport shows, and the elements of every widget. */
async function census(page: Page): Promise<{
  grids: GridCensus[];
  boards: BoardCensus[];
  dashboardElements: number;
  elementsByWidget: Record<string, number>;
}> {
  const labels = Object.fromEntries(loadingWidgets(page).map((widget) => [widget.id, widget.label]));
  const measured = await page.evaluate((key) => {
    const intersects = (rect: DOMRect, view: DOMRect) =>
      rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right;
    const recorded = (window as unknown as Record<string, unknown>)[key] as
      | { counts: Record<string, number>; cards: Record<string, Set<string>> }
      | undefined;
    const grids: (Omit<GridCensus, 'label'> & { id: string })[] = [];
    const boards: (Omit<BoardCensus, 'label'> & { id: string })[] = [];
    const elementsByWidget: Record<string, number> = {};

    document.querySelectorAll<HTMLElement>('[data-testid="dashboard-widget"]').forEach((widget) => {
      const id = widget.dataset.widgetId ?? '';

      elementsByWidget[id] = widget.getElementsByTagName('*').length;
      const scroller = widget.querySelector('[data-parity-id="dash-widget-grid-scrollbar"]');

      if (scroller) {
        const view = scroller.getBoundingClientRect();
        const rows = Array.from(scroller.querySelectorAll('[data-parity-id="dash-widget-grid-row"]'));
        let visibleColumns = 0;

        const visibleRows = rows.filter((row) => {
          const rect = row.getBoundingClientRect();

          return rect.bottom > view.top && rect.top < view.bottom;
        });

        visibleRows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll(':scope > .grid-row-cell'));

          visibleColumns = Math.max(
            visibleColumns,
            cells.filter((cell) => {
              const rect = cell.getBoundingClientRect();

              return rect.right > view.left && rect.left < view.right;
            }).length
          );
        });
        grids.push({
          id,
          rows: rows.length,
          visibleRows: visibleRows.length,
          maxCellsPerRow: Math.max(0, ...rows.map((row) => row.querySelectorAll(':scope > .grid-row-cell').length)),
          visibleColumns,
        });
      }

      if (widget.querySelector('.database-board')) {
        const body = (widget.querySelector('[data-testid="dashboard-widget-body"]') ?? widget).getBoundingClientRect();
        const columns = Array.from(widget.querySelectorAll('[data-testid="board-column"]'));
        const cards = Array.from(widget.querySelectorAll('.board-card'));

        boards.push({
          id,
          cards: cards.length,
          visibleCards: cards.filter((card) => intersects(card.getBoundingClientRect(), body)).length,
          columns: columns.length,
          visibleColumns: columns.filter((column) => intersects(column.getBoundingClientRect(), body)).length,
          cardInsertions: recorded?.counts[id] ?? 0,
          distinctCardsInserted: recorded?.cards[id]?.size ?? 0,
        });
      }
    });

    const dashboardElements = document.querySelector('[data-testid="dashboard-view"]')?.querySelectorAll('*').length ?? 0;

    return { grids, boards, dashboardElements, elementsByWidget };
  }, CARD_INSERTIONS_KEY);

  return {
    dashboardElements: measured.dashboardElements,
    elementsByWidget: Object.fromEntries(
      Object.entries(measured.elementsByWidget).map(([id, count]) => [labels[id] ?? id, count])
    ),
    grids: measured.grids.map(({ id, ...grid }) => ({ label: labels[id] ?? id, ...grid })),
    boards: measured.boards.map(({ id, ...board }) => ({ label: labels[id] ?? id, ...board })),
  };
}

/**
 * `languageChanged` listeners of the app's i18next instance, on the dev
 * server; `null` on a production build, whose modules cannot be imported by
 * URL. The instance is the one the app imported: the same pre-bundled module
 * URL resolves to the same module.
 */
async function languageChangedListeners(page: Page): Promise<number | null> {
  // A string, so the dynamic import reaches the browser untranspiled.
  return page.evaluate(`(async () => {
    const response = await fetch('/src/i18n/config.ts').catch(() => null);
    if (!response || !response.ok) return null;
    const code = await response.text();
    const url = /["']([^"']*\\/i18next(?:\\/dist\\/esm\\/i18next)?\\.js(?:\\?[^"']*)?)["']/.exec(code)?.[1];
    if (!url) return null;
    const i18n = (await import(url)).default;
    const listeners = i18n && i18n.observers && i18n.observers.languageChanged;
    if (!listeners) return 0;
    if (listeners instanceof Map) {
      let total = 0;
      listeners.forEach((times) => { total += times; });
      return total;
    }
    return listeners.length;
  })()`);
}

/** Sends `count` CDP inputs at a fixed rate without waiting for each (an open loop, like a real wheel). */
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

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) throw new Error('The element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * "Load more" in the grid widget until it holds `LONG_GRID_ROWS` rows (or
 * all of them). Each press is timed from the input to the frame that shows
 * the first new row. Returns the rows the grid holds and the times.
 */
async function loadLongGrid(page: Page, widget: Locator): Promise<{ rows: number; paintsMs: number[] }> {
  const scroller = widget.locator('[data-parity-id="dash-widget-grid-scrollbar"]');
  const loadMore = widget.getByTestId('grid-load-more-row');
  const total = Number(await widget.getByTestId('database-grid').getAttribute('data-row-count'));
  const widgetId = await widget.getAttribute('data-widget-id');
  const paintsMs: number[] = [];
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
    // The virtual item that holds "Load more" holds the first new row once they are loaded.
    const index = await loadMore.evaluate((element) => element.closest('[data-index]')?.getAttribute('data-index'));
    const box = await widget.boundingBox();
    const position = { x: Math.min(80, Math.max(10, (box?.width ?? 200) / 4)), y: 18 };
    const latency = await paintLatency(page, () => loadMore.click({ position }), {
      appears: `[data-widget-id="${widgetId}"] [data-index="${index}"] [data-parity-id="dash-widget-grid-row"]`,
    });

    paintsMs.push(latency.toPaintMs);
    await expect.poll(loaded, { message: 'rows after "Load more"' }).toBeGreaterThan(before);
  }

  const rows = await loaded();

  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  return { rows, paintsMs };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

/** Opt-in profiling: after measured interactions, or at the open sample in diagnostic-only runs. */
async function attachHeapSnapshot(page: Page, testInfo: TestInfo, phase: 'open' | 'after-leave') {
  const path = testInfo.outputPath(`dashboard-${phase}.heapsnapshot`);
  const cdp = await page.context().newCDPSession(page);
  const output = createWriteStream(path);
  const onChunk = ({ chunk }: { chunk: string }) => { output.write(chunk); };

  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await Promise.all([
      (async () => {
        await cdp.send('HeapProfiler.enable');
        // The open snapshot follows the gate's existing heapAfterGc sample.
        // An opt-in diagnostic must not introduce another GC into that sample.
        if (phase === 'after-leave') await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      })().finally(() => output.end()),
      finished(output),
    ]);
    await testInfo.attach(`dashboard-heap-${phase}`, { path, contentType: 'application/json' });
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    output.destroy();
    await cdp.detach().catch(() => undefined);
  }
}

/** Test diagnostics only; never retain the contexts or their documents in the result. */
async function testBridgeRetention(page: Page) {
  return page.evaluate(() => {
    type BridgeContext = {
      workspaceId?: string;
      activeViewId?: string;
      databaseDoc?: {
        guid?: string;
        getMap: (name: string) => { get: (key: string) => { get: (key: string) => unknown } | undefined };
      };
    };
    const contexts =
      (window as unknown as { __DASHBOARD_TEST__?: { contexts?: BridgeContext[] } }).__DASHBOARD_TEST__?.contexts ?? [];
    const identities = contexts.map((context) => [
      context.workspaceId ?? '',
      context.databaseDoc?.getMap('data').get('database')?.get('id') ?? context.databaseDoc?.guid ?? '',
      context.activeViewId ?? '',
    ]);

    return {
      contexts: contexts.length,
      databaseDocuments: new Set(contexts.map((context) => context.databaseDoc).filter(Boolean)).size,
      identities: new Set(identities.map((identity) => JSON.stringify(identity))).size,
      workspaces: new Set(identities.map(([workspace]) => workspace)).size,
      databases: new Set(identities.map(([, database]) => database)).size,
      views: new Set(identities.map(([, , view]) => view)).size,
    };
  });
}

test.describe('Dashboard grid and board performance (12 widgets over the employees database)', () => {
  test('stays within the grid and board budgets', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(SCENARIO_TIMEOUT_MS);
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareEmployeesDashboard(page, request);
    await countCardInsertions(page);
    await openDashboardUntilLoaded(page);
    // The last rows and charts settle after their load completes.
    await page.waitForTimeout(2_000);
    await restAt(page);

    const perf = isDashboardPerfMode();
    const results: Record<string, unknown> = {
      perfMode: perf,
      baseUrl: process.env.BASE_URL ?? null,
      sharedDiagnostic: process.env.DASHBOARD_PERF_DIAGNOSTIC === '1',
    };
    const mounted = await census(page);
    const dom = await domCounts(page);
    const listeners = await languageChangedListeners(page);

    results.grids = mounted.grids;
    results.boards = mounted.boards;
    results.elements = mounted.dashboardElements;
    results.elementsByWidget = mounted.elementsByWidget;
    results.pageElements = dom.elements;
    results.domListeners = dom.listeners;
    results.languageChangedListeners = listeners;

    if (perf) {
      results.heapMb = await heapAfterGc(page);
      results.testBridgeRetention = await testBridgeRetention(page);
      if (process.env.DASHBOARD_PERF_HEAP_SNAPSHOT_OPEN === '1') {
        if (process.env.DASHBOARD_PERF_DIAGNOSTIC !== '1') {
          throw new Error('An open-dashboard heap snapshot requires a diagnostic-only run');
        }

        await attachHeapSnapshot(page, testInfo, 'open');
      }

      const grid = widgetNamed(page, PLAIN_GRID);
      const cdp = await page.context().newCDPSession(page);

      try {
        const long = await loadLongGrid(page, grid);

        results.longGridRows = long.rows;
        results.loadMorePaintMs = long.paintsMs;
        const point = await centerOf(grid.locator('[data-parity-id="dash-widget-grid-scrollbar"]'));
        const scroll = (stepPx: number) =>
          measureFrames(page, async () => {
            await paced(WHEEL_STEPS, 1000 / 60, () => wheel(cdp, point.x, point.y, stepPx));
            await page.waitForTimeout(400);
            await paced(WHEEL_STEPS, 1000 / 60, () => wheel(cdp, point.x, point.y, -stepPx));
          });

        await movePointer(cdp, point.x, point.y);
        await page.waitForTimeout(400);
        const beforeScroll = await derivedComputeCount(page);

        results.gridScrollSlow = await scroll(SLOW_WHEEL_STEP_PX);
        const afterSlow = await derivedComputeCount(page);

        await page.waitForTimeout(600);
        results.gridScrollFast = await scroll(FAST_WHEEL_STEP_PX);
        results.derivedComputationsDuringScroll = {
          beforeScroll,
          afterSlow,
          afterFast: await derivedComputeCount(page),
        };
      } finally {
        await cdp.detach().catch(() => undefined);
      }

      // Leaving the dashboard for the host's grid tab (W24).
      await restAt(page);
      await startLongTasks(page);
      await DatabaseViewSelectors.viewTab(page, fixtureDatabase(page, HOST).views.Grid).click();
      await expect(DashboardSelectors.view(page)).toHaveCount(0);
      await page.waitForTimeout(1_000);
      results.leaveLongTasks = await readLongTasks(page);
    }

    await testInfo.attach('dashboard-perf-grid-board', {
      contentType: 'application/json',
      body: JSON.stringify(results, null, 2),
    });
    // One line per run, for the before and after tables of the report.
    console.log(`[dashboard-perf-grid-board] ${JSON.stringify(results)}`);

    if (
      perf &&
      process.env.DASHBOARD_PERF_HEAP_SNAPSHOT === '1' &&
      process.env.DASHBOARD_PERF_HEAP_SNAPSHOT_OPEN !== '1' &&
      Number(results.heapMb) > MAX_HEAP_MB
    ) {
      await attachHeapSnapshot(page, testInfo, 'after-leave');
    }

    expect(mounted.grids.length, 'grid widgets on the dashboard').toBeGreaterThan(0);
    expect(mounted.boards.length, 'board widgets on the dashboard').toBeGreaterThan(0);
    for (const grid of mounted.grids) {
      expect.soft(grid.rows, `rows mounted by the "${grid.label}" widget (${grid.visibleRows} visible)`).toBeLessThanOrEqual(
        grid.visibleRows + GRID_EXTRA_ROWS
      );
      expect
        .soft(grid.maxCellsPerRow, `cells per row of the "${grid.label}" widget (${grid.visibleColumns} visible)`)
        .toBeLessThanOrEqual(grid.visibleColumns + GRID_EXTRA_CELLS);
    }

    for (const board of mounted.boards) {
      expect
        .soft(board.cards, `cards mounted by the "${board.label}" widget (${board.visibleColumns} columns visible)`)
        .toBeLessThanOrEqual(BOARD_CARDS_PER_VISIBLE_COLUMN * board.visibleColumns + BOARD_EXTRA_CARDS);
      expect
        .soft(board.cardInsertions, `cards inserted by the "${board.label}" widget while loading (${board.cards} kept)`)
        .toBeLessThanOrEqual(CARD_INSERTIONS_PER_KEPT_CARD * board.cards);
    }

    expect.soft(mounted.dashboardElements, 'elements of the open dashboard').toBeLessThanOrEqual(MAX_ELEMENTS);
    if (listeners !== null) {
      expect.soft(listeners, 'languageChanged listeners with the dashboard open').toBeLessThan(MAX_LANGUAGE_LISTENERS);
    }

    if (perf) {
      const slow = results.gridScrollSlow as Awaited<ReturnType<typeof measureFrames>>;
      const fast = results.gridScrollFast as Awaited<ReturnType<typeof measureFrames>>;

      expect(results.longGridRows as number, 'rows in the long grid').toBeGreaterThanOrEqual(LONG_GRID_ROWS);
      expect.soft(slow.fps, 'fps of the long grid scrolled at 2,400 px/s').toBeGreaterThanOrEqual(GRID_SLOW_MIN_FPS);
      expect.soft(slow.droppedPct, '% of frames dropped by the long grid scrolled at 2,400 px/s').toBeLessThan(
        GRID_SLOW_MAX_DROPPED_PCT
      );
      expect.soft(fast.fps, 'fps of the long grid scrolled at 7,200 px/s').toBeGreaterThanOrEqual(GRID_FAST_MIN_FPS);
      expect
        .soft(median(results.loadMorePaintMs as number[]), 'ms from "Load more" to the painted rows (median)')
        .toBeLessThanOrEqual(LOAD_MORE_PAINT_MS);
      expect.soft(results.heapMb as number, 'MB of JS heap after GC with the dashboard open').toBeLessThanOrEqual(
        MAX_HEAP_MB
      );
      expect
        .soft((results.leaveLongTasks as { maxMs: number }).maxMs, 'ms of the longest task when leaving the dashboard')
        .toBeLessThanOrEqual(LEAVE_LONGEST_TASK_MS);
    }
  });
});
