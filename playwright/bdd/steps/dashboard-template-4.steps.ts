/**
 * Steps of the template scenarios of set 4 (`dashboard-usecases/life-os`,
 * `training-log` and `hr-headcount`), on top of the use-case steps
 * (`dashboard-usecase.steps.ts`) and the dashboard steps they reuse as they
 * are (opening a dashboard, the number cards, donut totals, the drill-down,
 * the filter bar, the phone's bottom sheets, the add flow's new widget).
 *
 * Every definition here is scoped to `@dashboard-template-4`, the tag of
 * those three features. Three of them have the words of a shared step and
 * replace it there (playwright-bdd prefers a tagged definition):
 *
 * - `"…" has these views:` reads a wider settings language
 *   (`parseTemplateView` in `dashboard-template-4-helpers.ts`): WP11
 *   aggregations, date grouping, the Number card's format and title,
 *   checkbox and by-name select conditions, and the Feed layout;
 * - `I add a global filter where "…" is "…"` picks options by name, so it
 *   also works on the employees fixture, whose option ids are its own;
 * - `no more than {int} source databases were loading at the same time`
 *   reads the cold open of a use-case dashboard (`dashboard-loading.feature`
 *   has its own world).
 *
 * The wording is the desktop twin's (`usecases/<snake_key>.feature`).
 */
import { createBdd, type DataTable } from 'playwright-bdd';

import { useMobileViewport } from '../../support/dashboard-mobile-helpers';
import {
  addTemplateGlobalFilter,
  addTemplateSelectGlobalFilter,
  addTemplateViews,
  addWidgetWithRowButton,
  closeWidgetPicker,
  expectChartCountsAllRows,
  expectChartShowsNoData,
  expectColdOpenSourceCap,
  expectDashboardRefusedWith,
  expectFeedPosts,
  expectGridRowsStartingWith,
  expectNewWidgetViewHiddenFromTabs,
  expectNoDashboardView,
  expectNoFeedPosts,
  expectPrintedChartValues,
  openTemplateDashboardCold,
  parseFilterMapping,
  provideEmployeesFixtureDatabase,
  putWorkspaceOnFreePlan,
  runBrowserInUtc,
  seedSavedDateGlobalFilter,
  switchGlobalFilterCondition,
  tickRecordCheckbox,
  tryAddingDashboard,
} from '../../support/dashboard-template-4-helpers';
import { splitList, widgetLocator } from '../../support/dashboard-test-helpers';
import { clickChartSegment, expectStackedWidgets, openUseCaseDashboard } from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

/** The features of this set; see the header. */
const SET = { tags: '@dashboard-template-4' };

// ---------------------------------------------------------------------------
// Views (replaces the use-case step in this set)
// ---------------------------------------------------------------------------

Given('{string} has these views:', SET, async ({ page, request }, database: string, table: DataTable) => {
  await addTemplateViews(page, request, database, table.hashes());
});

// ---------------------------------------------------------------------------
// The Free plan
// ---------------------------------------------------------------------------

Given('the workspace is on the Free plan', SET, async ({ page, $testInfo }) => {
  await putWorkspaceOnFreePlan(page, $testInfo);
});

When('I try to add a dashboard to {string} from the view tab menu', SET, async ({ page }, database: string) => {
  await tryAddingDashboard(page, database);
});

Then('I am told that {string}', SET, async ({ page }, message: string) => {
  await expectDashboardRefusedWith(page, message);
});

Then('{string} has no dashboard view', SET, async ({ page }, database: string) => {
  await expectNoDashboardView(page, database);
});

// ---------------------------------------------------------------------------
// Opening a dashboard
// ---------------------------------------------------------------------------

When('I open the {string} dashboard with nothing cached', SET, async ({ page }, name: string) => {
  await openTemplateDashboardCold(page, name);
});

Then('no more than {int} source databases were loading at the same time', SET, async ({ page }, cap: number) => {
  await expectColdOpenSourceCap(page, cap);
});

When(
  'I open the {string} dashboard on a {int} by {int} screen',
  SET,
  async ({ page }, name: string, width: number, height: number) => {
    // Below 768 px the web is a phone: widgets stack, menus and drill-downs open as bottom sheets.
    await openUseCaseDashboard(page, name);
    await useMobileViewport(page, { width, height });
  }
);

