/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * Dashboard-owned widget views (WP05) BDD helpers.
 *
 * Builds on `dashboard-test-helpers.ts` without editing it: the owner marker
 * is read from both of its copies, the database collab mirror
 * (`views[id].dashboard_owner`, through the test bridge) and the folder view
 * `extra` (through the Cloud API).
 */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { DatabaseViewSelectors } from './selectors';
import {
  apiGet,
  apiPatch,
  apiPost,
  dashboardViewId,
  dashboardWorld,
  DashboardSelectors,
  DatabaseViewLayout,
  DatabaseViewSummary,
  fixtureDatabase,
  openDatabasePage,
  readDashboardSetting,
  readDatabaseViews as readBaseDatabaseViews,
  waitForDatabaseContext,
} from './dashboard-test-helpers';

const OWNED_VIEWS_TIMEOUT_MS = 30_000;
const FOLDER_LAYOUT_GRID = 1;

export interface OwnedDatabaseViewSummary extends DatabaseViewSummary {
  /** The collab mirror of the owner marker (`null` when absent). */
  dashboardOwner: string | null;
}

/** Every view of a mounted database doc, with the collab mirror of its owner marker. */
export async function readDatabaseViews(page: Page, databaseId: string): Promise<OwnedDatabaseViewSummary[]> {
  const views = await readBaseDatabaseViews(page, databaseId);
  const owners = await page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const collabViews = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('views');
    const result: Record<string, string | null> = {};

    collabViews?.forEach((view: any, viewId: string) => {
      const owner = view.get('dashboard_owner');

      result[viewId] = typeof owner === 'string' && owner.length > 0 ? owner : null;
    });
    return result;
  }, databaseId);

  return views.map((view) => ({ ...view, dashboardOwner: owners[view.id] ?? null }));
}

/** The folder view's `extra` as the server stores it (the authoritative owner marker). */
export async function readFolderViewExtra(
  page: Page,
  request: APIRequestContext,
  viewId: string
): Promise<Record<string, unknown>> {
  const world = dashboardWorld(page);
  const view = await apiGet<{ extra?: unknown }>(
    request,
    world.owner.accessToken,
    `/api/workspace/${world.workspaceId}/view/${viewId}?depth=0`
  );
  const extra = typeof view.extra === 'string' ? (JSON.parse(view.extra || '{}') as unknown) : view.extra;

  return extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
}

/** The database page's tab strip: its own scroll container. */
export function tabStrip(page: Page): Locator {
  return page.locator('[data-parity-id="dash-content-column"] .appflowy-hidden-scroller').first();
}

/** The view ids of the database page's tabs, in tab order. */
export async function tabBarViewIds(page: Page): Promise<string[]> {
  return tabStrip(page)
    .locator('[data-testid^="view-tab-"]')
    .evaluateAll((tabs) => tabs.map((tab) => (tab.getAttribute('data-testid') ?? '').replace('view-tab-', '')));
}

/** Whether the strip overflows, so revealing a tab can need a scroll at all. */
export async function tabStripOverflows(page: Page): Promise<boolean> {
  return tabStrip(page).evaluate((strip) => strip.scrollWidth > strip.clientWidth + 1);
}

/** Whether the tab's whole box lies inside the strip's visible box (0.5px tolerance). */
export async function isTabFullyVisible(page: Page, viewId: string): Promise<boolean> {
  const strip = await tabStrip(page).boundingBox();
  const tab = await DatabaseViewSelectors.viewTab(page, viewId).boundingBox();

  if (!strip || !tab) return false;
  return tab.x >= strip.x - 0.5 && tab.x + tab.width <= strip.x + strip.width + 0.5;
}

/**
 * Add `count` views of `layoutName` to the database container through the
 * Cloud API, right after its first Grid, so they sit before every later tab
 * (the dashboard).
 */
