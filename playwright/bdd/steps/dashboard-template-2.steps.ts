/**
 * Steps of the second set of dashboard template scenarios
 * (`dashboard-usecases/content-calendar.feature`, `product-roadmap.feature`,
 * `agency-hub.feature` and `inventory-reorder.feature`). Everything else the
 * templates say is a shared use-case or dashboard step.
 *
 * Every definition here is scoped to the set's tag, `@dashboard-template-2`
 * (each template also has its own tag, `@content-calendar`, …). A scoped
 * definition wins over an unscoped one of the same text (playwright-bdd), so
 * five of them extend shared steps for these templates only, the way
 * `dashboard-loading.steps.ts` scopes its own world; the other template sets
 * scope theirs to their own tags:
 *
 * - "a/an {string} database with these properties:", "{string} has these
 *   rows:" and "{string} has these views:" also seed URL, Checklist, Person,
 *   Relation, Rollup, Formula, Created by and Last edited by properties, a
 *   Number currency, and min / max / average / median / count-values
 *   calculations, date grouping and Number, Checkbox and Checklist filters
 *   (a superset of the use-case tables);
 * - "the {string} chart shows these values:" also reads line charts, and
 *   resolves date labels written relative to today ("week of today + 7");
 * - "I change the {string} of {string} to {string} in the {string} widget"
 *   also sets Person cells;
 * - "no more than {int} source databases were loading at the same time"
 *   checks a use-case dashboard (the loading feature builds its own world).
 */
import { expect } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import {
  addListRowAsTeammate,
  addSourceToOpenGlobalFilter,
  addTemplateDatabase,
  addTemplateGlobalFilter,
  addTemplateRows,
  addTemplateViews,
  changeWidgetCell,
  chartFieldNames,
  deleteNamedWidget,
  dragCalendarEvent,
  dragTimelineBar,
  duplicateDashboardTab,
  editOpenGridCell,
  expectCalendarEvent,
  expectChartPeopleValues,
  expectChartValues,
  expectFilterMenuOmits,
  expectNoCalendarEvent,
  expectPersistedDay,
  expectPickerOmits,
  expectTemplateSourceLoadCap,
  giveOwnOptionIds,
  inviteEditingTeammate,
  openCalendarEvent,
  openTemplateDashboardCold,
  renameActiveDashboardTab,
  resolveChartLabel,
  turnViewIntoDashboard,
} from '../../support/dashboard-template-2-helpers';
import { splitList, widgetLocator } from '../../support/dashboard-test-helpers';
import { chartNumber, relativeDayOffset, USE_CASE_TIMEOUT } from '../../support/dashboard-usecase-helpers';

/** The templates of this set: every step below applies to their scenarios only. */
const { Given, When, Then } = createBdd(undefined, { tags: '@dashboard-template-2' });

const WAIT = { timeout: USE_CASE_TIMEOUT };

function hashes(table: DataTable): Record<string, string>[] {
  return table.hashes();
}

// ---------------------------------------------------------------------------
// Seeding (extends the use-case tables)
// ---------------------------------------------------------------------------

Given('a/an {string} database with these properties:', async ({ page, request }, name: string, table: DataTable) => {
  await addTemplateDatabase(page, request, name, hashes(table));
});

Given('{string} has these rows:', async ({ page, request }, database: string, table: DataTable) => {
  await addTemplateRows(page, request, database, hashes(table));
});

Given('{string} has these views:', async ({ page, request }, database: string, table: DataTable) => {
  await addTemplateViews(page, request, database, hashes(table));
});

Given('a teammate who can edit the {string} space', async ({ page, request }, space: string) => {
  await inviteEditingTeammate(page, request, space);
});

Given('the {string} select options have their own ids', async ({ page, request }, database: string) => {
  await giveOwnOptionIds(page, request, database);
});

// ---------------------------------------------------------------------------
// Calendar widgets
// ---------------------------------------------------------------------------

Then('the {string} widget shows {string} on {string}', async ({ page }, view: string, title: string, day: string) => {
  await expectCalendarEvent(page, view, title, day);
});

Then('the {string} widget shows nothing on {string}', async ({ page }, view: string, day: string) => {
  await expectNoCalendarEvent(page, view, day);
});

When(
  'I drag the {string} event to {string} in the {string} widget',
  async ({ page }, title: string, day: string, view: string) => {
    await dragCalendarEvent(page, view, title, relativeDayOffset(day));
  }
);