Then('I see every widget stacked in a single column', SET, async ({ page }) => {
  await expectStackedWidgets(page);
});

// ---------------------------------------------------------------------------
// Widget content
// ---------------------------------------------------------------------------

Then('the {string} widget shows the posts {string}', SET, async ({ page }, view: string, titles: string) => {
  await expectFeedPosts(page, view, splitList(titles));
});

Then('the {string} widget shows no posts', SET, async ({ page }, view: string) => {
  await expectNoFeedPosts(page, view);
});

Then('the {string} chart shows no data', SET, async ({ page }, view: string) => {
  await expectChartShowsNoData(page, view);
});

/** `| label | value |`: each category as the chart prints it; `day of today - 2` names that day's bucket. */
Then('the {string} chart prints these values:', SET, async ({ page }, view: string, table: DataTable) => {
  await expectPrintedChartValues(page, view, table.hashes());
});

Then('the {string} chart has counted all {int} rows', SET, async ({ page }, view: string, count: number) => {
  await expectChartCountsAllRows(page, view, count);
});

Then(
  'the {string} widget lists {int} rows starting with {string}',
  SET,
  async ({ page }, view: string, count: number, titles: string) => {
    await expectGridRowsStartingWith(page, view, count, splitList(titles));
  }
);

When('I tick the {string} checkbox on the open page', SET, async ({ page }, property: string) => {
  await tickRecordCheckbox(page, property);
});

/** A phone tap: the first shows the slice's tooltip, a second on the same slice opens its rows. */
When('I tap the {string} slice of the {string} chart', SET, async ({ page }, label: string, view: string) => {
  await clickChartSegment(page, widgetLocator(page, view), label);
});

When('I tap the {string} slice of the {string} chart again', SET, async ({ page }, label: string, view: string) => {
  await clickChartSegment(page, widgetLocator(page, view), label);
});

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

When('I add a global filter where {string} is {string}', SET, async ({ page }, property: string, options: string) => {
  await addTemplateSelectGlobalFilter(page, property, options);
});

When(
  'I add a global filter on {string} with the condition {string}',
  SET,
  async ({ page }, property: string, condition: string) => {
    await addTemplateGlobalFilter(page, property, condition);
  }
);

/** `| property | database |`: the property of each other source the filter also narrows. */
When(
  'I add a global filter on {string} with the condition {string}, using:',
  SET,
  async ({ page }, property: string, condition: string, table: DataTable) => {
    await addTemplateGlobalFilter(page, property, condition, '', parseFilterMapping(table.hashes()));
  }
);

When(
  'I add a global filter on {string} with the condition {string} and the value {string}, using:',
  SET,
  async ({ page }, property: string, condition: string, value: string, table: DataTable) => {
    await addTemplateGlobalFilter(page, property, condition, value, parseFilterMapping(table.hashes()));
  }
);

Given(
  'the {string} dashboard has a saved {string} global filter set to {string}, using:',
  SET,
  async ({ page, request }, dashboard: string, property: string, condition: string, table: DataTable) => {
    await seedSavedDateGlobalFilter(page, request, dashboard, property, condition, parseFilterMapping(table.hashes()));
  }
);

When('I switch the {string} global filter to {string}', SET, async ({ page }, name: string, condition: string) => {
  await switchGlobalFilterCondition(page, name, condition);
});

// ---------------------------------------------------------------------------
// Adding a widget
// ---------------------------------------------------------------------------

When('I add a widget with the add button of dashboard row {int}', SET, async ({ page }, row: number) => {
  await addWidgetWithRowButton(page, row);
});

When('I close the {string} picker', SET, async ({ page }, title: string) => {
  if (title !== 'New view') throw new Error(`The add flow docks the "New view" picker, not "${title}"`);
  await closeWidgetPicker(page);
});

Then("the new widget's view is not a tab of {string}", SET, async ({ page }, database: string) => {
  await expectNewWidgetViewHiddenFromTabs(page, database);
});

// ---------------------------------------------------------------------------
// The 5000-employee database
// ---------------------------------------------------------------------------

Given('the browser runs in the UTC time zone', SET, async ({ page }) => {
  await runBrowserInUtc(page);
});

Given(
  'a/an {string} database holding the 5000-employee fixture',
  SET,
  async ({ page, request, $testInfo }, name: string) => {
    await provideEmployeesFixtureDatabase(page, request, name, $testInfo);
  }
);
