/**
 * Helpers of the shared `dashboard-arrange` feature (WP04): the row controls,
 * the widget menu's moves, equal splits, drop lines and the drag ghost. The
 * desktop twins live in `integration_test/shared/dashboard_test_op.dart`.
 *
 * Widgets are numbered 1..n in reading order; seeded ids are `w:1..w:n` and
 * rows `r:1..`, every widget showing the host "Projects Grid" view.
 */
import { expect, Locator, Page } from '@playwright/test';

import { WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_FIXTURE_DATABASES,
  DashboardSelectors,
  dashboardWorld,
  fixtureDatabase,
  hostDatabase,
  PersistedRow,
  readDashboardSetting,
  viewIdForLabel,
  waitForDatabaseContext,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import { DatabaseGridSelectors } from './selectors';

export const ArrangeSelectors = {
  /** The ↑/↓ control of a row (absent for a single row). */
  rowMoveControl: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-row-move-control"][data-row-id="${rowId}"]`),
  rowMoveUp: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-row-move-up"][data-row-id="${rowId}"]`),
  rowMoveDown: (page: Page, rowId: string) =>
    page.locator(`[data-testid="dashboard-row-move-down"][data-row-id="${rowId}"]`),
  /** Every move arrow of a row, in DOM order (↑ over ↓). */
  rowMoves: (page: Page, rowId: string) =>
    page.locator(
      `[data-testid="dashboard-row-move-up"][data-row-id="${rowId}"], [data-testid="dashboard-row-move-down"][data-row-id="${rowId}"]`
    ),
  /** "Add to new row", under the last row (the empty state's large button shares the test id). */
  addToNewRow: (page: Page) => DashboardSelectors.grid(page).getByTestId('dashboard-add-widget-button'),
  dropIndicator: (page: Page, orientation?: 'vertical' | 'horizontal') =>
    page.locator(
      orientation
        ? `[data-testid="dashboard-drop-indicator"][data-orientation="${orientation}"]`
        : '[data-testid="dashboard-drop-indicator"]'
    ),
  dragGhost: (page: Page) => page.getByTestId('dashboard-drag-ghost'),
  fullTooltip: (page: Page) => page.getByTestId('dashboard-full-tooltip'),
  moveToRowContent: (page: Page) => page.getByTestId('dashboard-widget-menu-move-to-row-content'),
};

/** `'1, 1, 1'` (widgets per row) → the equal widths of each row. */
export function rowsOfCounts(text: string): number[][] {
  return text.split(',').map((part) => {
    const count = Number(part.trim());

    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error(`Bad widget count "${part}" in "${text}"`);
    return Array.from({ length: count }, () => 12 / count);
  });
}

/** `'8 4; 12'` (rows separated by `;`, widths by spaces) → the widths of each row. */
export function rowsOfWidths(text: string): number[][] {
  return text.split(';').map((row) =>
    row
      .trim()
      .split(/\s+/)
      .map((width) => {
        const value = Number(width);

        if (!Number.isInteger(value)) throw new Error(`Bad width "${width}" in "${text}"`);
        return value;
      })
  );
}

/** `'w:1, w:2'` or `'6, 6'` → the list. */
export function splitBraced(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Seed the dashboard with rows of these widths: ids `r:1…` and `w:1…` in
 * reading order, every widget on the host "Projects Grid" view, the default
 * row height. Waits until every widget renders.
 */
export async function seedDashboardRows(page: Page, rows: { widths: number[] }[]) {
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const viewId = viewIdForLabel(page, `${host.name} Grid`);
  let next = 0;
  const persisted: PersistedRow[] = rows.map((row, rowIndex) => ({
    id: `r:${rowIndex + 1}`,
    height: DASHBOARD_DEFAULT_ROW_HEIGHT,
    widgets: row.widths.map((width) => {
      next += 1;
      const id = `w:${next}`;

      world.widgets[id] = { id, viewId, databaseId: host.databaseId };
      return { id, view_id: viewId, database_id: host.databaseId, width };
    }),
  }));

  await writeDashboardSetting(page, { rows: persisted });
  await expect(DashboardSelectors.widgets(page)).toHaveCount(next, WIDGET_TIMEOUT);
}

/** The id of widget `n` (1-based, reading order) in the saved rows. */
export async function widgetIdAt(page: Page, n: number): Promise<string> {
  const ids = (await readDashboardSetting(page)).rows.flatMap((row) => row.widgets.map((widget) => widget.id));
  const id = ids[n - 1];

  if (!id) throw new Error(`The dashboard has no widget ${n} (it has ${ids.length})`);
  return id;
}

export async function widgetAt(page: Page, n: number): Promise<Locator> {
  return DashboardSelectors.widget(page, await widgetIdAt(page, n));
}

/** The saved rows, as compared by "the dashboard layout is unchanged" (ids, heights, widths). */
export async function layoutSnapshot(page: Page): Promise<string> {
  return JSON.stringify((await readDashboardSetting(page)).rows);
}

/**
 * The empty part of a widget's header band, between the title pill and the
 * tools: a drag that starts on the pill (a button) is not a native drag in
 * every browser.
 */
async function gripOf(page: Page, widget: Locator) {
  const header = widget.getByTestId('dashboard-widget-header');

  await widget.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await widget.hover();
  const box = await header.boundingBox();

  if (!box) throw new Error('Widget header is not visible');
  const pill = await header.getByTestId('dashboard-widget-title-button').boundingBox();
  const tools = await header.getByTestId('database-actions').boundingBox();
  const start = pill ? pill.x + pill.width : box.x + Math.min(24, box.width / 4);
  const end = tools ? tools.x : box.x + box.width;

  return { x: start + (end - start) / 2, y: box.y + box.height / 2 };
}

const pointers = new WeakMap<Page, { x: number; y: number }>();

async function travel(page: Page, to: { x: number; y: number }, steps = 12) {
  const from = pointers.get(page);

  if (!from) throw new Error('No widget is being dragged');
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }

  await page.mouse.move(to.x, to.y);
  pointers.set(page, to);
}

/** Press on a widget's header and move a little: the drag starts and stays held. */
export async function startWidgetDrag(page: Page, widget: Locator) {
  const grip = await gripOf(page, widget);

  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  pointers.set(page, grip);
  // Cross the native drag threshold.
  await travel(page, { x: grip.x + 12, y: grip.y + 12 }, 4);
  await expect(ArrangeSelectors.dragGhost(page)).toBeVisible(WIDGET_TIMEOUT);
}

/** Move the held widget to a point, in small steps. */
export async function moveWidgetDrag(page: Page, to: { x: number; y: number }) {
  await travel(page, to);
}

/** Release the held widget where it is. */
export async function releaseWidgetDrag(page: Page) {
  if (!pointers.has(page)) throw new Error('No widget is being dragged');
  await page.mouse.up();
  pointers.delete(page);
  await expect(ArrangeSelectors.dragGhost(page)).toHaveCount(0, WIDGET_TIMEOUT);
}

/** A point over the left or right side of a widget, on its card. */
export async function widgetSidePoint(widget: Locator, side: 'left' | 'right') {
  let box = await widget.boundingBox();

  if (!box) throw new Error('Drop target widget is not rendered');
  const viewport = widget.page().viewportSize();
  const centerY = box.y + box.height / 2;

  // A target scrolled out of the page gets no drag events, so the drop would land nowhere and
  // change nothing: bring its middle into view (a drag in progress follows the pointer).
  if (viewport && (centerY < 0 || centerY > viewport.height)) {
    await widget.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    box = await widget.boundingBox();
    if (!box) throw new Error('Drop target widget is not rendered');
  }

  const point = { x: side === 'left' ? box.x + box.width * 0.15 : box.x + box.width * 0.85, y: box.y + box.height / 2 };

  if (viewport) {
    expect(point.y, 'the drop point is inside the page').toBeGreaterThan(0);
    expect(point.y, 'the drop point is inside the page').toBeLessThan(viewport.height);
  }

  return point;
}

/** The middle of the band in front of row `gap` (0 = above the first row). */
export async function rowGapPoint(page: Page, gap: number) {
  const band = DashboardSelectors.rowGap(page, gap);

  await band.scrollIntoViewIfNeeded();
  const box = await band.boundingBox();

  if (!box) throw new Error(`The dashboard has no row gap ${gap}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag widget `source` and drop it at `to` in one go. */
export async function dragWidgetTo(page: Page, source: Locator, to: () => Promise<{ x: number; y: number }>) {
  await startWidgetDrag(page, source);
  await moveWidgetDrag(page, await to());
  await releaseWidgetDrag(page);
}

/**
 * The `label` view ("Grid" of the host) is open outside the dashboard: the
 * app navigated to it (or opened it in the page modal) and its grid renders.
 */
export async function expectViewOpenOutsideDashboard(page: Page, database: string, label: string) {
  const target = fixtureDatabase(page, database);
  const viewId = viewIdForLabel(page, label);

  await expect
    .poll(async () => {
      const url = page.url();
      const navigated = url.includes(viewId) || url.includes(target.pageId);
      const dialog = page.locator('[role="dialog"]').filter({ has: page.getByTestId('database-grid') });

      return navigated || (await dialog.isVisible());
    }, WIDGET_TIMEOUT)
    .toBe(true);
  await waitForDatabaseContext(page, target.databaseId);
  const grid = DatabaseGridSelectors.grid(page)
    .filter({ hasText: String(DASHBOARD_FIXTURE_DATABASES[database]?.rows[0]?.Name ?? '') })
    .last();

  await expect(grid).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
}
