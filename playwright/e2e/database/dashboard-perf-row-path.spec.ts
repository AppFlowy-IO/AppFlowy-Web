/**
 * The row path of a resident source (PERFORMANCE-REPORT 3.2 W3, W6 b, W14) on
 * the 12-widget employees dashboard of the loading design: a plain grid, four
 * filtered or sorted grids, two boards, three charts and two Number charts,
 * all over the employees database.
 *
 * - Reopening the dashboard inside the app within the idle window shows the
 *   rows the tab holds without waiting for the network, and binds, reads or
 *   opens nothing again. With every response of the employees database held
 *   6 s, every visible widget shows its rows within 3 s; with only its row
 *   path held (its document and blob walk), the plain grid does, and every
 *   visible widget shows its rows before a held response answers.
 * - Perf mode (`DASHBOARD_PERF=1`, a production build, one worker, a load
 *   average under 8): the plain grid shows its rows within 1 s of the return
 *   with the responses held 3 s, and within 500 ms of its start; a cold open
 *   transfers at most 2 MB (the database document is read in binary).
 *
 * The employees suite is opt-in (seeding takes minutes):
 *   RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 [LARGE_DATABASE_CACHE=<file>] \
 *     npx playwright test playwright/e2e/database/dashboard-perf-row-path.spec.ts --workers=1
 * A server that requires a Pro plan for Dashboard views also needs
 * APPFLOWY_TEST_POSTGRES_CONTAINER (see subscription-test-helpers.ts).
 */
import { APIRequestContext, CDPSession, expect, Page, test } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../../src/application/database-yjs/dashboard-loading';
import {
  adoptEmployeesWorkspace,
  createDashboardOverEmployeesViews,
  EMPLOYEES,
  ensureEmployeesViews,
  leaveAndReturnInApp,
  loadingScenario,
  loadingWidgets,
  loadStats,
  LoadingWidget,
  openDashboardUntilLoaded,
  readPageRecord,
  recorderOf,
  slowDownSources,
  startLoadRecording,
  visibleWidgets,
} from '../../support/dashboard-loading-helpers';
import { isDashboardPerfMode } from '../../support/dashboard-perf-probe';
import { fixtureDatabase } from '../../support/dashboard-test-helpers';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from '../../support/employees-database';

/** Seeding the employees database takes minutes. */
const SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;
/** The reopen comes well inside the idle window (`loading.sourceIdleReleaseMs`). */
const RETURN_WITHIN_MS = 30_000;
/** The label of the plain grid widget: the employees database's own grid, without conditions. */
const PLAIN_GRID = `${EMPLOYEES} Grid`;
/** The byte budget of a cold open of the 2,000-row fixture (PERFORMANCE-REPORT 4.3 B). */
const COLD_OPEN_BUDGET_BYTES = 2 * 1024 * 1024;
const FIXTURE_ROWS = 2000;

test.skip(!process.env.RUN_LARGE_DATABASE, 'the employees suite is opt-in (RUN_LARGE_DATABASE=1)');

/** The employees database, its 12 views and a new database with a dashboard showing them, open in View mode. */
async function prepareEmployeesDashboard(page: Page, request: APIRequestContext): Promise<number> {
  const seeded = await openSeededEmployeesDatabase(page, request);

  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
  await ensureEmployeesViews(page, request);
  await createDashboardOverEmployeesViews(page, request);
  return seeded.rowIds.length;
}

function employeesDatabaseId(page: Page): string {
  return fixtureDatabase(page, EMPLOYEES).databaseId;
}

function plainGridWidget(page: Page): LoadingWidget {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === PLAIN_GRID);

  if (!widget) throw new Error(`The dashboard has no "${PLAIN_GRID}" widget`);
  return widget;
}

/**
 * Holds back the responses that bring the employees rows: its document (the
 * JSON route and the binary full-sync read) and its blob walk. The widget
 * chrome (permission and trash probes, view metadata) still answers.
 */
async function holdEmployeesRowPath(page: Page, holdMs: number) {
  const sourceId = employeesDatabaseId(page);
  const rowPath = new RegExp(`/database/${sourceId}/blob(?:/|$)|/collab/${sourceId}(?:/full-sync)?$`);

  await page.route(
    (url) => rowPath.test(url.pathname),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      // The page may have left (or closed) while the response was held back.
      await route.continue().catch(() => undefined);
    }
  );
}

/**
 * Reopens the dashboard inside the app with the employees database held back
 * (`every` response, or only its row path), and returns when it reopened.
 */
async function reopenWithEmployeesHeld(page: Page, holdMs: number, held: 'every' | 'rows' = 'every'): Promise<number> {
  if (held === 'every') await slowDownSources(page, { [EMPLOYEES]: holdMs });
  else await holdEmployeesRowPath(page, holdMs);
  await page.evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.reset());
  const awayMs = await leaveAndReturnInApp(page);

  expect(awayMs, 'ms the dashboard was gone').toBeLessThanOrEqual(RETURN_WITHIN_MS);
  expect(RETURN_WITHIN_MS, 'the return comes before the idle release').toBeLessThan(
    DASHBOARD_LOADING.sourceIdleReleaseMs
  );
  return loadingScenario(page).openedAt as number;
}

