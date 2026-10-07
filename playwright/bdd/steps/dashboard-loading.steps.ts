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
  changeFirstEmployeeDepartment,
  createEmployeesListGalleryDashboard,
  createSmallBindingBudgetDashboard,
  ensureEmployeesListGallery,
  expectBelowFoldWaitedForDataOrTimeout,
  expectDepartmentChartEdit,
  expectEmployeesReadBudget,
  expectOtherChartsUnchanged,
  expectRowsBoundBudget,
  expectVisibleDataWithin,
  expectVisibleRowRequestsOnly,
  snapshotMountedBudgetRows,
  startBudgetRecording,
} from '../../support/dashboard-loading-budget-helpers';
import {
  addSmallSourceDatabases,
  addThreeSmallDatabasesWithTwoViews,
  addThreeSmallDatabasesWithViews,
  adoptEmployeesWorkspace,
  createDashboardOverDatabasePairs,
  createDashboardOverEmployeesViews,
  createDashboardOverFourDatabases,
  createDashboardOverSourceDatabases,
  createDashboardInsideEmployees,
  createDashboardOfViews,
  EMPLOYEES,
  employeesWidgets,
  ensureEmployeesViews,
  expectAtMostTwoSourcesLoading,
  expectBelowFoldDatabasesWaited,
  expectBelowFoldStartedBeforeFirstSourceData,
  expectEachSourceOpenedOnce,
  expectEveryWidgetDataWithin,
  expectFramesBeforeData,
  expectLastRowShowsRows,
  expectLastRowStartedBeforeNeverScrolled,
  expectLastRowVisibleAtStart,
  expectLoadingStateShown,
  expectNoBelowFoldStartWithin,
  expectNoEmptyLooks,
  expectNoErrorOrEmptyWhileWaiting,
  expectNoSourceLoadedAgain,
  expectNoStartWithinAfterLeaving,
  expectNothingStartsAfterLeaving,
  expectNoWidgetSessionLeftOpen,
  expectNoWidgetWaited,
  expectOthersWaitForSlowSources,
  expectPeakOfTwoSources,
  expectRemovedSourceNeverOpened,
  expectRowsLoadedInOnePass,
  expectRowsOfEverySourceLoadedInOnePass,
  expectSharedSourceWidgetsStartedTogether,
  expectStartedSourcesStopLoading,
  expectVisibleWidgetsStartedFirst,
  expectWaitersSeenWaiting,
  expectWaitingWidgetsShowLoading,
  expectWidgetsMatchTheirSourceViews,
  expectWidgetsShowRowsWithin,
  firstSourceDatabases,
  leaveAndReturnInApp,
  leaveForDocumentAndReturn,
  leaveBeforeEveryWidgetStarted,
  loadingWidgets,
  openDashboardAsReadOnlyMember,
  openDashboardCold,
  openDashboardUntilLoaded,
  otherVisibleWidgets,
  prepareLoadingWorkspace,
  removeLastWidgetBeforeStart,
  scrollToLastRow,
  scrollToLastRowBeforeVisibleData,
  sourceDatabaseNames,
  startLoadRecording,
  slowDownSources,
} from '../../support/dashboard-loading-helpers';
import { performanceOpenAction } from '../../support/dashboard-performance-helpers';
import { openSeededEmployeesDatabase, resetEmployeesDatabaseSettings } from '../../support/employees-database';

const { Given, When, Then } = createBdd();

/** Room for the API fixtures, eight database pages and the source-view comparisons. */
const SMALL_SCENARIO_TIMEOUT_MS = 600_000;
/** Seeding the employees database takes minutes. */
const EMPLOYEES_SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

/** The small-database worlds by their count word. */
const SMALL_DATABASE_COUNTS: Record<string, number> = { four: 4, eight: 8, twelve: 12 };

Given(
  '{word} small databases each have a grid view for a dashboard widget',
  async ({ page, request, $testInfo }, countWord: string) => {
    const count = SMALL_DATABASE_COUNTS[countWord];

    expect(count, `a world of "${countWord}" small databases`).toBeDefined();
    $testInfo.setTimeout(Math.max($testInfo.timeout, SMALL_SCENARIO_TIMEOUT_MS));
    await prepareLoadingWorkspace(page, request);
    await addSmallSourceDatabases(page, request, count);
  }
);

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

