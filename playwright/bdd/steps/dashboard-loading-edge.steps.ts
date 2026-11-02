/**
 * The edges of dashboard loading (`dashboard-loading-edge.feature`): sources
 * that fail, cannot be reached, cannot be opened or never answer; rows read
 * in pages; charts, boards, calendars and timelines while their rows load;
 * rows a collaborator adds meanwhile; the version history preview; what
 * leaving keeps; the idle release; a phone. The wording is shared with the
 * desktop BDD (`dashboard_loading_edge.feature`).
 *
 * The worlds and the cap checks are the steps of `dashboard-loading.steps.ts`.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { DASHBOARD_LOADING } from '../../../src/application/database-yjs/dashboard-loading';
import { firstSourceDatabases, expectWidgetsMatchTheirSourceViews } from '../../support/dashboard-loading-helpers';
import {
  addDatedDatabaseWithViews,
  addPagedDatabase,
  addPagedNumberAndBarChart,
  addPagedZeroPointsGrid,
  addRowBeforeStart,
  addRowWhileLoading,
  createDashboardOfRememberedViews,
  expectCollaboratorRowsShown,
  expectEveryRowShown,
  expectEverySourceTookASlot,
  expectFilterMenuListsEverySource,
  expectHistoryPlaceholderWithoutWidgets,
  expectLoadingNeverEmpty,
  expectLoadingRowCounts,
  expectLoadingRowGrowsToTotal,
  expectNoEmptyStateSoFar,
  expectNoLoadingRowAfterLastRow,
  expectNoNoDataBeforeComplete,
  expectNoNoRowsResult,
  expectNoSourceRequestDuringPreview,
  expectNotStartedBeforeLoadTimeout,
  expectOnlyLoadingOrFinal,
  expectPlaceholder,
  expectRowsAfterLoadTimeout,
  expectRowsNotLoadedMessage,
  expectStackedOnePerLine,
  expectWeightWithin,
  expectWidgetsShowRows,
  failRowsOf,
  makeSilent,
  makeUnreachable,
  moveToOwnerOnlySpace,
  openFilterMenuBeforeEveryWidgetStarted,
  openOnPhoneWhileSlow,
  openWithSlowPages,
  PAGED,
  pagedRowCount,
  previewDashboardInHistory,
  rememberFirstVisitWeight,
  rememberViews,
  repairSource,
  retryWidget,
  returnToDashboardWhileSlow,
  ROWS_NOT_LOADED_TEXT,
  saveHostVersion,
  sourceAt,
  stayAwayUntilIdleRelease,
  trashSourceOf,
  visitDashboardAndLeave,
  widgetAt,
  widgetLabeled,
} from '../../support/dashboard-loading-edge-helpers';

const { Given, When, Then } = createBdd();

/** Room for the API fixtures, the timeouts the scenarios wait out and the source-view comparisons. */
const EDGE_SCENARIO_TIMEOUT_MS = 600_000;

/** A widget or source database by its place: "first" … "fourth", "last". */
const ORDINAL = '(first|second|third|fourth|last)';
/** Several places: "third and fourth", "second, third and fourth". */
const ORDINALS = `((?:${ORDINAL.slice(1, -1)})(?:(?:, | and )(?:${ORDINAL.slice(1, -1)}))*)`;

