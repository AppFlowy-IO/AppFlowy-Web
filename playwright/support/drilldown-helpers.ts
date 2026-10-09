/**
 * Chart drill-down and record side peek helpers (WP13, dashboard-drilldown.feature).
 * The use-case fixtures (Bug Tracker, Triage) come from dashboard-usecase-helpers.
 */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { DASHBOARD_GEOMETRY } from '../../src/application/database-yjs/dashboard-geometry';

import { closeDrilldown } from './chart-test-helpers';
import { pressEscapeUntilHidden } from './dashboard-shared-helpers';
import {
  DashboardSelectors,
  dashboardWorld,
  databaseForLabel,
  fixtureDatabase,
  viewIdForLabel,
  widgetLocator,
} from './dashboard-test-helpers';
import {
  drillDown,
  rowPage,
  sidePeek,
  USE_CASE_TIMEOUT,
  waitForViewSync,
  widgetTitles,
} from './dashboard-usecase-helpers';
import { selectFilterOption } from './filter-test-helpers';
import { ChartDrilldownSelectors, DatabaseFilterSelectors, DatabaseViewSelectors } from './selectors';

export const DRILL_TIMEOUT = { timeout: USE_CASE_TIMEOUT };

const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

// ---------------------------------------------------------------------------
// The drill-down
// ---------------------------------------------------------------------------

export async function expectDrillTitle(page: Page, title: string) {
  await expect(ChartDrilldownSelectors.title(page)).toHaveText(title, DRILL_TIMEOUT);
}

export async function expectDrillCount(page: Page, text: string) {
  await expect(ChartDrilldownSelectors.count(page)).toHaveText(text, DRILL_TIMEOUT);
}

export async function drillColumnNames(page: Page): Promise<string[]> {
  return (await drillDown(page).getByTestId('drill-column-header').allTextContents()).map((name) => name.trim());
}

/** The texts of the drill-down's chips of one kind. */
export async function drillChipTexts(page: Page, kind: 'filter' | 'global' | 'category' | 'subgroup' | 'rows') {
  return (await ChartDrilldownSelectors.chips(page, kind).allTextContents()).map((text) => text.trim());
}

/** A global (dashboard filter) chip of the drill-down by its text. */
export function drillGlobalChip(page: Page, text: string): Locator {
  return ChartDrilldownSelectors.chips(page, 'global').filter({ hasText: exact(text) });
}

/** Open the search (when collapsed) and type; the rows follow 300ms later. */
export async function searchDrill(page: Page, query: string) {
  const input = ChartDrilldownSelectors.searchInput(page);

  if (!(await input.isVisible())) await ChartDrilldownSelectors.search(page).click();
  await expect(input).toBeVisible(DRILL_TIMEOUT);
  await input.fill(query);
}

/** Clear the query with Esc in the search input (the dialog stays open). */
export async function clearDrillSearch(page: Page) {
  const input = ChartDrilldownSelectors.searchInput(page);

  await expect(input).toBeVisible(DRILL_TIMEOUT);
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(drillDown(page)).toBeVisible();
}

/** `+ Filter` → a select property → one option; the rule editor closes, the drill-down stays. */
export async function addDrillSelectFilter(page: Page, property: string, option: string) {
  const add = drillDown(page).getByTestId('drill-add-filter');

  await expect(add).toBeVisible(DRILL_TIMEOUT);
  await add.click();
  const item = DatabaseFilterSelectors.propertyItemByName(page, property).filter({ visible: true }).first();

  await expect(item).toBeVisible(DRILL_TIMEOUT);
  await item.click();
  await selectFilterOption(page, option);
  // Close the rule editor only: the drill-down under it must stay open.
  const editor = page.locator('[data-radix-popper-content-wrapper]').filter({ visible: true }).last();

  await pressEscapeUntilHidden(page, editor);
  await expect(drillDown(page)).toBeVisible();
}

