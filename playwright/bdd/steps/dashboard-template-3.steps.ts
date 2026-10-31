/**
 * Steps of the third set of dashboard template scenarios
 * (`dashboard-usecases/field-research`, `oncall-handbook` and
 * `saas-subscriptions`). Everything else those features say is the shared
 * use-case, dashboard, chrome and arrange wording; only what no other step
 * covers lives here.
 */
import { createBdd, type DataTable } from 'playwright-bdd';

import {
  addAIMeetingBlock,
  addViewsWithChartSettings,
  actorPage,
  changePropertyType,
  closeTemplateActors,
  closeWidgetMenu,
  createDocument,
  deleteDashboardBlock,
  deleteDatabaseView,
  duplicateDashboardBlock,
  duplicateDatabaseFromSidebar,
  duplicateDocumentFromSidebar,
  embedDashboardInDocument,
  expectActorNumber,
  expectDashboardBlockCount,
  expectDisabledRowAddButton,
  expectGlobalFilterUnusable,
  expectGuestCannotReadDatabase,
  expectHistoryDashboardPlaceholder,
  expectNoWidgetTitles,
  expectReadOnlyDashboard,
  expectSecondBlockRows,
  expectSlashOptionDisabled,
  expectValuesPerYear,
  expectViewStillExists,
  expectWidgetMenuItemDisabled,
  hoverWidgetMenuItem,
  inviteGuestToPage,
  linkDashboardInDocument,
  openDashboardOfCopy,
  openDocument,
  openDocumentAs,
  openDocumentWithDashboard,
  openPublishedPageAsVisitor,
  openVersionHistory,
  pressRowHeightKey,
  previewSavedVersionView,
  publishDocument,
  reloadVisitorPage,
  restoreDatabaseFromTrash,
  restoreSavedVersion,
  saveDatabaseVersion,
  setNumberFormat,
  shareGuestSourceDatabase,
  typeSlashInMeetingNotes,
  typeSlashInSimpleTableCell,
  useFreePlan,
} from '../../support/dashboard-template-3-helpers';
import { splitList } from '../../support/dashboard-test-helpers';
import {
  changeSelectGlobalFilter,
  expectLocalOnlyFilters,
  expectWidgetTitles,
  parseDashboardRows,
} from '../../support/dashboard-usecase-helpers';

const { Given, When, Then, After } = createBdd();

/**
 * Every step is scoped to this set's features (`@dashboard-template-3`), so a
 * step of the same wording in another set never makes a step ambiguous.
 */
const SET = { tags: '@dashboard-template-3' };

After(SET, async ({ page }) => {
  await closeTemplateActors(page);
});

// ---------------------------------------------------------------------------
// Views, properties and chart values
// ---------------------------------------------------------------------------

/**
 * The use-case view table, plus `, titled "T"`, `percent checked of P`,
 * `by D per day|week|month|year` and the filters `P is checked`,
 * `P is unchecked` and `P is next week`.
 */
Given(
  '{string} has these views with their chart settings:',
  SET,
  async ({ page, request }, database: string, table: DataTable) => {
    await addViewsWithChartSettings(page, request, database, table.hashes());
  }
);

Given(
  'the {string} property of {string} uses the {string} number format',
  SET,
  async ({ page, request }, property: string, database: string, format: string) => {
    await setNumberFormat(page, request, database, property, format);
  }
);

Then('the {string} chart shows these values per year:', SET, async ({ page }, view: string, table: DataTable) => {
  await expectValuesPerYear(page, view, table.hashes());
});

// ---------------------------------------------------------------------------
// Edit mode: the widget menu, the add buttons and the row height
// ---------------------------------------------------------------------------

Then('{string} is disabled in the widget menu', SET, async ({ page }, action: string) => {
  await expectWidgetMenuItemDisabled(page, action);
});

When('I hover {string} in the widget menu', SET, async ({ page }, action: string) => {
  await hoverWidgetMenuItem(page, action);
});

When('I close the widget menu', SET, async ({ page }) => {
  await closeWidgetMenu(page);
});

