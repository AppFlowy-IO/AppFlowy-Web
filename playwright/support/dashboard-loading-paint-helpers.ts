import { expect, type Locator, type Page, type Route } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';

import {
  loadingScenario,
  loadingWidgets,
  loadStats,
  openDashboardCold,
  readPageRecord,
  recorderOf,
  viewerOf,
  waitForWidgetData,
  widgetLocatorOf,
} from './dashboard-loading-helpers';
import { fixtureDatabase, gridDataRows, hostDatabase } from './dashboard-test-helpers';

/** A mounted element can still be transparent, clipped away, or covered. */
async function expectPainted(element: Locator, description: string) {
  await expect(element, description).toBeVisible();
  const paint = await element.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const clipped = {
      left: Math.max(0, bounds.left),
      top: Math.max(0, bounds.top),
      right: Math.min(innerWidth, bounds.right),
      bottom: Math.min(innerHeight, bounds.bottom),
    };
    const hidden: string[] = [];
    let opacity = 1;

    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);

      opacity *= Number(style.opacity);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) {
        hidden.push(`${ancestor.tagName}: ${style.display}, ${style.visibility}, opacity ${style.opacity}`);
      }

      if (ancestor === node || (style.overflowX === 'visible' && style.overflowY === 'visible')) continue;
      const clip = ancestor.getBoundingClientRect();

      if (style.overflowX !== 'visible') {
        clipped.left = Math.max(clipped.left, clip.left);
        clipped.right = Math.min(clipped.right, clip.right);
      }

      if (style.overflowY !== 'visible') {
        clipped.top = Math.max(clipped.top, clip.top);
        clipped.bottom = Math.min(clipped.bottom, clip.bottom);
      }
    }

    const hit = document.elementFromPoint((clipped.left + clipped.right) / 2, (clipped.top + clipped.bottom) / 2);

    return {
      bounds: bounds.toJSON(),
      width: clipped.right - clipped.left,
      height: clipped.bottom - clipped.top,
      opacity,
      hidden,
      uncovered: hit !== null && node.contains(hit),
    };
  });

  expect(paint.hidden, `${description} has no hidden ancestors`).toEqual([]);
  expect(paint.opacity, `${description} has positive effective opacity`).toBeGreaterThan(0);
  expect(paint.width, `${description} has a painted width`).toBeGreaterThan(0);
  expect(paint.height, `${description} has a painted height`).toBeGreaterThan(0);
  expect(paint.uncovered, `${description} is not covered by another element`).toBe(true);
}

/** Check the real spinner and its text, beyond role/status or DOM presence. */
export async function expectPaintedLoadingIndicator(widget: Locator) {
  const placeholder = widget.getByTestId('dashboard-widget-placeholder');

  await expect(placeholder).toHaveAttribute('data-reason', 'loading');
  await expect(placeholder).toHaveAttribute('aria-busy', 'true');
  await expectPainted(placeholder.locator('svg'), 'loading indicator');
  await expectPainted(placeholder.getByText('Loading…', { exact: true }), 'loading text');
}

/**
 * Hold real cold-source responses until every loading indicator was painted.
 * Release one source to prove its rows can render while another still waits.
 * The gates and the larger test viewport belong only to this functional check.
 */