export async function closeDrillDown(page: Page) {
  await expect(drillDown(page)).toBeVisible(DRILL_TIMEOUT);
  await closeDrilldown(page);
}

/** Choose an entry of the drill-down's `···` menu by its text. */
export async function chooseDrillMenuItem(page: Page, label: string) {
  await ChartDrilldownSelectors.more(page).click();
  const menu = page.getByTestId('drill-more-menu');

  await expect(menu).toBeVisible(DRILL_TIMEOUT);
  const item = menu.getByRole('menuitem').filter({ hasText: exact(label) });

  await expect(item).toBeVisible(DRILL_TIMEOUT);
  await item.click();
}

export function saveViewNameField(page: Page): Locator {
  return page.getByTestId('drill-save-view-name');
}

/** Type the name in the "Save as view…" prompt and save; the drill-down closes. */
export async function saveDrillViewAs(page: Page, name: string) {
  const field = saveViewNameField(page);

  await expect(field).toBeVisible(DRILL_TIMEOUT);
  await field.fill(name);
  await page.getByTestId('drill-save-view-save').click();
  await expect(drillDown(page)).toHaveCount(0, DRILL_TIMEOUT);
}

/** The id of the view named `name` in `databaseName`'s doc, once the browser holds it. */
export async function viewIdByName(page: Page, databaseName: string, name: string): Promise<string> {
  const { databaseId } = fixtureDatabase(page, databaseName);
  let viewId = '';

  await expect
    .poll(
      async () => {
        viewId = await page.evaluate(
          ({ databaseId, name }) => {
            const ctx = (window as any).__DASHBOARD_TEST__?.byDatabase(databaseId);
            const views = ctx?.databaseDoc.getMap('data').get('database')?.get('views');

            if (!views) return '';
            for (const [id, view] of views.entries()) {
              if (view.get('name') === name) return id as string;
            }

            return '';
          },
          { databaseId, name }
        );
        return viewId;
      },
      { ...DRILL_TIMEOUT, message: `waiting for the "${name}" view of "${databaseName}"` }
    )
    .not.toBe('');
  return viewId;
}

/** A view saved from the drill-down is open as the active tab of its database; later steps name it. */
export async function expectSavedViewOpen(page: Page, name: string, databaseName: string) {
  const viewId = await viewIdByName(page, databaseName, name);
  const world = dashboardWorld(page);

  world.viewsByName = { ...world.viewsByName, [name]: { viewId, database: databaseName } };
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toBeVisible(DRILL_TIMEOUT);
  await expect(tab).toHaveAttribute('data-state', 'active', DRILL_TIMEOUT);
  await expect(DashboardSelectors.view(page)).toHaveCount(0);
}

async function primaryFieldOf(page: Page, databaseId: string): Promise<string> {
  return page.evaluate((id) => {
    const fields = (window as any).__DASHBOARD_TEST__
      .byDatabase(id)
      .databaseDoc.getMap('data')
      .get('database')
      .get('fields');

    return (Array.from(fields.entries()) as [string, any][]).find(([, field]) => field.get('is_primary'))?.[0] ?? '';
  }, databaseId);
}

/** The open view is a table listing exactly these titles. */
export async function expectOpenTableTitles(page: Page, name: string, titles: string[]) {
  const database = fixtureDatabase(page, databaseForLabel(page, name));
  const grid = DatabaseViewSelectors.gridView(page).first();

  await expect(grid).toBeVisible(DRILL_TIMEOUT);
  const primaryId = await primaryFieldOf(page, database.databaseId);
  const container = grid.locator('xpath=..');

  await expect
    .poll(async () => (await widgetTitles(container, primaryId)).sort(), DRILL_TIMEOUT)
    .toEqual([...titles].sort());
}

