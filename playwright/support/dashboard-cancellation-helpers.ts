import { expect, Page, Request, Route } from '@playwright/test';

import {
  loadingScenario,
  loadingWidgets,
  loadStats,
  openDashboardCold,
  recorderOf,
  scrollToLastRow,
  widgetLocatorOf,
  widgetsInViewport,
} from './dashboard-loading-helpers';
import { DashboardSelectors, fixtureDatabase } from './dashboard-test-helpers';

/** Hold real responses until after scrolling, so a timeout cannot masquerade as cancellation. */
export async function checkOffscreenCancellation(page: Page, stage: string) {
  expect(['document', 'row']).toContain(stage);
  const widgets = loadingWidgets(page);
  const firstRow = widgets.filter((widget) => widget.row === 1);
  const lastRow = widgets.filter((widget) => widget.row === Math.max(...widgets.map((item) => item.row)));
  const sourceIds = firstRow.map((widget) => fixtureDatabase(page, widget.database).databaseId);
  const held = new Set<Request>();
  const cancelled = new Set<Request>();
  let release!: () => void;
  let holding = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onFailed = (request: Request) => {
    if (held.has(request) && /ABORTED|cancelled/i.test(request.failure()?.errorText ?? '')) cancelled.add(request);
  };
  const routeHandler = async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const matches = sourceIds.some((id) =>
      stage === 'document' ? path.endsWith(`/collab/${id}/full-sync`) : path.endsWith(`/database/${id}/blob/diff`)
    );

    if (!holding || !matches) return route.continue();
    held.add(request);
    const response = await route.fetch();

    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  };

  page.on('requestfailed', onFailed);
  await page.route('**/*', routeHandler);
  try {
    await page.setViewportSize({ width: 1440, height: 650 });
    await openDashboardCold(page);
    await expect.poll(() => held.size, { timeout: 20_000 }).toBe(2);
    expect((await loadStats(page)).widgetStarts).toHaveLength(2);
    await scrollToLastRow(page);
    const visible = await widgetsInViewport(page);

    expect(firstRow.every((widget) => !visible.includes(widget.id))).toBe(true);
    // The held requests have not been fulfilled. The browser itself must abort them.
    await expect.poll(() => cancelled.size, { timeout: 10_000 }).toBe(2);
    for (const widget of lastRow) {
      await expect(widgetLocatorOf(page, widget).getByTestId('database-grid')).toHaveAttribute(
        'data-row-count',
        /^[1-9]\d*$/,
        { timeout: 20_000 }
      );
    }

    const since = loadingScenario(page).openedAt!;
    const recorder = recorderOf(page);

    expect(recorder.maxConcurrentSources(since), recorder.describePeak(since)).toBe(2);
    holding = false;
    release();
    await DashboardSelectors.rows(page).first().scrollIntoViewIfNeeded();
    for (const widget of firstRow) {
      await expect(widgetLocatorOf(page, widget).getByTestId('database-grid')).toHaveAttribute(
        'data-row-count',
        /^[1-9]\d*$/,
        { timeout: 20_000 }
      );
    }

    expect((await loadStats(page)).maxConcurrentSourceLoads).toBe(2);
    expect(recorder.maxConcurrentSources(since), recorder.describePeak(since)).toBe(2);
  } finally {
    holding = false;
    release();
    page.off('requestfailed', onFailed);
    await page.unroute('**/*', routeHandler);
  }
}