export async function checkDashboardLoadingPaint(page: Page) {
  const viewer = viewerOf(page);
  const viewport = viewer.viewportSize();
  const recorder = recorderOf(page);
  const previousOpen = loadingScenario(page).openedAt;
  const hostId = hostDatabase(page).databaseId;
  const widgets = loadingWidgets(page).filter((widget) => fixtureDatabase(page, widget.database).databaseId !== hostId);
  const pending = new Map<string, (() => void)[]>();
  const routes = new Set<Promise<void>>();
  const released = new Set<string>();
  let holding = true;
  let maximum = 0;
  const releaseSource = (sourceId: string) => {
    released.add(sourceId);
    pending.get(sourceId)?.forEach((release) => release());
    pending.delete(sourceId);
  };

  const releaseAll = () => {
    holding = false;
    [...pending.keys()].forEach(releaseSource);
  };

  const handleRoute = async (route: Route) => {
    const sourceId = recorder.sourceIdOfDataRequest(route.request());

    // Resizing the still-open fixture can start warm requests. The cold open
    // cancels them; never retain those old responses as pending cold sources.
    const coldOpenStarted = loadingScenario(page).openedAt !== previousOpen;

    if (!coldOpenStarted || !sourceId || sourceId === hostId || !holding || released.has(sourceId)) {
      await route.fallback();
      return;
    }

    const response = await route.fetch();

    if (holding && !released.has(sourceId)) {
      await new Promise<void>((release) => {
        pending.set(sourceId, [...(pending.get(sourceId) ?? []), release]);
        maximum = Math.max(maximum, pending.size);
      });
    }

    await route.fulfill({ response });
  };

  const handler = (route: Route) => {
    const done = handleRoute(route);

    routes.add(done);
    void done.then(() => routes.delete(done), () => routes.delete(done));
    return done;
  };

  await viewer.route('**/api/**', handler);
  try {
    // Both rows (including a 4→2+2 wrap) fit: every checked spinner is on screen.
    await viewer.setViewportSize({ width: 1440, height: 1800 });
    await openDashboardCold(page);
    await expect
      .poll(() => pending.size, { message: 'two distinct cold sources are pending' })
      .toBe(DASHBOARD_LOADING.maxConcurrentSources);
    await viewer.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    for (const widget of widgets) {
      const box = widgetLocatorOf(page, widget);

      await expectPainted(box.getByTestId('dashboard-widget-header'), 'widget header');
      await expectPaintedLoadingIndicator(box);
    }

    expect(released.size, 'no held source has completed before the paint checks').toBe(0);
    expect(
      Object.keys((await loadStats(page)).widgetComplete).filter((id) => widgets.some((widget) => widget.id === id))
    ).toEqual([]);
    // The existing loading-state contract also samples waiters before admission.
    await expect
      .poll(async () => {
        const { samples } = await readPageRecord(page);

        return widgets.every((widget) =>
          samples.some((sample) => sample.id === widget.id && sample.header && sample.loading)
        );
      })
      .toBe(true);

    const firstSource = pending.keys().next().value as string;
    const firstWidgets = widgets.filter((widget) => fixtureDatabase(page, widget.database).databaseId === firstSource);

    releaseSource(firstSource);
    await waitForWidgetData(page, firstWidgets);
    for (const widget of firstWidgets) {
      const box = widgetLocatorOf(page, widget);
      const rows = gridDataRows(box);

      const number = box.getByTestId('number-chart-value');
      const data =
        (await rows.count()) > 0
          ? rows.first().locator('.grid-row-cell').first()
          : (await number.count()) > 0
          ? number
          : box.locator('.recharts-wrapper').first();

      await expectPainted(data, 'completed source data');
    }

    expect(pending.size, 'another source still waits while the first shows data').toBeGreaterThan(0);
    const stillPending = widgets.find((widget) => pending.has(fixtureDatabase(page, widget.database).databaseId));

    expect(stillPending, 'a pending source still has a widget on screen').toBeDefined();
    await expectPaintedLoadingIndicator(widgetLocatorOf(page, stillPending!));
    expect(released.size).toBe(1);
    releaseAll();
    await waitForWidgetData(page, widgets);
    expect(maximum, 'distinct cold responses held concurrently').toBe(DASHBOARD_LOADING.maxConcurrentSources);
    expect(recorder.maxConcurrentSources(loadingScenario(page).openedAt ?? 0)).toBeLessThanOrEqual(
      DASHBOARD_LOADING.maxConcurrentSources
    );
  } finally {
    releaseAll();
    // Complete released responses before removing the handler, including when
    // a cap assertion fails with source responses still held.
    await Promise.allSettled(routes);
    await viewer.unroute('**/api/**', handler);
    if (viewport) await viewer.setViewportSize(viewport);
  }
}
