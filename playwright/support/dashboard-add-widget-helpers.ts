/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * The dashboard add-widget flow (WP06) and the dashboard-owned widget views
 * (WP05b) in the browser: the docked "New view" picker, its New view panel,
 * the empty dashboard, the owner marker and the views a dashboard created.
 * Builds on `dashboard-test-helpers.ts` (`openWidgetPicker`,
 * `pickExistingView`, `DashboardSelectors`) without editing its other symbols.
 */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { ERROR_CODE } from '../../src/application/constants';

import { escapeRegExp, WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  allWidgets,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  DatabaseViewLayout,
  fixtureDatabase,
  hostDatabase,
  LAYOUT_BY_NAME,
  lastPickerWidget,
  openWidgetMenu,
  openWidgetPicker,
  PersistedWidget,
  readDashboardSetting,
  readDatabaseViews,
  seedDashboardWidgets,
} from './dashboard-test-helpers';

/** The English picker label of each New view layout (WP06 §1.4: Grid reads "Table"). */
export const PICKER_LAYOUT_LABELS: Record<string, DatabaseViewLayout> = {
  Table: DatabaseViewLayout.Grid,
  Board: DatabaseViewLayout.Board,
  Gallery: DatabaseViewLayout.Gallery,
  List: DatabaseViewLayout.List,
  Chart: DatabaseViewLayout.Chart,
  Timeline: DatabaseViewLayout.Timeline,
  Feed: DatabaseViewLayout.Feed,
  Calendar: DatabaseViewLayout.Calendar,
};

/** A layout by its picker label ("Table") or its tab name ("Grid"). */
export function layoutOf(name: string): DatabaseViewLayout {
  const layout = PICKER_LAYOUT_LABELS[name] ?? LAYOUT_BY_NAME[name];

  if (layout === undefined) throw new Error(`Unknown layout "${name}"`);
  return layout;
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

/** The persisted widget at a 1-based reading-order position. */
export async function persistedWidgetAt(page: Page, index: number): Promise<PersistedWidget> {
  const widgets = allWidgets(await readDashboardSetting(page));
  const widget = widgets[index - 1];

  if (!widget) throw new Error(`The dashboard has no widget ${index} (it has ${widgets.length})`);
  return widget;
}

/** Every view of a mounted database doc with the collab mirror of its owner marker. */
export async function readOwnedViewMarkers(page: Page, databaseId: string): Promise<Record<string, string | null>> {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const views = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('views');
    const result: Record<string, string | null> = {};

    views?.forEach((view: any, viewId: string) => {
      const owner = view.get('dashboard_owner');

      result[viewId] = typeof owner === 'string' && owner.length > 0 ? owner : null;
    });
    return result;
  }, databaseId);
}

/** The views of `databaseId` the scenario's dashboard (or `owner`) owns. */
export async function viewsOwnedBy(page: Page, databaseId: string, owner = dashboardViewId(page)): Promise<string[]> {
  const markers = await readOwnedViewMarkers(page, databaseId);

  return Object.entries(markers)
    .filter(([, value]) => value === owner)
    .map(([viewId]) => viewId);
}

/** The chart map (`layout_settings['3']`) of a view, as plain JSON with numbers. */
export async function readChartMap(
  page: Page,
  databaseId: string,
  viewId: string
): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ({ databaseId: id, viewId: view }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const collabView = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('views')?.get(view);
      const chart = collabView?.get('layout_settings')?.get('3');

      if (!chart) return null;
      return JSON.parse(
        JSON.stringify(bridge.plain(chart), (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
      );
    },
    { databaseId, viewId }
  );
}

// ---------------------------------------------------------------------------
// The add flow
// ---------------------------------------------------------------------------

/** The widget the add flow inserted last. */
export function newWidget(page: Page): Locator {
  return DashboardSelectors.widget(page, lastPickerWidget(page).widgetId);
}

/** The persisted record of the widget the add flow inserted last. */
export async function newWidgetRecord(page: Page): Promise<PersistedWidget> {
  const { widgetId } = lastPickerWidget(page);
  const widget = allWidgets(await readDashboardSetting(page)).find((candidate) => candidate.id === widgetId);

  if (!widget) throw new Error(`The new widget ${widgetId} is not persisted`);
  return widget;
}

/** Close the docked picker (or New view panel) from its round close button. */
export async function closeDockedPicker(page: Page) {
  const panel = DashboardSelectors.picker(page).or(DashboardSelectors.newViewPanel(page));
  const close = DashboardSelectors.pickerClose(page).or(page.getByTestId('dashboard-widget-new-view-panel-close'));

  await close.first().click();
  await expect(panel).toHaveCount(0, WIDGET_TIMEOUT);
}

/** The labels of the picker's New view rows, in order. */
export async function pickerNewViewTypes(page: Page): Promise<string[]> {
  return (await DashboardSelectors.pickerLayoutOptions(page).allInnerTexts()).map((text) => text.trim());
}

/**
 * "Choose a new view type" in the docked picker: the widget's own view
 * switches in place and the New view panel replaces the list.
 */
export async function chooseNewViewType(page: Page, layoutName: string) {
  const layout = layoutOf(layoutName);

  await DashboardSelectors.pickerLayoutOption(page, layout).click();
  await expect(DashboardSelectors.newViewPanel(page)).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.newViewTile(page, layout)).toHaveAttribute('data-selected', 'true', WIDGET_TIMEOUT);
  return layout;
}

/**
 * A new owned view for a widget, as the user makes it: "+" inserts the
 * default widget; for the host database a New view type turns its own view
 * into `layoutName`, for another database "Other data sources › New view in
 * {database}" creates the view there and the widget swaps to it. The dock is
 * closed afterwards. Resolves to the widget's view id.
 */