Then('dashboard row {int} offers a disabled add widget button', SET, async ({ page }, row: number) => {
  await expectDisabledRowAddButton(page, row);
});

When(
  'I press {string} {int} times on the height handle of dashboard row {int}',
  SET,
  async ({ page }, key: string, times: number, row: number) => {
    await pressRowHeightKey(page, row, key, times);
  }
);

Then('no widget shows its title', SET, async ({ page }) => {
  await expectNoWidgetTitles(page);
});

// ---------------------------------------------------------------------------
// Documents with an embedded dashboard
// ---------------------------------------------------------------------------

Given('a document named {string} in the {string} space', SET, async ({ page, request }, name: string, space: string) => {
  await createDocument(page, request, name, space);
});

Given('I am editing the {string} document', SET, async ({ page }, name: string) => {
  await openDocument(page, name);
});

When('I link the {string} database as a dashboard in the document', SET, async ({ page }, database: string) => {
  await linkDashboardInDocument(page, database);
});

Then('the {string} document holds {int} dashboard block(s)', SET, async ({ page }, name: string, count: number) => {
  await expectDashboardBlockCount(page, name, count);
});

/** The document's dashboard is then addressed by the document's name ("the "On-call handbook" dashboard"). */
Given(
  'the {string} document embeds a dashboard of {string} showing:',
  SET,
  async ({ page, request }, name: string, database: string, table: DataTable) => {
    await embedDashboardInDocument(page, request, name, database, parseDashboardRows(table.hashes()));
  }
);

When('I duplicate the dashboard block from its block menu', SET, async ({ page }) => {
  await duplicateDashboardBlock(page);
});

Then('the second dashboard block shows these rows:', SET, async ({ page }, table: DataTable) => {
  await expectSecondBlockRows(page, parseDashboardRows(table.hashes()));
});

When('I delete the second dashboard block from its block menu', SET, async ({ page }) => {
  await deleteDashboardBlock(page, 2);
});

Then('the {string} view of {string} still exists', SET, async ({ page, request }, view: string, database: string) => {
  await expectViewStillExists(page, request, view, database);
});

When('I type slash in a simple table cell of the document', SET, async ({ page }) => {
  await typeSlashInSimpleTableCell(page);
});

Given('the {string} document has an AI meeting block', SET, async ({ page }, name: string) => {
  await addAIMeetingBlock(page, name);
});

When('I type slash inside the AI meeting notes', SET, async ({ page }) => {
  await typeSlashInMeetingNotes(page);
});

When('I duplicate the {string} page from the sidebar', SET, async ({ page, request }, name: string) => {
  await duplicateDocumentFromSidebar(page, request, name);
});

When('I open the {string} document', SET, async ({ page }, name: string) => {
  await openDocumentWithDashboard(page, name);
});

// ---------------------------------------------------------------------------
// The Free plan
// ---------------------------------------------------------------------------

Given('the workspace is on the Free plan', SET, async ({ page }) => {
  await useFreePlan(page);
});

Then(
  'the slash menu command {string} is disabled with the tooltip {string}',
  SET,
  async ({ page }, command: string, tooltip: string) => {
    await expectSlashOptionDisabled(page, command, tooltip);
  }
);

// ---------------------------------------------------------------------------
// The teammate, a guest and an anonymous visitor
// ---------------------------------------------------------------------------

When('the teammate opens the {string} document', SET, async ({ page }, name: string) => {
  await openDocumentAs(page, 'teammate', name);
});

Given('a guest invited to the {string} page only', SET, async ({ page, request }, name: string) => {
  await inviteGuestToPage(page, request, name);
});

Given('the guest is also granted read access to the {string} source database', SET, async ({ page, request }, name: string) => {
  await shareGuestSourceDatabase(page, request, name);
});

Then('the guest cannot read the {string} source database', SET, async ({ page, request }, name: string) => {
  await expectGuestCannotReadDatabase(page, request, name);
});

