/**
 * The phone dashboard (WP14b, `dashboard-mobile.feature`): a writer's
 * dashboard at 390×844 (and 600×960) in a desktop browser, which the web
 * treats as a mobile context below 768px. Widgets are named by their view
 * ("Grid" is the host's Grid widget), as on desktop, so each scenario
 * registers those names next to the "<database> <layout>" labels.
 */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { ChartType } from '../../src/application/database-yjs/chart-enums';

import { ensureFixtureDatabase, ensureLayoutView, openDashboardWithViewsSideBySide } from './dashboard-platform-helpers';
import { WIDGET_TIMEOUT } from './dashboard-shared-helpers';
import {
  addDashboardView,
  DashboardSelectors,
  dashboardWorld,
  DatabaseViewLayout,
  fixtureDatabase,
  globalFilterChip,
  inviteDashboardMember,
  leaveEditMode,
  memberPage,
  openDashboardAsMember,
  readDashboardSetting,
  seedDashboardWidgets,
  selectGlobalFilter,
  splitList,
  statusOptionId,
  toggleGlobalFilterOption,
  viewIdForLabel,
  waitForDashboardSync,
  widgetLocator,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import { configureView } from './dashboard-usecase-helpers';
import { DatabaseFilterSelectors } from './selectors';

export const PHONE_VIEWPORT = { width: 390, height: 844 };
export const TABLET_VIEWPORT = { width: 600, height: 960 };
/** WP03's `useLongPress` fires after 500ms; the step rests a little longer. */
export const LONG_PRESS_HOLD_MS = 600;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Name the widgets of `database` by their view name ("Grid" for "Projects
 * Grid"), so the shared steps that take a widget label resolve them.
 */
export function nameWidgetsByView(page: Page, database: string, names: string[]) {
  const world = dashboardWorld(page);

  names.forEach((name) => {
    const label = `${database} ${name}`;
    const widget = world.widgets[label];

    world.viewsByName = { ...world.viewsByName, [name]: { viewId: viewIdForLabel(page, label), database } };
    if (widget) world.widgets[name] = widget;
  });
}

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

/** The page becomes a phone (or a tablet): the toolbar turns into the phone's. */
export async function useMobileViewport(page: Page, viewport = PHONE_VIEWPORT) {
  await page.setViewportSize(viewport);
  await expect(DashboardSelectors.view(page)).toBeVisible(WIDGET_TIMEOUT);
  await expect(page.locator('[data-testid="dashboard-actions"][data-mobile="true"]')).toBeAttached(WIDGET_TIMEOUT);
  // The desktop chrome is gone: no Edit, no tab strip.
  await expect(DashboardSelectors.editButton(page)).toHaveCount(0);
  await expect(DashboardSelectors.viewPill(page)).toBeVisible(WIDGET_TIMEOUT);
}

/**
 * The shared fixture on a phone: a dashboard of `database` whose first row
 * shows its `first` and `second` views, set up at desktop width (View mode,
 * both widgets rendered), then shown at 390×844.
 */
export async function openPhoneDashboardWithViews(
  page: Page,
  request: APIRequestContext,
  database: string,
  first: string,
  second: string
) {
  await openDashboardWithViewsSideBySide(page, request, database, first, second);
  nameWidgetsByView(page, database, [first, second]);
  await useMobileViewport(page);
  for (const name of [first, second]) await expect(widgetLocator(page, name)).toBeVisible(WIDGET_TIMEOUT);
}

/**
 * A dashboard of `database` with one bar chart widget that counts rows by the
 * `property` select (the widget is named after it), shown on a phone.
 */
export async function openPhoneDashboardWithBarChart(
  page: Page,
  request: APIRequestContext,
  database: string,
  property: string
) {
  await ensureFixtureDatabase(page, request, database);
  const viewId = await ensureLayoutView(page, database, 'Chart');
  const fixture = fixtureDatabase(page, database);
  const xFieldId = fixture.fieldIds[property];

  if (!xFieldId) throw new Error(`"${database}" has no "${property}" property`);
  await configureView(page, fixture.databaseId, viewId, {
    layout: DatabaseViewLayout.Chart,
    filters: [],
    sorts: [],
    chart: { chartType: ChartType.Bar, xFieldId, aggregationType: 0, yFieldId: '' },
  });
  await addDashboardView(page, database);
  await seedDashboardWidgets(page, [{ row: 1, label: `${database} Chart` }]);
  await leaveEditMode(page);

  const world = dashboardWorld(page);

  world.viewsByName = { ...world.viewsByName, [property]: { viewId, database } };
  world.widgets[property] = world.widgets[`${database} Chart`];
  await useMobileViewport(page);
  await expect(chartBar(widgetLocator(page, property), 'Doing')).toBeVisible(WIDGET_TIMEOUT);
}

/** One bar of a bar chart widget, by its category. */
export function chartBar(widget: Locator, category: string): Locator {
  return widget.locator(`[data-testid="chart-bar-segment"][data-category="${category}"]`).first();
}

/** A phone tap: a click, which a mobile context reads as a tap (two taps drill into a chart). */
export async function tapChartBar(page: Page, widgetName: string, category: string) {
  const bar = chartBar(widgetLocator(page, widgetName), category);

  await expect(bar).toBeVisible(WIDGET_TIMEOUT);
  await bar.click();
}

/**
 * A long press as a finger makes it: a touch `pointerdown`, a rest longer
 * than WP03's 500ms, then the `pointerup`.
 */
export async function longPress(target: Locator) {
  await expect(target).toBeVisible(WIDGET_TIMEOUT);
  const box = await target.boundingBox();

  if (!box) throw new Error('The element to long-press is not rendered');
  const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };

  await target.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, ...point });
  await target.page().waitForTimeout(LONG_PRESS_HOLD_MS);
  await target.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, ...point });
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/** The open bottom sheet (the top one). */
export function openSheet(scope: Page): Locator {
  return DashboardSelectors.mobileSheet(scope);
}

