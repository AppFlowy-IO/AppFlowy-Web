/**
 * Dashboard multi-source loading (fix pass section 6.2, addendum A9). The
 * wording is shared with the desktop BDD (`dashboard_loading.feature`). The
 * step "I open that dashboard while the employees database loads slowly" is
 * also a step of `dashboard-large-source.feature`, with another world: this
 * definition is scoped to `@dashboard-loading`.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { DASHBOARD_LOADING } from '../../../src/application/database-yjs/dashboard-loading';
import {
  addEightSmallDatabases,
  addThreeSmallDatabasesWithViews,
  adoptEmployeesWorkspace,
  createDashboardOverEightDatabases,
  createDashboardOverEmployeesViews,
  createDashboardOverFourDatabases,
  EMPLOYEES,
  employeesWidgets,
  ensureEmployeesViews,
  expectAtMostTwoSourcesLoading,
  expectBelowFoldDatabasesWaited,
  expectEachSourceOpenedOnce,
  expectFramesBeforeData,
  expectLastRowShowsRows,
  expectLoadingStateShown,
  expectNoEmptyLooks,
  expectNothingStartsAfterLeaving,
  expectRowsLoadedInOnePass,
  expectVisibleWidgetsStartedFirst,
  expectWaitingWidgetsShowLoading,
  expectWidgetsMatchTheirSourceViews,
  expectWidgetsShowRowsWithin,
  leaveBeforeEveryWidgetStarted,
  loadingWidgets,
  openDashboardCold,
  otherVisibleWidgets,
  prepareLoadingWorkspace,
  scrollToLastRow,
  sourceDatabaseNames,
  startLoadRecording,
} from '../../support/dashboard-loading-helpers';
import {
  openSeededEmployeesDatabase,
  resetEmployeesDatabaseSettings,
} from '../../support/employees-database';

const { Given, When, Then } = createBdd();

/** Room for the API fixtures, eight database pages and the source-view comparisons. */
const SMALL_SCENARIO_TIMEOUT_MS = 600_000;
/** Seeding the employees database takes minutes. */
const EMPLOYEES_SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('eight small databases each have a grid view for a dashboard widget', async ({ page, request, $testInfo }) => {
  $testInfo.setTimeout(Math.max($testInfo.timeout, SMALL_SCENARIO_TIMEOUT_MS));
  await prepareLoadingWorkspace(page, request);
  await addEightSmallDatabases(page, request);
});

Given('the employees database is open', async ({ page, request, $testInfo }) => {
  $testInfo.setTimeout(Math.max($testInfo.timeout, EMPLOYEES_SCENARIO_TIMEOUT_MS));
  const seeded = await openSeededEmployeesDatabase(page, request);

  // Earlier scenarios may have filtered or sorted its views.
  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
});

Given('the employees database has {int} views for dashboard widgets', async ({ page, request }, count: number) => {
  expect(count, 'the employees views of the loading design').toBe(12);
  await ensureEmployeesViews(page, request);
});

Given('three small databases each have {int} views for dashboard widgets', async ({ page, request }, count: number) => {
  expect(count, 'the small-database views of the loading design').toBe(3);
  await addThreeSmallDatabasesWithViews(page, request);
});

Given(
  'a new database has a dashboard with {int} widgets over the {int} databases in {int} rows of {int}',
  async ({ page, request }, widgets: number, databases: number, rows: number, perRow: number) => {
    expect([widgets, databases, rows, perRow], 'the eight-database dashboard').toEqual([8, 8, 2, 4]);
    await createDashboardOverEightDatabases(page, request);
  }
);

Given(
  'a new database has a dashboard with {int} widgets showing the employees views',
  async ({ page, request }, widgets: number) => {
    expect(widgets, 'the employees dashboard').toBe(12);
    await createDashboardOverEmployeesViews(page, request);
  }
);

Given(
  'a new database has a dashboard with {int} widgets over {int} databases in {int} rows of {int}',
  async ({ page, request }, widgets: number, databases: number, rows: number, perRow: number) => {
    expect([widgets, databases, rows, perRow], 'the four-database dashboard').toEqual([12, 4, 4, 3]);
    await createDashboardOverFourDatabases(page, request);
  }
);

Given('dashboard load counters are being recorded', async ({ page }) => {
  await startLoadRecording(page);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('I open that dashboard with nothing cached', async ({ page }) => {
  await openDashboardCold(page);
});

When(
  'I open that dashboard while the employees database loads slowly',
  { tags: '@dashboard-loading' },
  async ({ page }) => {
    await openDashboardCold(page, [EMPLOYEES]);
  }
);

When('I open that dashboard while every source database loads slowly', async ({ page }) => {
  await openDashboardCold(page, sourceDatabaseNames(page));
});

When('I scroll to the last dashboard row', async ({ page }) => {
  await scrollToLastRow(page);
});

When('I leave the dashboard before every widget has started', async ({ page }) => {
  await leaveBeforeEveryWidgetStarted(page);
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('every widget frame was shown before any row data arrived', async ({ page }) => {
  await expectFramesBeforeData(page);
});

Then('no more than {int} source databases were loading at the same time', async ({ page }, cap: number) => {
  expect(cap, 'tokens.json loading.maxConcurrentSources').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  await expectAtMostTwoSourcesLoading(page);
});

Then('every widget waiting for a source showed a loading state that was not empty', async ({ page }) => {
  await expectWaitingWidgetsShowLoading(page, loadingWidgets(page));
});

Then('every source database was opened once', async ({ page }) => {
  await expectEachSourceOpenedOnce(page);
});

Then('every widget shows the same result as its source view', async ({ page }) => {
  await expectWidgetsMatchTheirSourceViews(page, loadingWidgets(page));
});

Then('the employees database was opened once', async ({ page }) => {
  await expectEachSourceOpenedOnce(page, [EMPLOYEES]);
});

Then('the employees rows were loaded in one pass', async ({ page }) => {
  await expectRowsLoadedInOnePass(page, EMPLOYEES);
});

Then('no widget looked empty while it loaded', async ({ page }) => {
  await expectNoEmptyLooks(page, loadingWidgets(page));
});

Then('every visible widget started loading before any widget below the fold', async ({ page }) => {
  await expectVisibleWidgetsStartedFirst(page);
});

Then('no database used only below the fold was opened before the visible widgets showed data', async ({ page }) => {
  await expectBelowFoldDatabasesWaited(page);
});

Then('every widget in the last row shows its rows', async ({ page }) => {
  await expectLastRowShowsRows(page);
});

Then('every widget in the last row shows its rows within {int} seconds', async ({ page }, seconds: number) => {
  await expectLastRowShowsRows(page, seconds * 1000);
});

Then(
  'every visible widget of the other databases shows its rows within {int} seconds',
  async ({ page }, seconds: number) => {
    await expectWidgetsShowRowsWithin(page, otherVisibleWidgets(page), seconds * 1000);
  }
);

Then('the employees widgets show a loading state that is not empty', async ({ page }) => {
  await expectLoadingStateShown(page, employeesWidgets(page));
});

Then('the employees widgets end with the same result as their source views', async ({ page }) => {
  await expectWidgetsMatchTheirSourceViews(page, employeesWidgets(page));
});

Then('no source database starts loading after I left', async ({ page }) => {
  await expectNothingStartsAfterLeaving(page);
});