/** The view is a normal tab of its database (not owned by a dashboard), with its name. */
export async function expectViewIsTab(page: Page, name: string, databaseName: string) {
  const viewId = viewIdForLabel(page, name);
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toBeVisible(DRILL_TIMEOUT);
  await expect(tab).toContainText(name);
  const owner = await page.evaluate(
    ({ databaseId, viewId }) =>
      (window as any).__DASHBOARD_TEST__
        ?.byDatabase(databaseId)
        ?.databaseDoc.getMap('data')
        .get('database')
        ?.get('views')
        ?.get(viewId)
        ?.get('dashboard_owner') ?? null,
    { databaseId: fixtureDatabase(page, databaseName).databaseId, viewId }
  );

  expect(owner, `the "${name}" view must not be owned by a dashboard`).toBeNull();
}

/**
 * "Open {database}": the database's page (its container, or the view the
 * workspace catalog names for it) with its tabs, and the dashboard has gone.
 */
export async function expectDatabasePageOpen(page: Page, databaseName: string) {
  const database = fixtureDatabase(page, databaseName);
  // Every non-dashboard view of the database, as the browser's doc lists them.
  const viewIds = await page.evaluate((databaseId) => {
    const views = (window as any).__DASHBOARD_TEST__
      ?.byDatabase(databaseId)
      ?.databaseDoc.getMap('data')
      .get('database')
      ?.get('views');

    return views
      ? (Array.from(views.entries()) as [string, any][])
          .filter(([, view]) => Number(view.get('layout')) !== 9)
          .map(([id]) => id)
      : [];
  }, database.databaseId);
  const pages = [database.pageId, ...Object.values(database.views), ...viewIds];

  await expect(DashboardSelectors.view(page)).toHaveCount(0, DRILL_TIMEOUT);
  await expect
    .poll(() => pages.some((id) => new RegExp(`/${id}(\\?|$)`).test(page.url())), {
      ...DRILL_TIMEOUT,
      message: `the "${databaseName}" database page is not open`,
    })
    .toBe(true);
  await expect(DatabaseViewSelectors.viewTab(page, database.views.Grid)).toBeVisible(DRILL_TIMEOUT);
}

// ---------------------------------------------------------------------------
// The side peek and the other record openers
// ---------------------------------------------------------------------------

async function titleOf(scope: Locator): Promise<string> {
  return scope
    .getByTestId('row-title-input')
    .first()
    .evaluate((input) => (input as HTMLTextAreaElement).value ?? input.textContent ?? '');
}

export async function expectSidePeekFor(page: Page, title: string) {
  const peek = sidePeek(page);

  await expect(peek).toBeVisible(DRILL_TIMEOUT);
  await expect.poll(() => titleOf(peek), DRILL_TIMEOUT).toBe(title);
  await expect(peek).toHaveAttribute('aria-label', title);
}

/** `min(640, 45% of the viewport)`, clamped to `[420, min(1000, viewport − 240)]` (WP13 decision 8). */
export async function expectSidePeekDefaultWidth(page: Page) {
  const { defaultWidth, defaultFraction, minWidth, maxWidth, viewportReserve } = DASHBOARD_GEOMETRY.sidePeek;
  const viewport = await page.evaluate(() => window.innerWidth);
  const expected = Math.round(
    Math.min(
      Math.max(Math.min(defaultWidth, defaultFraction * viewport), minWidth),
      Math.max(minWidth, Math.min(maxWidth, viewport - viewportReserve))
    )
  );

  await expect
    .poll(async () => Math.round((await sidePeek(page).boundingBox())?.width ?? 0), DRILL_TIMEOUT)
    .toBe(expected);
}

const SIDE_PEEK_BUTTONS: Record<string, string> = {
  'Open as full page': 'row-side-peek-full-page',
  'Open in center peek': 'row-side-peek-center',
  Close: 'row-side-peek-close',
};

export async function clickSidePeekButton(page: Page, label: string) {
  const testId = SIDE_PEEK_BUTTONS[label];

  if (!testId) throw new Error(`The side peek has no "${label}" button`);
  await sidePeek(page).getByTestId(testId).click();
}

