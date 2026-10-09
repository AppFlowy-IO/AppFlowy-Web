/**
 * Dashboards on a phone (WP14b, `dashboard-mobile.feature`): View mode only,
 * Search and Filter always shown on widgets, and bottom sheets for menus,
 * filters and drill-downs. The wording is shared with the Flutter mobile BDD
 * (`mobile_dashboard.feature`, `mobile_dashboard_cloud.feature`).
 *
 * Reused as they are: `the dashboard is in View mode`, `the dashboard offers
 * no Edit button`, `the "…" widget shows the tools "…" without hover`, `the
 * "…" tool of the "…" widget is highlighted`, `the "…" widget shows the rows
 * "…"`, `the "…" view has {int} saved filters`, the composite `a dashboard of
 * "…" shows its "…" and "…" views side by side`, `the member sees the
 * dashboard in View mode without the Edit button` and `the member sees the
 * "…" widget show the rows "…"`. Widgets are named by their view ("Grid").
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  clearWidgetSearch,
  closeBottomSheet,
  drillSheet,
  drillSheetRowTitles,
  expectNoEditingControls,
  expectNoSaveForEveryone,
  expectPillSheetFor,
  expectRowOpensFullScreen,
  expectRowSideBySide,
  expectSavedFilterMatchesOnly,
  expectSheetTitled,
  expectStackedAtFullWidth,
  expectTitleReplacedBySearch,
  expectToolbarFilterOnly,
  expectViewOpensFullScreen,
  filterByPropertyInSheet,
  longPress,
  memberAlsoSelectsInPill,
  openDashboardAsMemberOnPhone,
  openPhoneDashboardWithBarChart,
  openPhoneDashboardWithViews,
  PHONE_VIEWPORT,
  sheetItemLabels,
  seedSavedSelectFilter,
  TABLET_VIEWPORT,
  tapChartBar,
  tapDrillSheetRow,
  tapGlobalFilterPill,
  toggleOptionInSheet,
  typeInWidgetSearch,
  useMobileViewport,
} from '../../support/dashboard-mobile-helpers';
import { expectChipDot } from '../../support/dashboard-private-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import { DashboardSelectors, memberPage, splitList, widgetLocator } from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

Given(
  'a phone shows a dashboard of {string} with its {string} and {string} views side by side',
  async ({ page, request }, database: string, first: string, second: string) => {
    await openPhoneDashboardWithViews(page, request, database, first, second);
  }
);

Given(
  'a phone shows a dashboard of {string} with its {string} bar chart',
  async ({ page, request }, database: string, property: string) => {
    await openPhoneDashboardWithBarChart(page, request, database, property);
  }
);

// A phone turned sideways or a small tablet: 600×960 (WP14 §6.2), still a mobile context below 768px.
When('the screen is {int} pixels wide', async ({ page }, width: number) => {
  await useMobileViewport(page, width === TABLET_VIEWPORT.width ? TABLET_VIEWPORT : { ...PHONE_VIEWPORT, width });
});

Then('the dashboard shows no add, move or resize controls', async ({ page }) => {
  await expectNoEditingControls(page);
});

Then('the dashboard toolbar shows only the Filter button', async ({ page }) => {
  await expectToolbarFilterOnly(page);
});

Then(
  'the {string} widget is above the {string} widget at full width',
  async ({ page }, upper: string, lower: string) => {
    await expectStackedAtFullWidth(page, upper, lower);
  }
);

Then('the widgets of dashboard row {int} are side by side', async ({ page }, row: number) => {
  await expectRowSideBySide(page, row);
});

// ---------------------------------------------------------------------------
// Widget tools, search and menu
// ---------------------------------------------------------------------------

When('I tap the {string} tool of the {string} widget', async ({ page }, tool: string, widget: string) => {
  const button = DashboardSelectors.widgetTool(widgetLocator(page, widget), tool);

  await expect(button).toBeVisible(WIDGET_TIMEOUT);
  await button.click();
});

When('I type {string} into the search field of the {string} widget', async ({ page }, text: string, widget: string) => {
  await typeInWidgetSearch(page, widget, text);
});

Then('the {string} widget title is replaced by its search field', async ({ page }, widget: string) => {
  await expectTitleReplacedBySearch(page, widget);
});

When('I clear the search field of the {string} widget', async ({ page }, widget: string) => {
  await clearWidgetSearch(page, widget);
});

When('I tap the {string} widget title', async ({ page }, widget: string) => {
  await widgetLocator(page, widget).getByTestId('dashboard-widget-title-button').click();
});

When('I long-press the {string} widget title', async ({ page }, widget: string) => {
  await longPress(widgetLocator(page, widget).getByTestId('dashboard-widget-title-button'));
});

Then('the {string} view of {string} opens full screen', async ({ page }, layout: string, database: string) => {
  await expectViewOpensFullScreen(page, database, layout);
});

// ---------------------------------------------------------------------------
// Bottom sheets
// ---------------------------------------------------------------------------

Then('a bottom sheet titled {string} is open', async ({ page }, title: string) => {
  await expectSheetTitled(page, title);
});

Then('a bottom sheet offers only {string}', async ({ page }, labels: string) => {
  await expect(DashboardSelectors.mobileSheet(page, 'widget-menu')).toBeVisible(WIDGET_TIMEOUT);
  expect(await sheetItemLabels(page)).toEqual(splitList(labels));
});

When('I choose {string} in the bottom sheet', async ({ page }, label: string) => {
  await DashboardSelectors.mobileSheetItems(page).filter({ hasText: label }).first().click();
  await expect(page.getByTestId('mobile-sheet')).toHaveCount(0, WIDGET_TIMEOUT);
});

When('I close the bottom sheet', async ({ page }) => {
  await closeBottomSheet(page);
});

When('I filter by the checkbox property {string} in the bottom sheet', async ({ page }, property: string) => {
  await filterByPropertyInSheet(page, property);
});

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

Given(
  'the dashboard has a saved global filter where {string} is {string}',
  async ({ page, request }, property: string, options: string) => {
    await seedSavedSelectFilter(page, request, property, options);
  }
);

When('I tap the {string} global filter pill', async ({ page }, name: string) => {
  await tapGlobalFilterPill(page, name);
});

Then('a bottom sheet shows the {string} global filter', async ({ page }, name: string) => {
  await expectPillSheetFor(page, name);
});

When('I also select {string} in the bottom sheet', async ({ page }, option: string) => {
  await toggleOptionInSheet(page, option);
});

Then('the {string} global filter pill shows the unsaved dot', async ({ page }, name: string) => {
  await expectChipDot(page, name);
});

Then('the saved {string} global filter still matches only {string}', async ({ page }, name: string, option: string) => {
  await expectSavedFilterMatchesOnly(page, name, option);
});

// ---------------------------------------------------------------------------
// Chart drill-down
// ---------------------------------------------------------------------------

When('I tap the {string} bar of the {string} widget', async ({ page }, category: string, widget: string) => {
  await tapChartBar(page, widget, category);
});

When('I tap the {string} bar of the {string} widget again', async ({ page }, category: string, widget: string) => {
  await tapChartBar(page, widget, category);
});

Then('the chart tooltip shows {string}', async ({ page }, category: string) => {
  const tooltip = DashboardSelectors.chartTooltip(page).filter({ visible: true }).first();

  await expect(tooltip).toBeVisible(WIDGET_TIMEOUT);
  await expect(tooltip).toContainText(category);
  // A first tap only shows the values: nothing drilled in yet.
  await expect(DashboardSelectors.mobileSheet(page, 'drilldown')).toHaveCount(0);
});

Then('a full-height bottom sheet titled {string} is open', async ({ page }, title: string) => {
  const sheet = await expectSheetTitled(page, title, 'drilldown');

  await expect(sheet).toHaveAttribute('data-size', 'full');
});

Then('the bottom sheet shows the filter chip {string}', async ({ page }, text: string) => {
  await expect(drillSheet(page).getByTestId('drill-chip').filter({ hasText: text }).first()).toBeVisible(WIDGET_TIMEOUT);
});

Then('the bottom sheet lists the rows {string}', async ({ page }, titles: string) => {
  await expect.poll(() => drillSheetRowTitles(page), WIDGET_TIMEOUT).toEqual(splitList(titles));
});

When('I tap the row {string} in the bottom sheet', async ({ page }, title: string) => {
  await tapDrillSheetRow(page, title);
});

Then('the row {string} opens full screen', async ({ page }, title: string) => {
  await expectRowOpensFullScreen(page, 'Projects', title);
});

// ---------------------------------------------------------------------------
// The view pill
// ---------------------------------------------------------------------------

When('I open the view list', async ({ page }) => {
  await DashboardSelectors.viewPill(page).click();
  await expect(DashboardSelectors.mobileSheet(page, 'views')).toBeVisible(WIDGET_TIMEOUT);
});

When('I start adding a view', async ({ page }) => {
  await DashboardSelectors.mobileSheetItem(page, 'new-view').click();
  await expect(DashboardSelectors.mobileSheetBack(page)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the layout list does not offer {string}', async ({ page }, layout: string) => {
  const labels = await sheetItemLabels(page);

  // The layout list is showing (the Grid layout is always offered) ...
  expect(labels.length).toBeGreaterThan(1);
  // ... without the refused layout.
  expect(labels.map((label) => label.trim())).not.toContain(layout);
});

// ---------------------------------------------------------------------------
// The read-only member
// ---------------------------------------------------------------------------

Given('a read-only member opens the dashboard on a phone', async ({ page, request }) => {
  await openDashboardAsMemberOnPhone(page, request);
});

When(
  'the member also selects {string} in the {string} global filter pill',
  async ({ page }, option: string, name: string) => {
    await memberAlsoSelectsInPill(page, option, name);
  }
);

Then('the member sees no Save for everyone button', async ({ page }) => {
  await expectNoSaveForEveryone(memberPage(page));
});