Given(
  'three small databases each have {int} views for dashboard widgets',
  async ({ page, request, $testInfo }, count: number) => {
    expect([1, 2, 3], 'the small-database views of the loading designs').toContain(count);
    $testInfo.setTimeout(Math.max($testInfo.timeout, SMALL_SCENARIO_TIMEOUT_MS));
    if (count === 1) {
      await createSmallBindingBudgetDashboard(page, request);
      return;
    }

    if (count === 3) {
      await addThreeSmallDatabasesWithViews(page, request);
      return;
    }

    $testInfo.setTimeout(Math.max($testInfo.timeout, SMALL_SCENARIO_TIMEOUT_MS));
    await prepareLoadingWorkspace(page, request);
    await addThreeSmallDatabasesWithTwoViews(page, request);
  }
);

/** The dashboards over one widget per small source database: [widgets, databases, rows, per row]. */
const SOURCE_DASHBOARDS = ['4,4,1,4', '8,8,2,4', '8,8,8,1', '12,12,3,4'];

Given(
  'a new database has a dashboard with {int} widgets over the {int} databases in {int} row(s) of {int}',
  async ({ page, request }, widgets: number, databases: number, rows: number, perRow: number) => {
    expect(SOURCE_DASHBOARDS, 'a dashboard over the small source databases').toContain(
      [widgets, databases, rows, perRow].join(',')
    );
    await createDashboardOverSourceDatabases(page, request, widgets, perRow);
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
  'a new database has a dashboard with {int} widgets over {int} databases in {int} row(s) of {int}',
  async ({ page, request }, widgets: number, databases: number, rows: number, perRow: number) => {
    const shape = [widgets, databases, rows, perRow].join(',');

    expect(['12,4,4,3', '6,3,3,2', '3,3,1,3'], 'the loading dashboard layout').toContain(shape);
    if (shape === '3,3,1,3') await createDashboardOfViews(page, request, [['Small300 Grid', 'Small60 Grid', 'Small20 Grid']]);
    else if (shape === '6,3,3,2') await createDashboardOverDatabasePairs(page, request);
    else await createDashboardOverFourDatabases(page, request);
  }
);

Given('dashboard load counters are being recorded', async ({ page }) => {
  await startLoadRecording(page);
  await startBudgetRecording(page);
});

Given('I opened that dashboard and it finished loading', async ({ page }) => {
  await openDashboardUntilLoaded(page);
});

Given('a read-only member opens that dashboard with nothing cached', async ({ page, request }) => {
  await openDashboardAsReadOnlyMember(page, request);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('I open that dashboard with nothing cached', async ({ page }) => {
  await performanceOpenAction(page, () => openDashboardCold(page));
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

When('I open that dashboard while the first {int} source databases load slowly', async ({ page }, count: number) => {
  expect(count, 'the slow databases hold every load slot').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  await openDashboardCold(page, firstSourceDatabases(page, count));
});

When(
  'I open that dashboard while the first source database loads with a delay of {int} seconds',
  async ({ page }, seconds: number) => {
    expect(seconds * 1000, 'the delay outlasts the deferral').toBeGreaterThan(DASHBOARD_LOADING.deferredStartTimeoutMs);
    await openDashboardCold(page, { [firstSourceDatabases(page, 1)[0]]: seconds * 1000 });
  }
);

When('I open another page and return to the dashboard within {int} seconds', async ({ page, request }, seconds: number) => {
  const awayMs = await performanceOpenAction(page, () => leaveForDocumentAndReturn(page, request));

  expect(awayMs, 'ms the dashboard was gone').toBeLessThanOrEqual(seconds * 1000);
  expect(seconds * 1000, 'the return comes before the idle release').toBeLessThan(DASHBOARD_LOADING.sourceIdleReleaseMs);
});

When('I scroll to the last dashboard row before the visible widgets show data', async ({ page }) => {
  await scrollToLastRowBeforeVisibleData(page);
});

When('I remove the last widget before it has started', async ({ page }) => {
  await removeLastWidgetBeforeStart(page);
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
  await expectWidgetsMatchTheirSourceViews(page, loadingWidgets(page), () => snapshotMountedBudgetRows(page));
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

Then('{int} source databases were loading at the same time at the peak', async ({ page }, peak: number) => {
  expect(peak, 'tokens.json loading.maxConcurrentSources').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  await expectPeakOfTwoSources(page);
});

Then('every widget that waited for a source was seen waiting with its header and a loading state', async ({ page }) => {
  await expectWaitersSeenWaiting(page);
});

Then('both widgets of each loading database started together', async ({ page }) => {
  await expectSharedSourceWidgetsStartedTogether(page);
});

Then('the rows of every source database were loaded in one pass', async ({ page }) => {
  await expectRowsOfEverySourceLoadedInOnePass(page);
});

Then('no widget waited for a source', async ({ page }) => {
  await expectNoWidgetWaited(page);
});

Then('no source database was opened or loaded again', async ({ page }) => {
  await expectNoSourceLoadedAgain(page);
});

Then('every widget shows its data within {int} seconds', async ({ page }, seconds: number) => {
  await expectEveryWidgetDataWithin(page, seconds * 1000);
});

Then('no source database starts loading within {int} seconds after I left', async ({ page }, seconds: number) => {
  await expectNoStartWithinAfterLeaving(page, seconds * 1000);
});

Then('the source databases that were loading stop loading rows after I left', async ({ page }) => {
  await expectStartedSourcesStopLoading(page);
});

Then('no dashboard widget session is left open', async ({ page }) => {
  await expectNoWidgetSessionLeftOpen(page);
});

Then('the widgets of the other databases show a loading state until a slow database finishes', async ({ page }) => {
  await expectOthersWaitForSlowSources(page);
});

Then('no widget shows an error or an empty state while it waits', async ({ page }) => {
  await expectNoErrorOrEmptyWhileWaiting(page);
});

Then(
  'the widget in the last row started loading before every widget that was never scrolled into view',
  async ({ page }) => {
    await expectLastRowStartedBeforeNeverScrolled(page);
  }
);

Then('the widget in the last row was visible when it started', async ({ page }) => {
  await expectLastRowVisibleAtStart(page);
});

Then('no widget below the fold started in the first {int} seconds', async ({ page }, seconds: number) => {
  await expectNoBelowFoldStartWithin(page, seconds);
});

Then('a widget below the fold started before the first source database showed data', async ({ page }) => {
  await expectBelowFoldStartedBeforeFirstSourceData(page);
});

Then('the database of the removed widget was never opened', async ({ page }) => {
  await expectRemovedSourceNeverOpened(page);
});

Then('every remaining widget shows the same result as its source view', async ({ page }) => {
  await expectWidgetsMatchTheirSourceViews(page, loadingWidgets(page));
});

Given(
  'the employees database has a dashboard with {int} widgets showing its views in {int} rows of {int}',
  async ({ page, request }, widgets: number, rows: number, perRow: number) => {
    expect([widgets, rows, perRow]).toEqual([12, 4, 3]);
    await createDashboardInsideEmployees(page, request);
  }
);

Given('the employees database has a list view and a gallery view for dashboard widgets', async ({ page, request }) => {
  await ensureEmployeesListGallery(page, request);
});

Given(
  'a new database has a dashboard with the employees list and gallery views in {int} row of {int}',
  async ({ page, request }, rows: number, perRow: number) => {
    expect([rows, perRow]).toEqual([1, 2]);
    await createEmployeesListGalleryDashboard(page, request);
  }
);

When(
  'I open another page and return to the dashboard within {int} seconds while the employees database loads with a delay of {int} seconds',
  async ({ page, request }, within: number, delay: number) => {
    await slowDownSources(page, { [EMPLOYEES]: delay * 1000 });
    expect(await leaveForDocumentAndReturn(page, request)).toBeLessThanOrEqual(within * 1000);
  }
);

When('I open the Grid tab of the employees database and return to the dashboard tab', async ({ page }) => {
  await performanceOpenAction(page, () => leaveAndReturnInApp(page));
});

Given('I changed the Department of the first employee in the plain grid widget', async ({ page }) => {
  await changeFirstEmployeeDepartment(page);
});

When('I change the Department of the first employee in the plain grid widget', async ({ page }) => {
  await changeFirstEmployeeDepartment(page);
});

Then('every widget below the fold waited for the visible widgets to show data or for {int} seconds', async ({ page }, seconds: number) => {
  await expectBelowFoldWaitedForDataOrTimeout(page, seconds);
});

Then('every visible widget shows its data within {int} seconds', async ({ page }, seconds: number) => {
  await expectVisibleDataWithin(page, seconds);
});

Then('the employees rows were read from storage at most once', async ({ page }) => {
  await expectEmployeesReadBudget(page, 'once');
});

Then('the employees rows were not read from storage again', async ({ page }) => {
  await expectEmployeesReadBudget(page, 'none');
});

Then('each Department chart shows the change and changed exactly once', async ({ page }) => {
  expectDepartmentChartEdit(page);
});

Then('the other charts and number cards did not change', async ({ page }) => {
  expectOtherChartsUnchanged(page);
});

Then('each widget asked for per-row data only for the rows it showed', async ({ page }) => {
  await expectVisibleRowRequestsOnly(page);
});

Then('no source database bound more than {int} rows', async ({ page }, maximum: number) => {
  await expectRowsBoundBudget(page, maximum);
});
