/**
 * Steps of the dashboard template scenarios of set 1
 * (`dashboard-usecases/saas-growth`, `support-desk`, `marketing-budget` and
 * `recruiting-pipeline`), on top of the use-case, dashboard, chart,
 * drill-down and private-conditions steps they reuse as they are.
 *
 * Every definition here is scoped to `@dashboard-template-1`, the tag of
 * those four features. Six of them have the words of a shared step and
 * replace it there (playwright-bdd prefers a tagged definition), so the
 * features read like the rest of the use-case suite:
 *
 * - `a/an "…" database with these properties:` also creates Multi-select,
 *   Created time and Last edited time properties, and its options column
 *   names a Number property's format (US dollar, Euro, Percent);
 * - `"…" has these views:` reads a wider settings language
 *   (`parseTemplateView` in `dashboard-template-1-helpers.ts`): every
 *   calculation of the Calculate menu, date grouping, Cumulative, a custom
 *   Number title, and checkbox, text, number and multi-select filters;
 * - `the "…" chart shows these values:` reads line charts too, and resolves
 *   date bucket labels relative to today ("week of today - 14");
 * - `I change the "…" of "…" to "…" in the "…" widget` and
 *   `the "…" of "…" in "…" is "…"` also take "checked" / "unchecked" for a
 *   checkbox;
 * - `I add a "…" is "…" filter inside the "…" widget` also works on a widget
 *   whose view already has filters (the Filter tool then opens the widget's
 *   Filters popover, whose "Add filter" lists the properties).
 *
 * Their desktop ports belong under
 * `integration_test/desktop/bdd/database/dashboard/usecases/`, with the same
 * scenarios in the desktop step wording.
 */
import { createBdd, type DataTable } from 'playwright-bdd';

import {
  addTemplateDatabase,
  addTemplateGlobalFilter,
  addTemplateViews,
  addWidgetContainsFilter,
  addWidgetSelectFilter,
  addWidgetUncheckedFilter,
  clickLinePoint,
  clickTeammateFilterBar,
  deleteWidgetRow,
  editTemplateCell,
  expectDonutTotalText,
  expectNumberNotTruncated,
  expectTeammateCanEdit,
  expectTeammateFilterBar,
  expectTemplateChartValues,
  expectTemplatePersistedCell,
  globalFilterOverrides,
  inviteEditingTeammate,
  teammateEntersEditMode,
  teammateLeavesEditMode,
  teammateResizesWidget,
  turnOffChartSetting,
} from '../../support/dashboard-template-1-helpers';
import { memberPage } from '../../support/dashboard-test-helpers';
import { addSelectGlobalFilter } from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

/** The features of this set; see the header. */
const SET = { tags: '@dashboard-template-1' };

// ---------------------------------------------------------------------------
// Seeding (replaces the use-case steps in this set)
// ---------------------------------------------------------------------------

/** `| property | type | options |`: select options, or a Number property's format. */
Given(
  'a/an {string} database with these properties:',
  SET,
  async ({ page, request }, name: string, table: DataTable) => {
    await addTemplateDatabase(page, request, name, table.hashes());
  }
);

/** `| view | layout | settings |` in the wider settings language (see the header). */
Given('{string} has these views:', SET, async ({ page, request }, database: string, table: DataTable) => {
  await addTemplateViews(page, request, database, table.hashes());
});

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** Bar and line charts; labels may name a bucket relative to today ("week of today - 14", "month of today + 35"). */
Then('the {string} chart shows these values:', SET, async ({ page }, view: string, table: DataTable) => {
  await expectTemplateChartValues(page, view, table.hashes());
});

When('I click the {string} point of the {string} chart', SET, async ({ page }, label: string, view: string) => {
  await clickLinePoint(page, view, label);
});

/** The centre as printed: the Y property's currency, compact from 10,000 on ("€60.8K"). */
Then('the {string} chart total reads {string}', SET, async ({ page }, view: string, text: string) => {
  await expectDonutTotalText(page, view, text);
});