/** The requests naming the employees database since `from`, with their times relative to it (a failure message). */
function employeesRequestsSince(page: Page, from: number): string {
  const recorder = recorderOf(page);
  const sourceId = employeesDatabaseId(page);
  const relative = (time: number | undefined) => (time === undefined ? 'open' : `${time - from} ms`);
  const loads = recorder
    .ofSource(sourceId, from)
    .map((entry) => `  ${entry.kind} ${relative(entry.start)} → ${relative(entry.end)} ${new URL(entry.url).pathname}`);
  const others = recorder.others
    .filter((entry) => entry.sourceId === sourceId && entry.start >= from)
    .map((entry) => `  other ${relative(entry.start)} ${entry.url}`);

  return ['requests of the employees database since the return:', ...loads, ...others].join('\n');
}

/** When each of `widgets` first showed data (the page recorder), polled until all did or `withinMs` passed. */
async function firstDataOf(page: Page, widgets: LoadingWidget[], openedAt: number, withinMs: number) {
  const missing = async () => {
    const { data } = await readPageRecord(page);

    return widgets.filter((widget) => data[widget.id] === undefined).map((widget) => widget.label);
  };

  await expect
    .poll(missing, { timeout: Math.max(0, openedAt + withinMs - Date.now()) + 500, intervals: [100] })
    .toEqual([])
    .catch(async () => {
      throw new Error(
        `widgets still without data ${withinMs} ms after the return: ${(await missing()).join(', ')}\n` +
          employeesRequestsSince(page, openedAt)
      );
    });
  return (await readPageRecord(page)).data;
}

/**
 * Bytes received for the app's API requests (`/api/...`) while `action`
 * runs, as the network transferred them (CDP `encodedDataLength`), in total
 * and per request path.
 */
async function apiBytesDuring(page: Page, action: () => Promise<unknown>) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const paths = new Map<string, string>();
  const byPath = new Map<string, number>();
  let total = 0;

  cdp.on('Network.requestWillBeSent', (event: { requestId: string; request: { url: string } }) => {
    const url = new URL(event.request.url);

    if (url.pathname.startsWith('/api/')) paths.set(event.requestId, url.pathname);
  });
  cdp.on('Network.loadingFinished', (event: { requestId: string; encodedDataLength: number }) => {
    const path = paths.get(event.requestId);

    if (path === undefined) return;
    total += event.encodedDataLength;
    byPath.set(path, (byPath.get(path) ?? 0) + event.encodedDataLength);
  });
  await cdp.send('Network.enable');

  try {
    await action();
  } finally {
    await cdp.detach().catch(() => undefined);
  }

  return { total, byPath };
}

/**
 * Waits until the rows the first visit binds stop growing (stable for 2 s): a
 * binding still registering when the dashboard is left would otherwise count
 * as one the return made.
 */
async function waitForBindingsToSettle(page: Page, sourceId: string) {
  let previous = -1;

  await expect
    .poll(
      async () => {
        const bound = (await loadStats(page)).rowsBound[sourceId] ?? 0;
        const settled = bound === previous;

        previous = bound;
        return settled;
      },
      { message: 'the rows the first visit binds keep growing', timeout: 120_000, intervals: [2_000] }
    )
    .toBe(true);
}

/**
 * Reopens the dashboard within the idle window with the employees database
 * held back 6 s, waits until the visible widgets show their rows (within
 * `withinMs` for each of `timed`, before the held responses answer for every
 * other one), and checks that no row is bound, read or opened again.
 */
