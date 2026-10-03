/**
 * R-MODE and mobile-context helpers for the dashboard BDD (WP14a): simulated
 * write access, the shared "dashboard with two views side by side" fixture,
 * view tab switches that keep the database page mounted, and a View-mode
 * check that knows when Edit mode cannot be offered.
 */
import { APIRequestContext, expect, Page, Route } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { AccessLevel } from '../../src/application/types';
import { MOBILE_CONTEXT_BREAKPOINT } from '../../src/components/_shared/hooks/useMobileContext';

import { WIDGET_TIMEOUT } from './dashboard-shared-helpers';
import {
  addDashboardView,
  addFixtureDatabase,
  addViewThroughTabs,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  expectDashboardMode,
  fixtureDatabase,
  leaveEditMode,
  openDashboard,
  peekDashboardWorld,
  prepareDashboardFixture,
  readDashboardSetting,
  seedDashboardWidgets,
  viewIdForLabel,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import { DatabaseViewSelectors } from './selectors';

const PERMISSION_PROBE_URL = /\/api\/workspace\/[^/]+\/collab\/[^/]+\/permission(?:\?|$)/;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Prepare the fixture workspace with `name` (once per scenario), or add `name` to it. */
export async function ensureFixtureDatabase(page: Page, request: APIRequestContext, name: string) {
  const world = peekDashboardWorld(page);

  if (!world) {
    await prepareDashboardFixture(page, request, [name]);
    return;
  }

  if (!world.databases[name]) await addFixtureDatabase(page, request, name);
}

/** The fixture database's view of `layout` ("Grid", "Board", ...), added through its tab bar when missing. */
export async function ensureLayoutView(page: Page, database: string, layout: string) {
  if (!fixtureDatabase(page, database).views[layout]) await addViewThroughTabs(page, database, layout);
  return viewIdForLabel(page, `${database} ${layout}`);
}

/**
 * The shared composite fixture: a new dashboard of `database` whose first row
 * shows its `first` and `second` views side by side, open, in View mode, with
 * both widgets rendered. Widgets are labelled "<database> <layout>".
 */
export async function openDashboardWithViewsSideBySide(
  page: Page,
  request: APIRequestContext,
  database: string,
  first: string,
  second: string
) {
  await ensureFixtureDatabase(page, request, database);
  await ensureLayoutView(page, database, first);
  await ensureLayoutView(page, database, second);
  await addDashboardView(page, database);
  await seedDashboardWidgets(page, [
    { row: 1, label: `${database} ${first}` },
    { row: 1, label: `${database} ${second}` },
  ]);
  await leaveEditMode(page);

  const world = dashboardWorld(page);
  const widgets = [world.widgets[`${database} ${first}`], world.widgets[`${database} ${second}`]];

  for (const widget of widgets) await expect(DashboardSelectors.widget(page, widget.id)).toBeVisible(WIDGET_TIMEOUT);
  const [row] = (await readDashboardSetting(page)).rows;

  expect(row.widgets.map((widget) => widget.id)).toEqual(widgets.map((widget) => widget.id));
  await expectDashboardMode(page, 'View');
}

/**
 * A collaborator's change: written straight into the dashboard's Y doc,
 * bypassing this client's layout writer, so R-MODE sees remote rows.
 */
export async function collaboratorAddsWidget(page: Page, database: string, layout: string) {
  const label = `${database} ${layout}`;
  const world = dashboardWorld(page);
  const current = await readDashboardSetting(page);
  const widget = {
    id: `w-${uuidv4().slice(0, 12)}`,
    view_id: viewIdForLabel(page, label),
    database_id: fixtureDatabase(page, database).databaseId,
    width: DASHBOARD_GRID_COLUMNS,
  };

  world.widgets[label] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
  await writeDashboardSetting(page, {
    rows: [
      ...current.rows,
      { id: `r-${uuidv4().slice(0, 12)}`, height: DASHBOARD_DEFAULT_ROW_HEIGHT, widgets: [widget] },
    ],
  });
  await expect(DashboardSelectors.widget(page, widget.id)).toBeVisible(WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// View tabs (the database page stays mounted)
// ---------------------------------------------------------------------------

async function clickViewTab(page: Page, viewId: string) {
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toBeVisible(WIDGET_TIMEOUT);
  await tab.click();
  await expect(tab).toHaveAttribute('data-state', 'active', WIDGET_TIMEOUT);
}

export async function openLayoutViewTab(page: Page, database: string, layout: string) {
  await clickViewTab(page, viewIdForLabel(page, `${database} ${layout}`));
  await expect(DashboardSelectors.view(page)).toBeHidden(WIDGET_TIMEOUT);
}

export async function openDashboardViewTab(page: Page) {
  await clickViewTab(page, dashboardViewId(page));
  await expect(DashboardSelectors.view(page)).toBeVisible(WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Simulated write access
// ---------------------------------------------------------------------------

type WriteAccess = 'confirmed' | 'withheld';

const writeAccess = new WeakMap<Page, WriteAccess>();
const probeRoutes = new WeakSet<Page>();

/**
 * Answer the page's permission probes as the server does, with write access
 * removed while it is withheld. One route stays installed for the rest of the
 * scenario: routing disables the browser cache, so a probe after the access
 * returns is answered by the server, never by a 304 of the altered body.
 */
async function ensurePermissionRoute(page: Page) {
  if (probeRoutes.has(page)) return;
  probeRoutes.add(page);
  await page.route(PERMISSION_PROBE_URL, async (route: Route) => {
    if (writeAccess.get(page) !== 'withheld') {
      await route.continue();
      return;
    }

    const headers = { ...route.request().headers() };

    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });
    const body = (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null;

    if (!body?.data || typeof body.data !== 'object') {
      await route.fulfill({ response });
      return;
    }

    await route.fulfill({
      status: response.status(),
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      json: { ...body, data: { ...body.data, can_write: false, access_level: AccessLevel.ReadOnly } },
    });
  });
}

function nextPermissionProbe(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === 'GET' && PERMISSION_PROBE_URL.test(response.url()),
    WIDGET_TIMEOUT
  );
}

/**
 * Re-probe the page's permissions the way returning to the browser tab does
 * (AppBusinessLayer's visibilitychange handler). The server's HTTP cache may
 * answer a repeated probe with 304 Not Modified.
 */
export async function reprobePermissions(page: Page) {
  const probe = nextPermissionProbe(page);

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const response = await probe;

  expect(response.ok() || response.status() === 304).toBe(true);
}

/** Write access is lost: the next probe answers read-only, and editing controls disappear. */
export async function loseDashboardWriteAccess(page: Page) {
  await ensurePermissionRoute(page);
  writeAccess.set(page, 'withheld');
  await reprobePermissions(page);
  await expectNoEditButton(page);
}

/** Write access is confirmed or restored: the next probe answers as the server does. */
export async function confirmDashboardWriteAccess(page: Page) {
  await ensurePermissionRoute(page);
  writeAccess.set(page, 'confirmed');
  await reprobePermissions(page);
  await expect(DashboardSelectors.editButton(page).or(DashboardSelectors.doneButton(page))).toBeVisible(
    WIDGET_TIMEOUT
  );
}

/**
 * Open a new, empty dashboard of `database` whose permission probe answers
 * read-only: the page opens before its write access is confirmed.
 */
export async function openEmptyDashboardWithoutConfirmedAccess(
  page: Page,
  request: APIRequestContext,
  database: string
) {
  await ensureFixtureDatabase(page, request, database);
  await addDashboardView(page, database);
  await ensurePermissionRoute(page);
  writeAccess.set(page, 'withheld');
  const probe = nextPermissionProbe(page);

  await openDashboard(page);
  await probe;
  await expectNoEditButton(page);
}

// ---------------------------------------------------------------------------
// Mode checks
// ---------------------------------------------------------------------------

/**
 * Whether the dashboard should offer Edit mode now: write access that is not
 * withheld, outside a mobile context (a web viewport of 768px or more).
 */
/** Below the web mobile-context breakpoint Edit mode is never offered. */
export function dashboardEditOffered(page: Page) {
  const width = page.viewportSize()?.width ?? MOBILE_CONTEXT_BREAKPOINT;

  return writeAccess.get(page) !== 'withheld' && width >= MOBILE_CONTEXT_BREAKPOINT;
}

/** Neither Edit nor Done, in the toolbar or in the empty state. */
export async function expectNoEditButton(page: Page) {
  await expect(DashboardSelectors.view(page)).toBeVisible();
  await expect(DashboardSelectors.editButton(page)).toHaveCount(0);
  await expect(DashboardSelectors.doneButton(page)).toHaveCount(0);
  await expect(page.getByTestId('dashboard-empty-edit-button')).toHaveCount(0);
}

/**
 * View mode. Where Edit mode can be offered this is the existing check (an
 * Edit button, no editing controls); where it cannot (write access withheld,
 * a narrow window) there is no Edit button either.
 */
export async function expectDashboardViewMode(page: Page) {
  if (dashboardEditOffered(page)) {
    await expectDashboardMode(page, 'View');
    return;
  }

  await expect(DashboardSelectors.view(page)).toHaveAttribute('data-editing', 'false');
  await expectNoEditButton(page);
  await expect(DashboardSelectors.widthHandles(page)).toHaveCount(0);
  await expect(DashboardSelectors.addWidgetButton(page).filter({ visible: true })).toHaveCount(0);
}