Then('the number of the {string} widget is not truncated', SET, async ({ page }, view: string) => {
  await expectNumberNotTruncated(page, view);
});

/** A switch row of the open chart settings panel ("Cumulative", "Show empty values"). */
When('I turn off {string} in the chart settings', SET, async ({ page }, label: string) => {
  await turnOffChartSetting(page, label);
});

// ---------------------------------------------------------------------------
// Widget content
// ---------------------------------------------------------------------------

When(
  'I change the {string} of {string} to {string} in the {string} widget',
  SET,
  async ({ page }, property: string, title: string, value: string, view: string) => {
    await editTemplateCell(page, view, title, property, value);
  }
);

Then(
  'the {string} of {string} in {string} is {string}',
  SET,
  async ({ page, request }, property: string, title: string, database: string, value: string) => {
    await expectTemplatePersistedCell(page, request, database, title, property, value);
  }
);

When('I delete the {string} row from the {string} widget', SET, async ({ page }, title: string, view: string) => {
  await deleteWidgetRow(page, view, title);
});

// ---------------------------------------------------------------------------
// Widget filters (private in View mode, saved to the view in Edit mode)
// ---------------------------------------------------------------------------

When(
  'I add a {string} is {string} filter inside the {string} widget',
  SET,
  async ({ page }, property: string, option: string, view: string) => {
    await addWidgetSelectFilter(page, view, property, option);
  }
);

When(
  'I add a {string} is unchecked filter inside the {string} widget',
  SET,
  async ({ page }, property: string, view: string) => {
    await addWidgetUncheckedFilter(page, view, property);
  }
);

When(
  'I add a {string} contains {string} filter inside the {string} widget',
  SET,
  async ({ page }, property: string, text: string, view: string) => {
    await addWidgetContainsFilter(page, view, property, text);
  }
);

// ---------------------------------------------------------------------------
// Global filters of any property type
// ---------------------------------------------------------------------------

/** The value its type takes: option names, a number, a day, "today - 21 to today - 14", or "" ("Is checked", "Last week"). */
When(
  'I add a global filter on {string} with the condition {string} and the value {string}',
  SET,
  async ({ page }, property: string, condition: string, value: string) => {
    await addTemplateGlobalFilter(page, property, condition, value);
  }
);

/** `| property | database |`: the property each other dashboard source maps. */
When(
  'I add a global filter on {string} with the condition {string} and the value {string}, using:',
  SET,
  async ({ page }, property: string, condition: string, value: string, table: DataTable) => {
    await addTemplateGlobalFilter(page, property, condition, value, globalFilterOverrides(table.hashes()));
  }
);

// ---------------------------------------------------------------------------
// A teammate who can edit the space
// ---------------------------------------------------------------------------

Given('a teammate who can edit the {string} space', SET, async ({ page, request }, space: string) => {
  await inviteEditingTeammate(page, request, space);
});

Then('the teammate sees the dashboard in View mode with an Edit button', SET, async ({ page }) => {
  await expectTeammateCanEdit(page);
});

/** In View mode the value stays the teammate's own until they save it for everyone (WP07). */
When(
  'the teammate adds a global filter where {string} is {string}',
  SET,
  async ({ page }, property: string, options: string) => {
    await addSelectGlobalFilter(memberPage(page), page, property, options);
  }
);

Then(
  'the teammate sees {string} and {string} in the filter bar',
  SET,
  async ({ page }, first: string, second: string) => {
    await expectTeammateFilterBar(page, first, second);
  }
);

When('the teammate clicks {string} in the filter bar', SET, async ({ page }, label: string) => {
  await clickTeammateFilterBar(page, label);
});

When('the teammate switches the dashboard to Edit mode', SET, async ({ page }) => {
  await teammateEntersEditMode(page);
});

When('the teammate resizes {string} to {int} columns', SET, async ({ page }, view: string, columns: number) => {
  await teammateResizesWidget(page, view, columns);
});

When('the teammate finishes editing the dashboard', SET, async ({ page }) => {
  await teammateLeavesEditMode(page);
});
