import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  convertedCopyViewId,
  isTabFullyVisible,
  readDatabaseViews,
  readFolderViewExtra,
  readViewGroups,
  renameDatabaseView,
  reopenDatabaseOnTab,
  seedDatabaseTabs,
  switchViewToDashboard,
  tabBarViewIds,
  tabStripOverflows,
  widgetAt,
  widgetViewId,
} from '../../support/dashboard-owned-views-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  addViewThroughTabs,
  apiGet,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  databaseForLabel,
  expectDashboardMode,
  expectRowHeight,
  expectRowWidths,
  fixtureDatabase,
  LAYOUT_BY_NAME,
  openDatabasePage,
  parseViewLabel,
  prepareDashboardFixture,
  readDashboardSetting,
  splitList,
  viewIdForLabel,
} from '../../support/dashboard-test-helpers';
import { DatabaseViewSelectors } from '../../support/selectors';

/**
 * WP05 dashboard-owned widget views (W2 scenarios: the active tab reveal and
 * conversion). The wording is identical on desktop
 * (`integration_test/desktop/bdd/database/dashboard/dashboard_owned_views*.feature`).
 */
const { Given, When, Then } = createBdd();

/** The persisted widget at a 1-based reading-order position. */
async function persistedWidget(page: Parameters<typeof widgetViewId>[0], index: number) {
  const widgets = (await readDashboardSetting(page)).rows.flatMap((row) => row.widgets);
  const widget = widgets[index - 1];

  if (!widget) throw new Error(`The dashboard has no widget ${index} (it has ${widgets.length})`);
  return widget;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

Given(
  'a {string} database with a {string} view and an empty dashboard in Edit mode',
  async ({ page, request }, database: string, layout: string) => {
    await prepareDashboardFixture(page, request, [database]);
    if (!fixtureDatabase(page, database).views[layout]) await addViewThroughTabs(page, database, layout);
    await addDashboardView(page, database);
    await expectDashboardMode(page, 'Edit');
  }
);

Given(
  '{string} has {int} more {string} views before the dashboard tab',
  async ({ page, request }, database: string, count: number, layout: string) => {
    const world = dashboardWorld(page);
    const fixture = fixtureDatabase(page, database);
    const seeded = await seedDatabaseTabs(page, request, database, count, layout);

    // The container lists them between its first Grid and the dashboard.
    await expect
      .poll(async () => {
        const container = await apiGet<{ children?: { view_id: string }[] }>(
          request,
          world.owner.accessToken,
          `/api/workspace/${world.workspaceId}/view/${fixture.pageId}?depth=1`
        );

        return (container.children ?? []).map((child) => child.view_id);
      }, WIDGET_TIMEOUT)
      .toEqual([fixture.views[layout], ...seeded, dashboardViewId(page)]);
  }
);

Given(
  '{string} has a {string} view named {string}',
  async ({ page, request }, database: string, layout: string, name: string) => {
    const viewId = await addViewThroughTabs(page, database, layout);
    const world = dashboardWorld(page);

    await renameDatabaseView(page, request, database, viewId, name);
    world.viewsByName = { ...(world.viewsByName ?? {}), [name]: { viewId, database } };
  }
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

When('the user reopens the {string} database on the dashboard tab', async ({ page }, database: string) => {
  await reopenDatabaseOnTab(page, database, dashboardViewId(page));
});

When(
  'the user switches the {string} view of {string} to the Dashboard layout',
  async ({ page }, name: string, database: string) => {
    await switchViewToDashboard(page, database, viewIdForLabel(page, name));
  }
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

Then('the active tab is fully visible in the tab bar', async ({ page }) => {
  const viewId = dashboardViewId(page);
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toHaveAttribute('data-state', 'active');
  // Only a strip too narrow for every tab can hide the active one.
  await expect.poll(() => tabStripOverflows(page), WIDGET_TIMEOUT).toBe(true);
  const tabIds = await tabBarViewIds(page);

  expect(tabIds[tabIds.length - 1]).toBe(viewId);
  await expect.poll(() => isTabFullyVisible(page, viewId), WIDGET_TIMEOUT).toBe(true);
});

Then('dashboard row {int} has widths {string}', async ({ page }, rowIndex: number, widths: string) => {
  await expectRowWidths(page, rowIndex, splitList(widths).map(Number));
});

// "Is N pixels tall" is exact (within a rendered pixel); "is about N px tall" allows a snap step.
Then('dashboard row {int} is {int} pixels tall', async ({ page }, rowIndex: number, height: number) => {
  await expectRowHeight(page, rowIndex, height);
});

Then('widget {int} is titled {string}', async ({ page }, index: number, title: string) => {
  await expect(widgetAt(page, index).getByTestId('dashboard-widget-title')).toHaveText(title, WIDGET_TIMEOUT);
});

Then(
  'widget {int} shows a {string} view with the groups of the original {string} view',
  async ({ page }, index: number, layout: string, name: string) => {
    const original = viewIdForLabel(page, name);
    const { view_id: viewId, database_id: databaseId } = await persistedWidget(page, index);
    const views = await readDatabaseViews(page, databaseId);
    const originalGroups = await readViewGroups(page, databaseId, original);

    expect(viewId).not.toBe(original);
    expect(views.find((view) => view.id === viewId)?.layout).toBe(LAYOUT_BY_NAME[layout]);
    expect(originalGroups).toEqual(expect.arrayContaining([expect.objectContaining({ field_id: expect.any(String) })]));
    expect(await readViewGroups(page, databaseId, viewId)).toEqual(originalGroups);
    await expect(widgetAt(page, index).getByTestId('board-column').first()).toBeVisible(WIDGET_TIMEOUT);
  }
);

Then('the view of widget {int} belongs to the dashboard', async ({ page, request }, index: number) => {
  const owner = dashboardViewId(page);
  const { view_id: viewId, database_id: databaseId } = await persistedWidget(page, index);

  // Both copies of the marker: the collab mirror and the authoritative folder extra.
  await expect
    .poll(async () => (await readDatabaseViews(page, databaseId)).find((view) => view.id === viewId)?.dashboardOwner)
    .toBe(owner);
  await expect
    .poll(async () => (await readFolderViewExtra(page, request, viewId)).dashboard_owner, WIDGET_TIMEOUT)
    .toBe(owner);
});

Then(
  'the {string} tab bar shows {string} with the dashboard icon',
  async ({ page }, database: string, name: string) => {
    const viewId = viewIdForLabel(page, name);
    const tab = DatabaseViewSelectors.viewTab(page, viewId);

    if (!(await tab.isVisible())) await openDatabasePage(page, database, viewId);
    await expect(tab).toContainText(name);
    await expect(DashboardSelectors.viewIcon(tab)).toBeVisible();
    // Its owned copy has the same name but is not a tab.
    await expect
      .poll(async () => {
        const texts = await DatabaseViewSelectors.viewTab(page).allInnerTexts();

        return texts.filter((text) => text.trim() === name).length;
      })
      .toBe(1);
  }
);

// dashboard-creation.feature: the layout switcher seeds the converted view's copy.
Then('widget {int} shows a copy of the {string} view', async ({ page }, index: number, label: string) => {
  const original = viewIdForLabel(page, label);
  const copyId = convertedCopyViewId(page, original);
  const databaseId = fixtureDatabase(page, databaseForLabel(page, label)).databaseId;
  const named = Boolean(dashboardWorld(page).viewsByName?.[label]);

  expect(await widgetViewId(page, index)).toBe(copyId);
  const views = await readDatabaseViews(page, databaseId);
  const copy = views.find((view) => view.id === copyId);

  expect(copy).toBeDefined();
  if (!named) expect(copy?.layout).toBe(LAYOUT_BY_NAME[parseViewLabel(label).layout]);
  expect(copy?.name).toBe(views.find((view) => view.id === original)?.name);
  expect(copy?.dashboardOwner).toBe(original);
  await expect(DashboardSelectors.widgetsForView(page, copyId)).toBeVisible(WIDGET_TIMEOUT);
});