export async function seedDatabaseTabs(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  count: number,
  layoutName = 'Grid'
): Promise<string[]> {
  if (layoutName !== 'Grid') throw new Error(`Only Grid tabs are seeded, got "${layoutName}"`);
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const created: string[] = [];
  let prevViewId = database.views.Grid;

  for (let index = 1; index <= count; index += 1) {
    const response = await apiPost<{ view_id: string }>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/page-view/${database.views.Grid}/database-view`,
      {
        parent_view_id: database.pageId,
        prev_view_id: prevViewId,
        database_id: database.databaseId,
        layout: FOLDER_LAYOUT_GRID,
        name: `Grid ${index}`,
        embedded: false,
      }
    );

    created.push(response.view_id);
    prevViewId = response.view_id;
  }

  return created;
}

/**
 * Open the database page on `viewId` straight from the URL. Unlike
 * `openDatabasePage`, the tab is never clicked: a click would scroll it into
 * view and hide whether the app revealed it.
 */
export async function reopenDatabaseOnTab(page: Page, databaseName: string, viewId: string) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);

  await page.goto(`/app/${world.workspaceId}/${database.pageId}?v=${viewId}`, { waitUntil: 'domcontentloaded' });
  await waitForDatabaseContext(page, database.databaseId);
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveAttribute('data-state', 'active', {
    timeout: OWNED_VIEWS_TIMEOUT_MS,
  });
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const convertedCopies = new WeakMap<Page, Map<string, string>>();

/** The owned copy (V′) a conversion of `viewId` made its first widget. */
export function convertedCopyViewId(page: Page, viewId: string): string {
  const copyId = convertedCopies.get(page)?.get(viewId);

  if (!copyId) throw new Error(`View ${viewId} was not converted to a dashboard in this scenario`);
  return copyId;
}

/**
 * Switch a view to the Dashboard layout from the database settings menu, as
 * a user does. Converting is asynchronous (the view's owned copy V′ is
 * created on the server first), so this waits for the layout and for V′ as
 * the one widget, makes the converted view the scenario's dashboard and
 * records V′.
 */
export async function switchViewToDashboard(page: Page, databaseName: string, viewId: string): Promise<string> {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);

  await openDatabasePage(page, databaseName, viewId);
  await page.getByTestId('database-actions-settings').click();
  await DatabaseViewSelectors.layoutSettingsTrigger(page).hover();
  await expect(DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Dashboard)).toBeVisible();
  await DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Dashboard).click();
  await page.keyboard.press('Escape');
  world.dashboardViewId = viewId;
  world.dashboardHost = databaseName;
  await expect
    .poll(async () => (await readBaseDatabaseViews(page, database.databaseId)).find((view) => view.id === viewId)?.layout, {
      timeout: OWNED_VIEWS_TIMEOUT_MS,
    })
    .toBe(DatabaseViewLayout.Dashboard);
  let copyId = '';

  await expect
    .poll(
      async () => {
        const widgets = (await readDashboardSetting(page, viewId)).rows.flatMap((row) => row.widgets);

        copyId = widgets.length === 1 ? widgets[0].view_id : '';
        return Boolean(copyId) && copyId !== viewId;
      },
      { timeout: OWNED_VIEWS_TIMEOUT_MS, message: 'waiting for the converted view to show its copy as the first widget' }
    )
    .toBe(true);
  const copies = convertedCopies.get(page) ?? new Map<string, string>();

  copies.set(viewId, copyId);
  convertedCopies.set(page, copies);
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: OWNED_VIEWS_TIMEOUT_MS });
  return copyId;
}

// ---------------------------------------------------------------------------
// Widgets by position
// ---------------------------------------------------------------------------

/** The n-th widget (1-based, reading order) of the scenario's dashboard. */
export function widgetAt(page: Page, index: number): Locator {
  return DashboardSelectors.widgets(page).nth(index - 1);
}

/** The view id of the n-th widget (1-based, row by row) of the persisted layout. */
export async function widgetViewId(page: Page, index: number): Promise<string> {
  const widgets = (await readDashboardSetting(page, dashboardViewId(page))).rows.flatMap((row) => row.widgets);
  const widget = widgets[index - 1];

  if (!widget) throw new Error(`The dashboard has no widget ${index} (it has ${widgets.length})`);
  return widget.view_id;
}

/**
 * The `groups` of a view in a mounted database doc, as plain JSON. Integers
 * are numbers: a native client writes bigints, a copy made on the web writes
 * numbers, and the shared contract compares them by value.
 */
export async function readViewGroups(page: Page, databaseId: string, viewId: string): Promise<unknown> {
  return page.evaluate(
    ({ databaseId: id, viewId: view }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const collabView = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('views')?.get(view);
      const groups = collabView ? bridge.plain(collabView.get('groups')) ?? null : null;

      return JSON.parse(JSON.stringify(groups, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)));
    },
    { databaseId, viewId }
  );
}

/** Rename a database view as the tab bar does: the folder page and the collab name. */
export async function renameDatabaseView(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  viewId: string,
  name: string
) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);

  await apiPatch<void>(request, world.owner.accessToken, `/api/workspace/${world.workspaceId}/page-view/${viewId}`, {
    name,
  });
  await page.evaluate(
    ({ databaseId, viewId: id, name: nextName }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const doc = bridge?.byDatabase(databaseId)?.databaseDoc;
      const view = doc?.getMap('data').get('database')?.get('views')?.get(id);

      if (!view) throw new Error(`view ${id} is not open in the browser`);
      doc.transact(() => view.set('name', nextName));
    },
    { databaseId: database.databaseId, viewId, name }
  );
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toContainText(name, { timeout: OWNED_VIEWS_TIMEOUT_MS });
}