When('the guest opens the {string} document', SET, async ({ page }, name: string) => {
  await openDocumentAs(page, 'guest', name);
});

When('I publish the {string} document', SET, async ({ page }, name: string) => {
  await publishDocument(page, name);
});

When('an anonymous visitor opens the published {string} page', SET, async ({ page }, name: string) => {
  await openPublishedPageAsVisitor(page, name);
});

When('the visitor reloads the page', SET, async ({ page }) => {
  await reloadVisitorPage(page);
});

Then(
  'the teammate sees the {string} widget show the number {string}',
  SET,
  async ({ page }, view: string, value: string) => {
    await expectActorNumber(page, 'teammate', view, value);
  }
);

Then(
  'the guest sees the {string} widget show the number {string}',
  SET,
  async ({ page }, view: string, value: string) => {
    await expectActorNumber(page, 'guest', view, value);
  }
);

Then(
  'the visitor sees the {string} widget show the number {string}',
  SET,
  async ({ page }, view: string, value: string) => {
    await expectActorNumber(page, 'visitor', view, value);
  }
);

Then('the guest sees the dashboard in View mode without an Edit button', SET, async ({ page }) => {
  await expectReadOnlyDashboard(actorPage(page, 'guest'));
});

Then('the visitor sees the dashboard in View mode without an Edit button', SET, async ({ page }) => {
  await expectReadOnlyDashboard(actorPage(page, 'visitor'));
});

Then('the guest sees the {string} widget list {string}', SET, async ({ page }, view: string, titles: string) => {
  await expectWidgetTitles(actorPage(page, 'guest'), page, view, splitList(titles));
});

Then('the visitor sees the {string} widget list {string}', SET, async ({ page }, view: string, titles: string) => {
  await expectWidgetTitles(actorPage(page, 'visitor'), page, view, splitList(titles));
});

When(
  'the visitor changes the global filter {string} to {string}',
  SET,
  async ({ page }, name: string, option: string) => {
    await changeSelectGlobalFilter(actorPage(page, 'visitor'), name, option);
  }
);

Then('the visitor sees that the global filter only applies for them', SET, async ({ page }) => {
  await expectLocalOnlyFilters(actorPage(page, 'visitor'));
});

// ---------------------------------------------------------------------------
// Clean-up: trash, views, properties, version history and duplicates
// ---------------------------------------------------------------------------

When('I restore the {string} database from the trash', SET, async ({ page, request }, database: string) => {
  await restoreDatabaseFromTrash(page, request, database);
});

When('I delete the {string} view of {string}', SET, async ({ page, request }, view: string, database: string) => {
  await deleteDatabaseView(page, request, view, database);
});

When(
  'I change the {string} property of {string} to a {string} property',
  SET,
  async ({ page, request }, property: string, database: string, type: string) => {
    await changePropertyType(page, request, property, database, type);
  }
);

Then(
  'the {string} global filter no longer applies to {string}',
  SET,
  async ({ page }, name: string, database: string) => {
    await expectGlobalFilterUnusable(page, name, database);
  }
);

Given('the {string} database has a saved version', SET, async ({ page, request }, database: string) => {
  await saveDatabaseVersion(page, request, database);
});

When('I open the version history of the {string} database', SET, async ({ page }, database: string) => {
  await openVersionHistory(page, database);
});

When('I preview the {string} view of the saved version', SET, async ({ page }, view: string) => {
  await previewSavedVersionView(page, view);
});

Then('the history preview explains that dashboards are not previewed', SET, async ({ page }) => {
  await expectHistoryDashboardPlaceholder(page);
});

When('I restore the saved version', SET, async ({ page }) => {
  await restoreSavedVersion(page);
});

When('I duplicate the {string} database from the sidebar', SET, async ({ page, request }, database: string) => {
  await duplicateDatabaseFromSidebar(page, request, database);
});

When(
  'I open the {string} dashboard of the copy of {string}',
  SET,
  async ({ page, request }, dashboard: string, database: string) => {
    await openDashboardOfCopy(page, request, dashboard, database);
  }
);
