/**
 * A dashboard inside its own source database: budgets of the performance
 * report's W2 (visible widgets first, the host included) and W25 (one
 * view-meta request per dashboard open).
 *
 * The dashboard is a Dashboard view of the 5,000-row employees database
 * holding its 12 loading views in 4 rows of 3 (`dashboard-perf-shell-helpers.ts`).
 * It seeds, or reuses, the employees account of the large-database suite, so
 * it runs only with RUN_LARGE_DATABASE set:
 *
 *   RUN_LARGE_DATABASE=1 LARGE_DATABASE_CACHE=<file> APPFLOWY_TEST_POSTGRES_CONTAINER=… BASE_URL=http://localhost:3001 \
 *     npx playwright test playwright/e2e/database/dashboard-perf-shell.spec.ts --workers=1
 *
 * The counts are budgets on any build. The times are budgets only on the
 * production preview (`pnpm build && npx vite preview --port 3002 --strictPort`,
 * BASE_URL=http://localhost:3002) with DASHBOARD_PERF=1, 3 runs started at a
 * load average of 8 or less.
 */
import { expect, test } from '@playwright/test';

import { loadStats, openDashboardCold, startLoadRecording } from '../../support/dashboard-loading-helpers';
import { isDashboardPerfMode } from '../../support/dashboard-perf-probe';
import {
  expectAtMostOneViewMetaRequest,
  expectHostWidgetsVisibleFirst,
  HOSTED_COLD_OPEN_LONGEST_TASK_MS,
  HOSTED_COLD_OPEN_VISIBLE_COMPLETE_MS,
  HOSTED_DASHBOARD_SETUP_TIMEOUT_MS,
  hostedColdOpenTimes,
  hostLoadCounts,
  hostPageViewMetaBaseline,
  openHostedDashboardColdMeasured,
  prepareHostedEmployeesDashboard,
  recordViewMetaRequests,
  statsOnceEveryWidgetStarted,
} from '../../support/dashboard-perf-shell-helpers';

test.describe('A dashboard inside its own 5,000-row source database', () => {
  test.skip(
    !process.env.RUN_LARGE_DATABASE,
    'Seeds or reuses the 5,000-row employees database: set RUN_LARGE_DATABASE=1'
  );

  test('starts the visible widgets first and asks for the widget views once', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(HOSTED_DASHBOARD_SETUP_TIMEOUT_MS);
    await prepareHostedEmployeesDashboard(page, request);
    const pageLoad = await hostPageViewMetaBaseline(page);

    await startLoadRecording(page);
    const viewMeta = recordViewMetaRequests(page);

    await openDashboardCold(page);
    const stats = await statsOnceEveryWidgetStarted(page);
    const counts = {
      ...hostLoadCounts(page, stats),
      viewMeta: { perView: viewMeta.perView, batched: viewMeta.batched, hostPageLoad: pageLoad.perView },
      widgetStarts: stats.widgetStarts,
    };

    await testInfo.attach('counts', { contentType: 'application/json', body: JSON.stringify(counts, null, 2) });
    expectHostWidgetsVisibleFirst(page, stats);
    await expectAtMostOneViewMetaRequest(page, viewMeta, pageLoad);
  });

  test('opens cold with no long task over 500 ms and the visible widgets complete within 5.5 s', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(!isDashboardPerfMode(), 'Time budget: production preview with DASHBOARD_PERF=1');
    testInfo.setTimeout(HOSTED_DASHBOARD_SETUP_TIMEOUT_MS);
    await prepareHostedEmployeesDashboard(page, request);
    await startLoadRecording(page);

    const open = await openHostedDashboardColdMeasured(page);
    const times = await hostedColdOpenTimes(page, open);
    const stats = await loadStats(page);

    await testInfo.attach('times', {
      contentType: 'application/json',
      body: JSON.stringify({ ...times, ...hostLoadCounts(page, stats) }, null, 2),
    });
    expect(times.longTasks.maxMs, 'the longest main-thread task of the cold open, in ms').toBeLessThanOrEqual(
      HOSTED_COLD_OPEN_LONGEST_TASK_MS
    );
    expect(
      times.visibleCompleteMs,
      'ms from the navigation start until the visible widgets complete'
    ).toBeLessThanOrEqual(HOSTED_COLD_OPEN_VISIBLE_COMPLETE_MS);
  });
});