export async function expectSheetTitled(scope: Page, title: string, kind?: string) {
  const sheet = kind ? DashboardSelectors.mobileSheet(scope, kind) : openSheet(scope);

  await expect(sheet).toBeVisible(WIDGET_TIMEOUT);
  await expect(sheet.getByTestId('mobile-sheet-title')).toHaveText(title);
  return sheet;
}

/** The labels of the open sheet's rows, in order. */
export async function sheetItemLabels(scope: Page): Promise<string[]> {
  await expect(DashboardSelectors.mobileSheetItems(scope).first()).toBeVisible(WIDGET_TIMEOUT);
  return DashboardSelectors.mobileSheetItems(scope).allTextContents();
}

/**
 * Close the open bottom sheet with its × button. A popover or dropdown that
 * its content opened (a rule's editor, a condition list) closes first: Escape
 * dismisses the top layer only.
 */
export async function closeBottomSheet(scope: Page) {
  const sheet = openSheet(scope);

  await expect(sheet).toBeVisible(WIDGET_TIMEOUT);
  const layers = scope.locator('[data-radix-popper-content-wrapper]').filter({ visible: true });

  for (let attempt = 0; attempt < 4 && (await layers.count()) > 0; attempt += 1) {
    await scope.keyboard.press('Escape');
  }

  await DashboardSelectors.mobileSheetClose(scope).click();
  await expect(scope.getByTestId('mobile-sheet')).toHaveCount(0, WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Widget filters and search
// ---------------------------------------------------------------------------

/**
 * Add a rule on a checkbox property in the open "Filter" sheet: it opens on
 * the property picker when the widget has no rule, else "+ Add filter" opens it.
 */
export async function filterByPropertyInSheet(page: Page, property: string) {
  const sheet = DashboardSelectors.mobileSheet(page, 'widget-filter');

  await expect(sheet).toBeVisible(WIDGET_TIMEOUT);
  const item = DatabaseFilterSelectors.propertyItemByName(page, property).filter({ visible: true }).first();

  if (!(await item.isVisible())) await sheet.getByTestId('database-add-filter-button').click();
  await expect(item).toBeVisible(WIDGET_TIMEOUT);
  await item.click();
  await expect(sheet.getByTestId('database-filter-condition').first()).toBeAttached(WIDGET_TIMEOUT);
}

export function widgetSearchField(page: Page, widgetName: string): Locator {
  return widgetLocator(page, widgetName).getByTestId('database-actions-search-field');
}

/** Type into the expanded search field and wait until the query is committed (300ms debounce). */
export async function typeInWidgetSearch(page: Page, widgetName: string, text: string) {
  const field = widgetSearchField(page, widgetName);

  await expect(field).toBeVisible(WIDGET_TIMEOUT);
  await field.getByTestId('database-actions-search-input').fill(text);
  await expect(field).toHaveAttribute('data-committed', 'true', WIDGET_TIMEOUT);
}

export async function expectTitleReplacedBySearch(page: Page, widgetName: string) {
  const widget = widgetLocator(page, widgetName);

  await expect(widget.getByTestId('dashboard-widget-header')).toHaveAttribute('data-search-active', 'true');
  await expect(widget.getByTestId('dashboard-widget-title-button')).toHaveCount(0);
  await expect(widgetSearchField(page, widgetName)).toHaveAttribute('data-mobile', 'true');
}

export async function clearWidgetSearch(page: Page, widgetName: string) {
  const field = widgetSearchField(page, widgetName);

  await field.getByTestId('database-actions-search-clear').click();
  await expect(field).toHaveCount(0);
  await expect(widgetLocator(page, widgetName).getByTestId('dashboard-widget-title-button')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Layout checks
// ---------------------------------------------------------------------------

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) throw new Error('The element is not rendered');
  return box;
}

/** No Edit-mode affordance at all: add buttons, row moves, width and height handles, drags. */
export async function expectNoEditingControls(page: Page) {
  await expect(DashboardSelectors.view(page)).toHaveAttribute('data-editing', 'false');
  await expect(DashboardSelectors.widthHandles(page)).toHaveCount(0);
  await expect(page.getByTestId('dashboard-height-handle')).toHaveCount(0);
  await expect(DashboardSelectors.addWidgetButton(page).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-testid="dashboard-add-widget-row-button"]').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByTestId('dashboard-row-move-control').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-testid="dashboard-widget"][data-editing="true"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="dashboard-widget-header"].cursor-grab')).toHaveCount(0);
}