function ordinalsOf(list: string): string[] {
  return list.split(/, | and /);
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given(new RegExp(`^the view of the ${ORDINAL} widget is in the trash$`), async ({ page, request }, ordinal: string) => {
  await trashSourceOf(page, request, widgetAt(page, ordinal));
});

Given(
  new RegExp(`^the rows of the ${ORDINAL} source database fail to load$`),
  async ({ page, request }, ordinal: string) => {
    await failRowsOf(page, request, sourceAt(page, ordinal));
  }
);

Given(new RegExp(`^the ${ORDINAL} source database cannot be reached$`), async ({ page }, ordinal: string) => {
  await makeUnreachable(page, [sourceAt(page, ordinal)]);
});

Given(
  new RegExp(`^the ${ORDINAL} source database is in a space only its owner can open$`),
  async ({ page, request }, ordinal: string) => {
    await moveToOwnerOnlySpace(page, request, [sourceAt(page, ordinal)]);
  }
);

Given('the first {int} source databases never answer', async ({ page, $testInfo }, count: number) => {
  expect(count, 'the silent databases hold every load slot').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  $testInfo.setTimeout(Math.max($testInfo.timeout, EDGE_SCENARIO_TIMEOUT_MS));
  await makeSilent(page, firstSourceDatabases(page, count));
});

Given(
  'a database of {int} rows has a grid view and a grid view of its rows whose Points are 0',
  async ({ page, request, $testInfo }, rows: number) => {
    $testInfo.setTimeout(Math.max($testInfo.timeout, EDGE_SCENARIO_TIMEOUT_MS));
    await addPagedDatabase(page, request, rows);
    rememberViews(page, [`${PAGED} Grid`, await addPagedZeroPointsGrid(page, request)]);
  }
);

Given(
  'a database of {int} rows has a number view summing Points and a bar chart view counting rows by Status',
  async ({ page, request, $testInfo }, rows: number) => {
    $testInfo.setTimeout(Math.max($testInfo.timeout, EDGE_SCENARIO_TIMEOUT_MS));
    await addPagedDatabase(page, request, rows);
    rememberViews(page, await addPagedNumberAndBarChart(page, request));
  }
);

Given(
  'a small database with dates has a board view, a calendar view and a timeline view',
  async ({ page, request, $testInfo }) => {
    $testInfo.setTimeout(Math.max($testInfo.timeout, EDGE_SCENARIO_TIMEOUT_MS));
    rememberViews(page, await addDatedDatabaseWithViews(page, request));
  }
);

Given('a new database has a dashboard showing those {int} views', async ({ page, request }, count: number) => {
  await createDashboardOfRememberedViews(page, request, count);
});

Given("a version of the dashboard's database was saved", async ({ page, request }) => {
  await saveHostVersion(page, request);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When(new RegExp(`^the rows of the ${ORDINAL} source database can load again$`), async ({ page }, ordinal: string) => {
  await repairSource(page, sourceAt(page, ordinal));
});

When(new RegExp(`^I retry loading the ${ORDINAL} widget$`), async ({ page }, ordinal: string) => {
  await retryWidget(page, widgetAt(page, ordinal));
});

When('I open the dashboard filter menu before every widget has started', async ({ page }) => {
  await openFilterMenuBeforeEveryWidgetStarted(page);
});

When(
  new RegExp(`^a collaborator adds a row to the ${ORDINAL} source database while its widget loads$`),
  async ({ page, request }, ordinal: string) => {
    await addRowWhileLoading(page, request, sourceAt(page, ordinal));
  }
);

When(
  new RegExp(`^a collaborator adds a row to the ${ORDINAL} source database before its widget starts$`),
  async ({ page, request }, ordinal: string) => {
    await addRowBeforeStart(page, request, sourceAt(page, ordinal));
  }
);

When('I open that dashboard while every page after the first loads slowly', async ({ page }) => {
  await openWithSlowPages(page);
});

When('I preview the dashboard in the version history of its database', async ({ page }) => {
  await previewDashboardInHistory(page);
});

When('I visit the dashboard and leave it once', async ({ page }) => {
  await visitDashboardAndLeave(page);
});

When('I measure what the page holds', async ({ page }) => {
  await rememberFirstVisitWeight(page);
});

When('I visit the dashboard and leave it {int} more times', async ({ page }, times: number) => {
  for (let visit = 0; visit < times; visit += 1) await visitDashboardAndLeave(page);
});

When(
  'I open another page and stay there until every source database is released for being idle',
  async ({ page, $testInfo }) => {
    $testInfo.setTimeout(Math.max($testInfo.timeout, EDGE_SCENARIO_TIMEOUT_MS + DASHBOARD_LOADING.sourceIdleReleaseMs));
    await stayAwayUntilIdleRelease(page);
  }
);

When('I return to the dashboard while every source database loads slowly', async ({ page }) => {
  await returnToDashboardWhileSlow(page);
});

When('I open that dashboard on a phone while every source database loads slowly', async ({ page }) => {
  await openOnPhoneWhileSlow(page);
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then(
  new RegExp(`^the ${ORDINAL} widget shows the "(not-found|no-access|offline)" placeholder$`),
  async ({ page }, ordinal: string, reason: string) => {
    await expectPlaceholder(page, widgetAt(page, ordinal), reason);
  }
);

Then(new RegExp(`^the ${ORDINAL} widget says "([^"]+)"$`), async ({ page }, ordinal: string, text: string) => {
  expect(text, 'the failure text of the design (R8)').toBe(ROWS_NOT_LOADED_TEXT);
  await expectRowsNotLoadedMessage(page, widgetAt(page, ordinal));
});

Then(new RegExp(`^the ${ORDINALS} widgets show their rows$`), async ({ page }, list: string) => {
  await expectWidgetsShowRows(
    page,
    ordinalsOf(list).map((ordinal) => widgetAt(page, ordinal))
  );
});

Then(new RegExp(`^the ${ORDINAL} widget does not say it has no rows$`), async ({ page }, ordinal: string) => {
  await expectNoNoRowsResult(page, widgetAt(page, ordinal));
});

Then(
  new RegExp(`^the ${ORDINAL} widget shows the same result as its source view$`),
  async ({ page }, ordinal: string) => {
    await expectWidgetsMatchTheirSourceViews(page, [widgetAt(page, ordinal)]);
  }
);

Then(
  new RegExp(`^the ${ORDINALS} widgets do not start before the source load timeout$`),
  async ({ page }, list: string) => {
    await expectNotStartedBeforeLoadTimeout(
      page,
      ordinalsOf(list).map((ordinal) => widgetAt(page, ordinal))
    );
  }
);

Then(
  new RegExp(`^the ${ORDINALS} widgets show their rows after the source load timeout$`),
  async ({ page }, list: string) => {
    await expectRowsAfterLoadTimeout(
      page,
      ordinalsOf(list).map((ordinal) => widgetAt(page, ordinal))
    );
  }
);

Then('no widget has looked empty so far', async ({ page }) => {
  await expectNoEmptyStateSoFar(page);
});

Then('the filter menu lists the properties of all {int} source databases', async ({ page }, count: number) => {
  await expectFilterMenuListsEverySource(page, count);
});

Then(
  new RegExp(`^the widgets of the ${ORDINALS} source databases list the rows the collaborator added$`),
  async ({ page }, list: string) => {
    await expectCollaboratorRowsShown(
      page,
      ordinalsOf(list).map((ordinal) => sourceAt(page, ordinal))
    );
  }
);

Then(
  new RegExp(`^the ${ORDINAL} widget shows a loading row reading "([^"]+)"$`),
  async ({ page }, ordinal: string, pattern: string) => {
    await expectLoadingRowCounts(page, widgetAt(page, ordinal), pattern);
  }
);

Then(
  new RegExp(
    `^the count in the loading row of the ${ORDINAL} widget only grows and its total is the row count of the database$`
  ),
  async ({ page, request }, ordinal: string) => {
    await expectLoadingRowGrowsToTotal(page, widgetAt(page, ordinal), await pagedRowCount(page, request));
  }
);

Then(
  new RegExp(`^the ${ORDINAL} widget shows no loading row within (\\d+) seconds of its last row$`),
  async ({ page }, ordinal: string, seconds: string) => {
    await expectNoLoadingRowAfterLastRow(page, widgetAt(page, ordinal), Number(seconds) * 1000);
  }
);

Then('until its rows finished loading the number widget showed a loading state or its final value', async ({ page }) => {
  await expectOnlyLoadingOrFinal(page, widgetLabeled(page, `${PAGED} Points sum`), 'number');
});

Then(
  'until its rows finished loading the bar chart widget showed a loading state or its final bars',
  async ({ page }) => {
    await expectOnlyLoadingOrFinal(page, widgetLabeled(page, `${PAGED} By status`), 'chart');
  }
);

Then('neither widget said {string} before its rows finished loading', async ({ page }, text: string) => {
  expect(text, 'what an empty chart or number says').toBe('No data');
  await expectNoNoDataBeforeComplete(page, [
    widgetLabeled(page, `${PAGED} Points sum`),
    widgetLabeled(page, `${PAGED} By status`),
  ]);
});

Then(
  'until its rows arrived every widget showed a loading state, never an empty board, month or lane',
  async ({ page }) => {
    await expectLoadingNeverEmpty(page);
  }
);

Then('every widget ends with a card, an event or a bar for every row of the database', async ({ page, request }) => {
  await expectEveryRowShown(page, request);
});

Then('the preview says dashboards are not previewed and shows no widget', async ({ page }) => {
  await expectHistoryPlaceholderWithoutWidgets(page);
});

Then('no source database was requested while the preview was open', async ({ page }) => {
  await expectNoSourceRequestDuringPreview(page);
});

Then('the page holds at most {int} percent more than after the first visit', async ({ page }, percent: number) => {
  await expectWeightWithin(page, percent);
});

Then('every source database took a load slot again', async ({ page }) => {
  await expectEverySourceTookASlot(page);
});

Then('the widgets are stacked one per line', async ({ page }) => {
  await expectStackedOnePerLine(page);
});