export async function createWidgetViewThroughPicker(page: Page, layoutName: string, database: string) {
  const target = fixtureDatabase(page, database);
  const layout = layoutOf(layoutName);
  const widgetId = await openWidgetPicker(page);

  if (target.databaseId === hostDatabase(page).databaseId) {
    await chooseNewViewType(page, layoutName);
    await closeDockedPicker(page);
  } else {
    await DashboardSelectors.pickerOtherSources(page).click();
    await DashboardSelectors.pickerNewInDatabase(page, target.databaseId).click();
    await DashboardSelectors.pickerLayoutOption(page, layout).click();
    await expect(DashboardSelectors.picker(page)).toBeHidden(WIDGET_TIMEOUT);
  }

  let viewId = '';

  await expect
    .poll(
      async () => {
        const widget = allWidgets(await readDashboardSetting(page)).find((candidate) => candidate.id === widgetId);
        const views = await readDatabaseViews(page, target.databaseId);

        viewId = widget?.view_id ?? '';
        const view = views.find((candidate) => candidate.id === viewId);

        // The view is named after its type once the switch lands (WP06 §1.5: "Board", "Board (1)", ...).
        return (
          widget?.database_id === target.databaseId &&
          view?.layout === layout &&
          new RegExp(`^${escapeRegExp(layoutName)}( \\(\\d+\\))?$`).test(view.name ?? '')
        );
      },
      { ...WIDGET_TIMEOUT, message: `waiting for the widget to show a new ${layoutName} view of "${database}"` }
    )
    .toBe(true);
  return viewId;
}

// ---------------------------------------------------------------------------
// Plan gating
// ---------------------------------------------------------------------------

/**
 * Make every Chart view creation fail the way a workspace that may not create
 * charts does (WP06 §1.2): the server's plan refusal.
 */
export async function refuseChartViewCreation(page: Page) {
  await page.route('**/page-view/*/database-view', async (route) => {
    const body = route.request().postDataJSON() as { layout?: number } | null;

    // Folder layout 5 is Chart.
    if (route.request().method() === 'POST' && Number(body?.layout) === 5) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: ERROR_CODE.INVALID_SUBSCRIPTION_PLAN, message: 'Pro required' }),
      });
      return;
    }

    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// The widget menu by position
// ---------------------------------------------------------------------------

/** The n-th widget (1-based, reading order). */
export function widgetAtIndex(page: Page, index: number): Locator {
  return DashboardSelectors.widgets(page).nth(index - 1);
}

/** Choose `action` in the menu of widget `index`; the menu must offer it enabled unless `refused`. */
export async function chooseWidgetMenuEntryAt(
  page: Page,
  index: number,
  action: 'duplicate' | 'delete' | 'view-data-source',
  { refused = false }: { refused?: boolean } = {}
) {
  await openWidgetMenu(page, widgetAtIndex(page, index));
  const item = DashboardSelectors.widgetMenuItem(page, action);

  await expect(item).toBeVisible(WIDGET_TIMEOUT);
  if (refused) await expect(item).toHaveAttribute('aria-disabled', 'true');
  // An aria-disabled entry still takes the press (and refuses it); Playwright would wait for it to be enabled.
  await item.click(refused ? { force: true } : undefined);
}

/**
 * Undo through the dashboard's history shortcut. History hotkeys act on the
 * database scope that last received a pointerdown and widgets mount their own
 * scopes, so the dashboard surface (the host database) is pointed at first.
 */
export async function pressDashboardUndo(page: Page) {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await DashboardSelectors.view(page).dispatchEvent('pointerdown', { bubbles: true });
  await page.keyboard.press(`${modifier}+z`);
}

// ---------------------------------------------------------------------------
// Folder (server) views
// ---------------------------------------------------------------------------

/** The folder name of a view as the server stores it. */
export async function readFolderViewName(page: Page, request: APIRequestContext, viewId: string): Promise<string> {
  const world = dashboardWorld(page);
  const response = await request.get(`/api/workspace/${world.workspaceId}/view/${viewId}?depth=0`, {
    headers: { Authorization: `Bearer ${world.owner.accessToken}` },
  });
  const json = (await response.json()) as { data?: { name?: string } };

  return json.data?.name ?? '';
}

/** Whether the folder still lists a view (a deleted view is gone or in the trash). */
export async function folderViewExists(page: Page, request: APIRequestContext, viewId: string): Promise<boolean> {
  const world = dashboardWorld(page);
  const response = await request.get(`/api/workspace/${world.workspaceId}/view/${viewId}?depth=0`, {
    headers: { Authorization: `Bearer ${world.owner.accessToken}` },
  });

  if (!response.ok()) return false;
  const json = (await response.json()) as { code?: number; data?: { is_trashed?: boolean; extra?: unknown } };

  return json.code === 0 && json.data?.is_trashed !== true;
}

/** Wait until a view is gone from its database doc. */
export async function expectViewGone(page: Page, databaseId: string, viewId: string) {
  await expect
    .poll(async () => (await readDatabaseViews(page, databaseId)).some((view) => view.id === viewId), {
      timeout: WIDGET_TIMEOUT_MS * 2,
      message: `waiting for view ${viewId} to be deleted`,
    })
    .toBe(false);
}

/** Seed `count` widgets of the host database's Grid view, four to a row (WP05 §4 "the dashboard has 12 widgets"). */
export async function seedWidgetsOfHostGrid(page: Page, count: number) {
  const host = hostDatabase(page).name;

  await seedDashboardWidgets(
    page,
    Array.from({ length: count }, (_, index) => ({
      row: Math.floor(index / 4) + 1,
      label: `${host} Grid #${index + 1}`,
    }))
  );
}