/** The record is a full page: no peek and no modal, the row page's title editor shows it. */
export async function expectFullRowPage(page: Page, title: string) {
  await expect(sidePeek(page)).toHaveCount(0, DRILL_TIMEOUT);
  await expect(DashboardSelectors.view(page)).toHaveCount(0, DRILL_TIMEOUT);
  const input = page.getByTestId('row-title-input').first();

  await expect(input).toBeVisible(DRILL_TIMEOUT);
  await expect(page.locator('.MuiDialog-paper').getByTestId('row-title-input')).toHaveCount(0);
  await expect
    .poll(() => input.evaluate((element) => (element as HTMLTextAreaElement).value), DRILL_TIMEOUT)
    .toBe(title);
}

export async function expectCenterPeekFor(page: Page, title: string) {
  const modal = page
    .locator('.MuiDialog-paper')
    .filter({ has: page.getByTestId('row-title-input') })
    .last();

  await expect(modal).toBeVisible(DRILL_TIMEOUT);
  await expect(sidePeek(page)).toHaveCount(0);
  await expect.poll(() => titleOf(modal), DRILL_TIMEOUT).toBe(title);
  await expect(rowPage(page)).toBeVisible();
}

const OPEN_PAGES_IN_LABELS: Record<string, string> = {
  'Side peek': 'side_peek',
  'Center peek': 'center_peek',
  'Full page': 'full_page',
};

/** In Edit mode: the widget's settings host → "Open pages in ›" → one option. */
export async function setWidgetOpenPagesIn(page: Page, widgetName: string, label: string) {
  const value = OPEN_PAGES_IN_LABELS[label];

  if (!value) throw new Error(`Unknown "Open pages in" option "${label}"`);
  const widget = widgetLocator(page, widgetName);
  const tool = widget.getByTestId('dashboard-widget-settings-button');

  await widget.hover();
  await expect(tool).toBeVisible(DRILL_TIMEOUT);
  if ((await tool.getAttribute('data-state')) !== 'open') await tool.click();
  const host = page.getByTestId('dashboard-widget-settings');

  await expect(host).toBeVisible(DRILL_TIMEOUT);
  const row = host.getByTestId('dashboard-widget-settings-open-pages-in');

  await row.hover();
  await row.click();
  const option = page.getByTestId(`open-pages-in-option-${value}`);

  await expect(option).toBeVisible(DRILL_TIMEOUT);
  await option.click();
  await expect(row).toContainText(label, DRILL_TIMEOUT);
  await pressEscapeUntilHidden(page, host);
}

/** The view's stored `open_pages_in`, as the browser's database doc holds it. */
export async function viewOpenPagesIn(page: Page, viewName: string): Promise<unknown> {
  const viewId = viewIdForLabel(page, viewName);

  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const view = bridge?.byView(id)?.databaseDoc.getMap('data').get('database').get('views').get(id);

    return view?.get('open_pages_in') ?? null;
  }, viewId);
}

// ---------------------------------------------------------------------------
// Chart setup (WP12)
// ---------------------------------------------------------------------------

/** Group a use-case chart view by a property (its `group_by_field_id`) and wait for the server. */
export async function groupUseCaseChartBy(page: Page, request: APIRequestContext, viewName: string, property: string) {
  const databaseName = databaseForLabel(page, viewName);
  const database = fixtureDatabase(page, databaseName);
  const viewId = viewIdForLabel(page, viewName);
  const fieldId = database.fieldIds[property];

  expect(fieldId, `"${databaseName}" has no "${property}" property`).toBeTruthy();
  const write = () =>
    page.evaluate(
      ({ databaseId, viewId, fieldId }) => {
        const doc = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
        const chart = doc.getMap('data').get('database').get('views').get(viewId).get('layout_settings').get('3');

        doc.transact(() => chart.set('group_by_field_id', fieldId));
      },
      { databaseId: database.databaseId, viewId, fieldId }
    );

  await write();
  await waitForViewSync(page, request, databaseName, [viewId], write);
}