/** The phone toolbar holds the Filter button alone. */
export async function expectToolbarFilterOnly(page: Page) {
  const toolbar = page.locator('[data-testid="dashboard-actions"][data-mobile="true"]');

  await expect(toolbar).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(() =>
      toolbar
        .locator('button')
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => button.getClientRects().length > 0)
            .map((button) => button.getAttribute('data-testid'))
        )
    )
    .toEqual(['dashboard-global-filter-button']);
  await expect(page.getByTestId('database-actions-settings')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-toolbar-open-as-page')).toHaveCount(0);
}

/** `upper` sits wholly above `lower`, and both take the whole width of the row. */
export async function expectStackedAtFullWidth(page: Page, upper: string, lower: string) {
  const first = widgetLocator(page, upper);
  const second = widgetLocator(page, lower);
  const track = DashboardSelectors.rows(page).first().getByTestId('dashboard-row-track');

  await expect(first).toBeVisible(WIDGET_TIMEOUT);
  await expect(second).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(async () => {
      const [a, b, row] = await Promise.all([boxOf(first), boxOf(second), boxOf(track)]);

      return {
        above: a.y + a.height <= b.y + 1,
        fullWidth: Math.abs(a.width - row.width) <= 1 && Math.abs(b.width - row.width) <= 1,
      };
    }, WIDGET_TIMEOUT)
    .toEqual({ above: true, fullWidth: true });
}

/** The widgets of a dashboard row share one line, left to right. */
export async function expectRowSideBySide(page: Page, rowNumber: number) {
  const widgets = DashboardSelectors.rows(page)
    .nth(rowNumber - 1)
    .getByTestId('dashboard-widget');

  await expect(widgets.first()).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(async () => {
      const boxes = await widgets.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();

          return { x: rect.x, y: rect.y, width: rect.width };
        })
      );

      return (
        boxes.length > 1 &&
        boxes.every((box, index) => {
          const previous = boxes[index - 1];

          return !previous || (Math.abs(box.y - previous.y) <= 1 && box.x >= previous.x + previous.width - 1);
        })
      );
    }, WIDGET_TIMEOUT)
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Opening full screen
// ---------------------------------------------------------------------------

export async function expectViewOpensFullScreen(page: Page, database: string, layout: string) {
  const viewId = viewIdForLabel(page, `${database} ${layout}`);

  await expect(page).toHaveURL(new RegExp(`/${viewId}(?:[?#]|$)`), WIDGET_TIMEOUT);
  await expect(DashboardSelectors.view(page)).toHaveCount(0, WIDGET_TIMEOUT);
}

