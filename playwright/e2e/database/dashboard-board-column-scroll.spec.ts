/**
 * A large dashboard Board keeps a column's vertical position when horizontal
 * virtualization clips its empty scroller and later restores it. This is a
 * functional regression, separate from the timed dashboard performance lanes.
 *
 * RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 LARGE_DATABASE_CACHE=<file>
 */
import { expect, Locator, Page, test } from '@playwright/test';

import {
  adoptEmployeesWorkspace,
  createDashboardOverEmployeesViews,
  EMPLOYEES,
  ensureEmployeesViews,
  loadingWidgets,
  openDashboardUntilLoaded,
  widgetLocatorOf,
} from '../../support/dashboard-loading-helpers';
import { nextFrames } from '../../support/dashboard-perf-probe';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from '../../support/employees-database';

test.skip(!process.env.RUN_LARGE_DATABASE, 'the employees suite is opt-in (RUN_LARGE_DATABASE=1)');

async function wheelHorizontally(page: Page, scroller: Locator, deltaX: number) {
  const box = await scroller.boundingBox();

  if (!box) throw new Error('The Board scroller is not rendered');
  // The header belongs to the horizontal scroller, outside the cards' vertical
  // scrollers, so the browser handles this as an ordinary horizontal wheel.
  await page.mouse.move(box.x + box.width / 2, box.y + 16);
  await page.mouse.wheel(deltaX, 0);
}

async function visibleColumnRows(scroller: Locator) {
  return scroller.evaluate((element) => {
    const viewport = element.getBoundingClientRect();

    return Array.from(element.querySelectorAll<HTMLElement>('.board-card')).flatMap((card) => {
      const rect = card.getBoundingClientRect();

      return rect.bottom > viewport.top && rect.top < viewport.bottom ? [card.dataset.cardId] : [];
    });
  });
}

test('a large Board column preserves its vertical scroll through horizontal hide and reveal', async (
  { page, request },
  testInfo
) => {
  test.setTimeout(45 * 60 * 1000);
  const seeded = await openSeededEmployeesDatabase(page, request);

  expect(seeded.rowIds.length, 'the fixture exercises large Board column virtualization').toBeGreaterThan(100);
  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
  await ensureEmployeesViews(page, request);
  await createDashboardOverEmployeesViews(page, request);
  await openDashboardUntilLoaded(page);
  const board = loadingWidgets(page).find((widget) => widget.label === `${EMPLOYEES} Loading Departments`);

  if (!board) throw new Error('The employees dashboard has no Departments Board');
  const widget = widgetLocatorOf(page, board);

  await widget.scrollIntoViewIfNeeded();
  const horizontal = widget.locator('.database-board > .appflowy-custom-scroller');

  await expect(horizontal).toBeVisible();
  await wheelHorizontally(page, horizontal, 300);
  await expect.poll(() => horizontal.evaluate((element) => element.scrollLeft)).toBeGreaterThan(250);
  const originalLeft = await horizontal.evaluate((element) => element.scrollLeft);
  const visiblePopulatedColumnId = () =>
    widget.evaluate((element) => {
      const viewport = element.querySelector('.database-board > .appflowy-custom-scroller')?.getBoundingClientRect();

      if (!viewport) return null;
      const column = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="board-column"]')).find(
        (candidate) => {
          const rect = candidate.getBoundingClientRect();
          const center = rect.left + rect.width / 2;

          // Mounted overscan cards may still be horizontally clipped. Trusted
          // wheel input must land on the visible part of a populated column.
          return center > viewport.left && center < viewport.right && candidate.querySelector('.board-card') !== null;
        }
      );

      return column?.dataset.columnId ?? null;
    });

  await expect.poll(visiblePopulatedColumnId).not.toBeNull();
  const columnId = await visiblePopulatedColumnId();

  if (columnId === null) throw new Error('The populated Board column has no identity');
  const column = widget.locator(`[data-testid="board-column"][data-column-id="${columnId}"]`);
  const vertical = column.locator('.appflowy-custom-scroller').first();
  const originalElement = await vertical.elementHandle();

  if (!originalElement) throw new Error('The populated Board column has no scroller');
  try {
    const box = await vertical.boundingBox();

    if (!box) throw new Error('The populated Board column is not rendered');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => vertical.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
    await nextFrames(page);
    const originalTop = await vertical.evaluate((element) => element.scrollTop);
    const originalRows = await visibleColumnRows(vertical);
    const horizontalExtent = await horizontal.evaluate((element) => element.scrollWidth);

    expect(originalRows.length, 'a real employee card is visible before hiding the column').toBeGreaterThan(0);
    expect(originalRows.every((rowId) => typeof rowId === 'string' && rowId.length > 0)).toBe(true);
    await wheelHorizontally(page, horizontal, horizontalExtent);
    await expect.poll(() => horizontal.evaluate((element) => element.scrollLeft)).toBeGreaterThan(originalLeft + 800);
    await expect(column.locator('.board-card')).toHaveCount(0);
    await expect(vertical).toHaveCSS('overflow-y', 'hidden');
    expect(await vertical.evaluate((element, original) => element === original, originalElement)).toBe(true);
    expect(await vertical.evaluate((element) => element.scrollTop)).toBeCloseTo(originalTop, 0);

    const hiddenLeft = await horizontal.evaluate((element) => element.scrollLeft);

    await wheelHorizontally(page, horizontal, originalLeft - hiddenLeft);
    await expect.poll(() => horizontal.evaluate((element) => element.scrollLeft)).toBeCloseTo(originalLeft, 0);
    await expect(vertical).toHaveCSS('overflow-y', 'auto');
    await expect.poll(() => visibleColumnRows(vertical)).toEqual(originalRows);
    expect(await vertical.evaluate((element, original) => element === original, originalElement)).toBe(true);
    expect(await vertical.evaluate((element) => element.scrollTop)).toBeCloseTo(originalTop, 0);

    const restoredBox = await vertical.boundingBox();

    if (!restoredBox) throw new Error('The restored Board column is not rendered');
    await page.mouse.move(restoredBox.x + restoredBox.width / 2, restoredBox.y + restoredBox.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => vertical.evaluate((element) => element.scrollTop)).toBeGreaterThan(originalTop + 200);
    await testInfo.attach('board-column-scroll-continuity', {
      body: JSON.stringify({ columnId, originalLeft, originalTop, originalRows, hiddenLeft }),
      contentType: 'application/json',
    });
  } finally {
    await originalElement.dispose();
  }
});