When('I open the {string} event from the {string} widget', async ({ page }, title: string, view: string) => {
  await openCalendarEvent(page, view, title);
});

Then(
  'the {string} date of {string} in {string} is {string}',
  async ({ page, request }, property: string, title: string, database: string, day: string) => {
    await expectPersistedDay(page, request, database, title, property, day);
  }
);

// ---------------------------------------------------------------------------
// Timeline widgets
// ---------------------------------------------------------------------------

When(
  'I drag the {string} bar {int} days later in the {string} widget',
  async ({ page }, title: string, days: number, view: string) => {
    await dragTimelineBar(page, view, title, days);
  }
);

Then('the {string} timeline shows no bars', async ({ page }, view: string) => {
  const widget = widgetLocator(page, view);

  await expect(widget.getByTestId('timeline-view')).toBeVisible(WAIT);
  await expect(widget.locator('[data-testid^="timeline-bar-"]')).toHaveCount(0, WAIT);
});

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

Then('the {string} chart shows these values:', async ({ page }, view: string, table: DataTable) => {
  await expectChartValues(
    page,
    view,
    Object.fromEntries(hashes(table).map((row) => [resolveChartLabel(row.label), chartNumber(row.value)]))
  );
});

Then(
  'the {string} chart shows {int} for me and {int} for the teammate',
  async ({ page, request }, view: string, mine: number, theirs: number) => {
    await expectChartPeopleValues(page, request, view, { me: mine, 'the teammate': theirs });
  }
);

/** The open "What to show" page lists exactly these properties (in any order) and none of the others. */
Then('the chart fields offer {string} but not {string}', async ({ page }, offered: string, missing: string) => {
  await expect.poll(async () => (await chartFieldNames(page)).sort(), WAIT).toEqual(splitList(offered).sort());
  const names = await chartFieldNames(page);

  for (const name of splitList(missing)) expect(names).not.toContain(name);
});

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

When(
  'I add a global filter on {string} with the condition {string} and the value {string}',
  async ({ page, request }, property: string, condition: string, value: string) => {
    await addTemplateGlobalFilter(page, request, property, condition, value);
  }
);

When(
  'I add a global filter on {string} with the condition {string} and the value {string}, using:',
  async ({ page, request }, property: string, condition: string, value: string, table: DataTable) => {
    const overrides = Object.fromEntries(hashes(table).map((row) => [row.database.trim(), row.property.trim()]));

    await addTemplateGlobalFilter(page, request, property, condition, value, overrides);
  }
);

Then('the filter menu does not list {string} in {string}', async ({ page }, property: string, database: string) => {
  await expectFilterMenuOmits(page, property, database);
});

When(
  'I add the {string} property of {string} to the open global filter',
  async ({ page }, property: string, database: string) => {
    await addSourceToOpenGlobalFilter(page, property, database);
  }
);

// ---------------------------------------------------------------------------
// Widgets, the picker and dashboard tabs
// ---------------------------------------------------------------------------

When(
  'I change the {string} of {string} to {string} in the {string} widget',
  async ({ page, request }, property: string, title: string, value: string, view: string) => {
    await changeWidgetCell(page, request, view, title, property, value);
  }
);

When(
  'I change the {string} of {string} to {string} in the open grid',
  async ({ page }, property: string, title: string, value: string) => {
    await editOpenGridCell(page, property, title, value);
  }
);

When('the teammate adds a row named {string} in the {string} widget', async ({ page }, title: string, view: string) => {
  await addListRowAsTeammate(page, view, title);
});

Then('the widget picker does not offer the {string} view', async ({ page }, name: string) => {
  await expectPickerOmits(page, name);
});

When('I turn the {string} view into a dashboard', async ({ page }, name: string) => {
  await turnViewIntoDashboard(page, name);
});

When('I delete the {string} widget', async ({ page }, view: string) => {
  await deleteNamedWidget(page, view);
});

When('I duplicate the {string} dashboard tab', async ({ page }, name: string) => {
  await duplicateDashboardTab(page, name);
});

When('I rename the dashboard tab to {string}', async ({ page }, name: string) => {
  await renameActiveDashboardTab(page, name);
});

// ---------------------------------------------------------------------------
// Cold loading (addendum A9)
// ---------------------------------------------------------------------------

When('I open the {string} dashboard with nothing cached', async ({ page }, name: string) => {
  await openTemplateDashboardCold(page, name);
});

Then('no more than {int} source databases were loading at the same time', async ({ page }, cap: number) => {
  await expectTemplateSourceLoadCap(page, cap);
});