export async function expectRowOpensFullScreen(page: Page, database: string, title: string) {
  const rowId = fixtureDatabase(page, database).rowIds[title];

  if (!rowId) throw new Error(`"${database}" has no row "${title}"`);
  await expect(page).toHaveURL(new RegExp(`[?&]r=${rowId}(?:&|$)`), WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Drill-down sheet (WP13a's content on a phone)
// ---------------------------------------------------------------------------

export function drillSheet(page: Page): Locator {
  return DashboardSelectors.mobileSheet(page, 'drilldown');
}

export async function drillSheetRowTitles(page: Page): Promise<string[]> {
  const titles = drillSheet(page).getByTestId('drill-row-title');

  await expect(titles.first()).toBeVisible(WIDGET_TIMEOUT);
  return titles.allTextContents();
}

export async function tapDrillSheetRow(page: Page, title: string) {
  const row = drillSheet(page).locator('[data-testid^="drill-row-"]').filter({ hasText: title }).first();

  await expect(row).toBeVisible(WIDGET_TIMEOUT);
  await row.getByTestId('drill-row-title').click();
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

/** A saved select filter on `property` of every dashboard source that has it, matching `options`. */
export async function seedSavedSelectFilter(page: Page, request: APIRequestContext, property: string, options: string) {
  const world = dashboardWorld(page);
  const { rows, global_filters: current } = await readDashboardSetting(page);
  const sources = new Set(rows.flatMap((row) => row.widgets.map((widget) => widget.database_id)));
  const mapping: Record<string, string> = {};

  Object.entries(world.databases).forEach(([name, database]) => {
    if (sources.has(database.databaseId) && database.fieldIds[property]) mapping[name] = property;
  });
  const names = splitList(options);
  const filter = { ...selectGlobalFilter(page, property, names, mapping), option_names: names };

  await writeDashboardSetting(page, { global_filters: [...current, filter] });
  await expect(globalFilterChip(page, property)).toBeVisible(WIDGET_TIMEOUT);
  // A "saved" filter is on the server, so the member's browser gets it too.
  await waitForDashboardSync(page, request);
}

export async function expectSavedFilterMatchesOnly(page: Page, name: string, option: string) {
  const { global_filters: filters } = await readDashboardSetting(page);
  const filter = filters.find((candidate) => candidate.name === name);

  expect(filter, `no saved "${name}" filter`).toBeTruthy();
  expect(splitList(filter?.content ?? '')).toEqual([statusOptionId(option)]);
}

export async function tapGlobalFilterPill(scope: Page, name: string) {
  const chip = globalFilterChip(scope, name);

  await expect(chip).toBeVisible(WIDGET_TIMEOUT);
  await chip.click();
  await expect(DashboardSelectors.mobileSheet(scope, 'global-filter-pill')).toBeVisible(WIDGET_TIMEOUT);
}

export async function expectPillSheetFor(scope: Page, name: string) {
  const sheet = DashboardSelectors.mobileSheet(scope, 'global-filter-pill');

  await expect(sheet).toBeVisible(WIDGET_TIMEOUT);
  await expect(sheet.getByTestId('mobile-sheet-title')).toContainText(name);
  await expect(sheet.getByTestId('dashboard-global-filter-pill-editor')).toBeVisible();
}

/** Toggle a status option in the open pill sheet. */
export async function toggleOptionInSheet(scope: Page, option: string) {
  await expect(openSheet(scope).getByTestId('dashboard-global-filter-content')).toBeVisible(WIDGET_TIMEOUT);
  await toggleGlobalFilterOption(scope, option);
}

// ---------------------------------------------------------------------------
// The read-only member
// ---------------------------------------------------------------------------

/** A read-only member opens the dashboard, signed in on a desktop-sized window, then on a phone. */
export async function openDashboardAsMemberOnPhone(page: Page, request: APIRequestContext) {
  const world = dashboardWorld(page);
  const host = world.dashboardHost ?? 'Projects';

  nameWidgetsByView(
    page,
    host,
    Object.keys(world.widgets)
      .filter((label) => label.startsWith(`${host} `))
      .map((label) => label.slice(host.length + 1))
  );
  await inviteDashboardMember(page, request, 'read-only');
  const member = await openDashboardAsMember(page);

  await useMobileViewport(member);
  return member;
}

export async function memberAlsoSelectsInPill(page: Page, option: string, name: string) {
  const member = memberPage(page);

  await tapGlobalFilterPill(member, name);
  await toggleOptionInSheet(member, option);
  await closeBottomSheet(member);
}

export async function expectNoSaveForEveryone(scope: Page) {
  await expect(DashboardSelectors.view(scope)).toBeVisible();
  await expect(DashboardSelectors.globalFilterSaveForEveryone(scope)).toHaveCount(0);
  await expect(scope.getByTestId('dashboard-widget-save-for-everyone')).toHaveCount(0);
}