async function expectReopenFromMemory(
  page: Page,
  request: APIRequestContext,
  held: 'every' | 'rows',
  budget: { withinMs: number; timed: (visible: LoadingWidget[]) => LoadingWidget[] }
) {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await prepareEmployeesDashboard(page, request);
  await startLoadRecording(page);
  await openDashboardUntilLoaded(page);
  const sourceId = employeesDatabaseId(page);

  await waitForBindingsToSettle(page, sourceId);
  const cold = await loadStats(page);

  console.log(
    `[row-path] cold open: rowsBound=${cold.rowsBound[sourceId] ?? 0} rowsRead=${cold.rowsRead[sourceId] ?? 0}`
  );
  const holdMs = 6_000;
  const openedAt = await reopenWithEmployeesHeld(page, holdMs, held);
  const visible = visibleWidgets(page);
  const timed = budget.timed(visible);

  expect(visible.map((widget) => widget.label)).toContain(PLAIN_GRID);
  await firstDataOf(page, timed, openedAt, budget.withinMs);
  // Every visible widget shows its rows before any held response answers: none waited for the network.
  const data = await firstDataOf(page, visible, openedAt, holdMs - 250);
  const { ready } = await readPageRecord(page);

  console.log(
    `[row-path] held ${held}: ms after the return to the source open / first data: ${visible
      .map((widget) => `${widget.label}=${(ready[widget.id] ?? NaN) - openedAt}/${data[widget.id] - openedAt}`)
      .join(', ')}`
  );
  for (const widget of timed) {
    expect(data[widget.id] - openedAt, `ms until the "${widget.label}" widget showed its rows`).toBeLessThanOrEqual(
      budget.withinMs
    );
  }

  for (const widget of visible) {
    expect(data[widget.id] - openedAt, `ms until the "${widget.label}" widget showed its rows`).toBeLessThan(holdMs);
  }

  // Past the held responses: nothing the return started binds or reads a row late.
  await page.waitForTimeout(Math.max(0, openedAt + holdMs + 1_000 - Date.now()));
  const stats = await loadStats(page);

  console.log(
    `[row-path] held ${held}: rowsBound=${stats.rowsBound[sourceId] ?? 0} rowsRead=${
      stats.rowsRead[sourceId] ?? 0
    } sourceOpens=${stats.sourceOpens[sourceId] ?? 0}`
  );
  expect(stats.rowsBound[sourceId] ?? 0, 'employees rows bound again after the return').toBe(0);
  expect(stats.rowsRead[sourceId] ?? 0, 'employees rows read again after the return').toBe(0);
  expect(stats.sourceOpens[sourceId] ?? 0, 'times the employees database was opened again').toBe(0);
}

test.describe('Dashboard row path of a resident source', () => {
  test('a reopen within the idle window shows every visible widget within 3 s with every response of the source held 6 s, and binds no row again', async ({
    page,
    request,
  }) => {
    await expectReopenFromMemory(page, request, 'every', { withinMs: 3_000, timed: (visible) => visible });
  });

  test('a reopen within the idle window shows the plain grid within 3 s and every visible widget from memory with the rows of the source held 6 s', async ({
    page,
    request,
  }) => {
    await expectReopenFromMemory(page, request, 'rows', {
      withinMs: 3_000,
      timed: (visible) => visible.filter((widget) => widget.label === PLAIN_GRID),
    });
  });

  // PERFORMANCE-REPORT W3 guard: the row path (document and blob walk) held 3 s.
  test('perf: with the rows of the source held 3 s the plain grid shows its rows within 1 s of the return and 500 ms of its start', async ({
    page,
    request,
  }) => {
    test.skip(!isDashboardPerfMode(), 'time budget: DASHBOARD_PERF=1 on a production build');
    test.setTimeout(SCENARIO_TIMEOUT_MS);
    await prepareEmployeesDashboard(page, request);
    await startLoadRecording(page);
    await openDashboardUntilLoaded(page);
    const grid = plainGridWidget(page);
    const openedAt = await reopenWithEmployeesHeld(page, 3_000, 'rows');
    const data = await firstDataOf(page, [grid], openedAt, 1_000);

    expect(data[grid.id] - openedAt, 'ms until the plain grid showed its rows').toBeLessThanOrEqual(1_000);
    const stats = await loadStats(page);
    const start = stats.widgetStarts.filter((entry) => entry.widgetId === grid.id).pop();
    const firstData = stats.widgetFirstData[grid.id];

    console.log(
      `[row-path] perf: plain grid rows ${data[grid.id] - openedAt} ms after the return, first data ${
        firstData - (start?.at ?? 0)
      } ms after its start`
    );
    expect(start, 'the plain grid widget started after the return').toBeDefined();
    expect(firstData, 'the plain grid widget reported first data after the return').toBeDefined();
    expect(firstData - (start?.at ?? 0), 'ms from the plain grid start to its first data').toBeLessThanOrEqual(500);
  });

  test('perf: a cold open of the dashboard transfers at most 2 MB', async ({ page, request }) => {
    test.skip(!isDashboardPerfMode(), 'byte budget of the perf job: DASHBOARD_PERF=1');
    test.setTimeout(SCENARIO_TIMEOUT_MS);
    const rows = await prepareEmployeesDashboard(page, request);

    test.skip(rows !== FIXTURE_ROWS, `the budget is set for the ${FIXTURE_ROWS}-row fixture (EMPLOYEES_ROW_LIMIT)`);
    await startLoadRecording(page);
    const sourceId = employeesDatabaseId(page);
    const { total, byPath } = await apiBytesDuring(page, () => openDashboardUntilLoaded(page));
    const documentBytes = [...byPath.entries()]
      .filter(([path]) => path.includes(`/collab/${sourceId}`))
      .reduce((sum, [, bytes]) => sum + bytes, 0);

    console.log(`[row-path] perf: cold open ${total} bytes of API responses, ${documentBytes} for the document`);
    test.info().annotations.push({
      type: 'transfer',
      description: `cold open: ${total} bytes of API responses, of which ${documentBytes} for the employees document`,
    });
    expect(total, `bytes received on a cold open (the employees document: ${documentBytes})`).toBeLessThanOrEqual(
      COLD_OPEN_BUDGET_BYTES
    );
  });
});
