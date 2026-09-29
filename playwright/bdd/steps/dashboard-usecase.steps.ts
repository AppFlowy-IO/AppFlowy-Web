import { expect, type Page } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import {
  DashboardSelectors,
  dashboardWorld,
  enterEditMode,
  expectDashboardMode,
  globalFilterChip,
  leaveEditMode,
  memberPage,
  openWidgetRow,
  splitList,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import {
  addOnOrAfterDateFilter,
  addRowInWidget,
  addSelectGlobalFilter,
  addUseCaseDatabase,
  addUseCaseRows,
  addUseCaseViews,
  addWidgetThroughPicker,
  barChartValues,
  boardColumn,
  boardColumnTitles,
  changeSelectGlobalFilter,
  chartNumber,
  clickChartSegment,
  createDashboardThroughUi,
  donutTotal,
  drillDown,
  drillDownTitles,
  editWidgetCell,
  expectDashboardRows,
  expectLocalOnlyFilters,
  expectMemberViewMode,
  expectPersistedCell,
  expectStackedWidgets,
  expectWidgetTitles,
  inviteReadOnlyMember,
  lastShownRows,
  openDashboardForMember,
  openUseCaseDashboard,
  parseDashboardRows,
  parsePropertyTable,
  prepareUseCaseWorkspace,
  rememberFieldTypes,
  rememberSelectOptions,
  removeGlobalFilter,
  resizeWidgetTo,
  rowIdByTitle,
  expectRowPage,
  seedUseCaseDashboard,
  setRowPageProperty,
  shownDashboardRows,
  stopApplyingGlobalFilter,
  timelineBarTitles,
  USE_CASE_TIMEOUT,
  namedWidget,
  type WidgetPlacement,
} from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

const WAIT = { timeout: USE_CASE_TIMEOUT };

function hashes(table: DataTable): Record<string, string>[] {
  return table.hashes();
}

// ---------------------------------------------------------------------------
// Workspace, databases, views and dashboards
// ---------------------------------------------------------------------------

Given('a workspace for the {string} use case', async ({ page, request }, useCase: string) => {
  await prepareUseCaseWorkspace(page, request, useCase);
});

async function givenDatabase(
  page: Page,
  request: Parameters<typeof addUseCaseDatabase>[1],
  name: string,
  table: DataTable,
  privateSpace: boolean
) {
  const fields = parsePropertyTable(hashes(table));

  await addUseCaseDatabase(page, request, name, fields, privateSpace);
  rememberFieldTypes(page, name, fields);
  rememberSelectOptions(page, name, fields);
}

Given('a/an {string} database with these properties:', async ({ page, request }, name: string, table: DataTable) => {
  await givenDatabase(page, request, name, table, false);
});

Given(
  'a/an {string} database in a separate private space with these properties:',
  async ({ page, request }, name: string, table: DataTable) => {
    await givenDatabase(page, request, name, table, true);
  }
);

Given('{string} has these rows:', async ({ page, request }, database: string, table: DataTable) => {
  await addUseCaseRows(page, request, database, hashes(table));
});

Given('{string} has these views:', async ({ page, request }, database: string, table: DataTable) => {
  await addUseCaseViews(page, request, database, hashes(table));
});

Given(
  'the {string} dashboard on {string} shows:',
  async ({ page, request }, name: string, host: string, table: DataTable) => {
    await seedUseCaseDashboard(page, request, name, host, parseDashboardRows(hashes(table)));
  }
);

When('I open the {string} dashboard', async ({ page }, name: string) => {
  await openUseCaseDashboard(page, name);
});

// ---------------------------------------------------------------------------
// Building a dashboard
// ---------------------------------------------------------------------------

When('I create a dashboard named {string} on {string}', async ({ page }, name: string, host: string) => {
  await createDashboardThroughUi(page, name, host);
});

When('I add the {string} view as a widget', async ({ page }, view: string) => {
  await addWidgetThroughPicker(page, view, { type: 'default' });
});

When('I add the {string} view as a widget next to {string}', async ({ page }, view: string, target: string) => {
  await addWidgetThroughPicker(page, view, { type: 'next-to', target });
});

When('I add the {string} view as a widget on a new row', async ({ page }, view: string) => {
  await addWidgetThroughPicker(page, view, { type: 'new-row' });
});

async function searchAndAdd(page: Page, query: string, view: string, placement: WidgetPlacement) {
  await addWidgetThroughPicker(page, view, placement, query);
}

When('I search for {string} and add the {string} view as a widget', async ({ page }, query: string, view: string) => {
  await searchAndAdd(page, query, view, { type: 'default' });
});

When(
  'I search for {string} and add the {string} view as a widget next to {string}',
  async ({ page }, query: string, view: string, target: string) => {
    await searchAndAdd(page, query, view, { type: 'next-to', target });
  }
);

When(
  'I search for {string} and add the {string} view as a widget on a new row',
  async ({ page }, query: string, view: string) => {
    await searchAndAdd(page, query, view, { type: 'new-row' });
  }
);

When('I finish editing the dashboard', async ({ page }) => {
  await leaveEditMode(page);
});

When('I switch the dashboard to Edit mode', async ({ page }) => {
  await enterEditMode(page);
});

When('I resize {string} to {int} columns', async ({ page }, view: string, columns: number) => {
  await resizeWidgetTo(page, view, columns);
});

Then('the dashboard shows these rows:', async ({ page }, table: DataTable) => {
  await expectDashboardRows(page, parseDashboardRows(hashes(table)));
});

Then('the dashboard opens in View mode', async ({ page }) => {
  await expectDashboardMode(page, 'View');
});

Then('the dashboard opens in View mode with the same rows', async ({ page }) => {
  await expectDashboardMode(page, 'View');
  await expect.poll(() => shownDashboardRows(page), WAIT).toEqual(lastShownRows(page));
});

// ---------------------------------------------------------------------------
// Working with widgets
// ---------------------------------------------------------------------------

When(
  'I drag the {string} card to the {string} column in the {string} widget',
  async ({ page }, title: string, column: string, view: string) => {
    const widget = widgetLocator(page, view);
    const rowId = await rowIdByTitle(page, view, title);
    const card = widget.locator(`[data-card-id*="${rowId}"]`).first();
    const target = boardColumn(widget, column);

    await expect(card).toBeVisible(WAIT);
    await expect(target).toBeVisible(WAIT);
    await card.scrollIntoViewIfNeeded();
    const from = await card.boundingBox();
    const to = await target.boundingBox();

    if (!from || !to) throw new Error('The card or the column is not visible');
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const end = { x: to.x + to.width / 2, y: to.y + Math.min(to.height / 2, 80) };

    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(start.x + ((end.x - start.x) * step) / 20, start.y + ((end.y - start.y) * step) / 20);
    }

    await page.mouse.up();
    await expect.poll(() => boardColumnTitles(widget, column), WAIT).toContain(title);
  }
);

When(
  'I change the {string} of {string} to {string} in the {string} widget',
  async ({ page }, property: string, title: string, value: string, view: string) => {
    await editWidgetCell(page, view, title, property, value);
  }
);

When('I add a row named {string} in the {string} widget', async ({ page }, title: string, view: string) => {
  await addRowInWidget(page, view, title);
});

When('I set {string} to {string} on the open page', async ({ page }, property: string, value: string) => {
  await setRowPageProperty(page, property, value);
});

When('I click the {string} segment of the {string} chart', async ({ page }, label: string, view: string) => {
  await clickChartSegment(page, widgetLocator(page, view), label);
  await expect(drillDown(page)).toBeVisible(WAIT);
});

When('I open {string} from the drill-down', async ({ page }, title: string) => {
  await drillDown(page).locator('.MuiDialogContent-root button').filter({ hasText: title }).first().click();
});

Then('the drill-down lists {string}', async ({ page }, titles: string) => {
  await expect(drillDown(page)).toBeVisible(WAIT);
  await expect.poll(async () => (await drillDownTitles(page)).sort(), WAIT).toEqual(splitList(titles).sort());
});

Then('the {string} widget shows that there are no rows to count', async ({ page }, view: string) => {
  const chart = widgetLocator(page, view).getByTestId('number-chart');

  await expect(chart).toHaveAttribute('data-empty', 'true', WAIT);
  await expect(chart.getByTestId('number-chart-empty')).toHaveText('No rows to count');
});

Then('the {string} chart total is {string}', async ({ page }, view: string, total: string) => {
  const widget = widgetLocator(page, view);

  await expect(widget.locator('.recharts-pie')).toBeVisible(WAIT);
  // Like desktop, the donut prints a plain integer; compare the value.
  await expect.poll(async () => chartNumber((await donutTotal(widget).textContent()) ?? ''), WAIT).toBe(chartNumber(total));
});

Then('the {string} chart shows these values:', async ({ page }, view: string, table: DataTable) => {
  const widget = widgetLocator(page, view);
  const expected = Object.fromEntries(hashes(table).map((row) => [row.label.trim(), chartNumber(row.value)]));

  await expect(widget.locator('.recharts-bar-rectangle').first()).toBeVisible(WAIT);
  await expect.poll(() => barChartValues(widget), WAIT).toEqual(expected);
});

Then(
  'the {string} board column {string} has the cards {string}',
  async ({ page }, view: string, column: string, titles: string) => {
    const widget = widgetLocator(page, view);

    await expect(boardColumn(widget, column)).toBeVisible(WAIT);
    await expect.poll(async () => (await boardColumnTitles(widget, column)).sort(), WAIT).toEqual(splitList(titles).sort());
  }
);

Then('the {string} widget shows the cards {string}', async ({ page }, view: string, titles: string) => {
  await expectWidgetTitles(page, page, view, splitList(titles));
});

Then('the {string} widget lists {string}', async ({ page }, view: string, titles: string) => {
  await expectWidgetTitles(page, page, view, splitList(titles));
});

Then('the {string} widget lists in order {string}', async ({ page }, view: string, titles: string) => {
  await expectWidgetTitles(page, page, view, splitList(titles), true);
});

Then('the {string} widget lists nothing', async ({ page }, view: string) => {
  await expectWidgetTitles(page, page, view, []);
});

Then('the {string} timeline shows the bars {string}', async ({ page }, view: string, titles: string) => {
  const widget = widgetLocator(page, view);

  await expect(widget.getByTestId('timeline-view')).toBeVisible(WAIT);
  // Every row with dates has a bar; bars outside the shown dates are scrolled away, not removed.
  await expect.poll(() => timelineBarTitles(page, view), WAIT).toEqual(splitList(titles).sort());
});

Then('the {string} widget shows {string} on today', async ({ page }, view: string, title: string) => {
  const today = widgetLocator(page, view).locator('.fc-day-today');

  await expect(today).toBeVisible(WAIT);
  await expect(today.locator('.fc-event').filter({ hasText: title }).first()).toBeVisible(WAIT);
});

Then(
  'the {string} of {string} in {string} is {string}',
  async ({ page, request }, property: string, title: string, database: string, value: string) => {
    await expectPersistedCell(page, request, database, title, property, value);
  }
);

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

When('I add a global filter where {string} is {string}', async ({ page }, property: string, options: string) => {
  await addSelectGlobalFilter(page, page, property, options);
});

When(
  'I add a global filter where {string} is {string}, using {string} in {string}',
  async ({ page }, property: string, options: string, override: string, database: string) => {
    await addSelectGlobalFilter(page, page, property, options, { [database]: override });
  }
);

When(
  'I add a global filter where {string} is on or after {string}',
  async ({ page }, property: string, day: string) => {
    await addOnOrAfterDateFilter(page, property, day);
  }
);

When('I remove the global filter {string}', async ({ page }, name: string) => {
  await removeGlobalFilter(page, name);
  await expect(globalFilterChip(page, name)).toHaveCount(0, WAIT);
});

When('I stop applying the global filter {string} to {string}', async ({ page }, name: string, database: string) => {
  await stopApplyingGlobalFilter(page, name, database);
});

// ---------------------------------------------------------------------------
// Teammates and executives
// ---------------------------------------------------------------------------

async function inviteViewer(page: Page, request: Parameters<typeof inviteReadOnlyMember>[1], space: string) {
  // The use-case space is named after the use case.
  expect(space).toBe(dashboardWorld(page).spaceName);
  await inviteReadOnlyMember(page, request);
}

Given('a teammate who can only view the {string} space', async ({ page, request }, space: string) => {
  await inviteViewer(page, request, space);
});

Given('an executive who can only view the {string} space', async ({ page, request }, space: string) => {
  await inviteViewer(page, request, space);
});

Given('the executive has the {string} dashboard open', async ({ page }, name: string) => {
  await openDashboardForMember(page, name);
});

When('the teammate/executive opens the {string} dashboard', async ({ page }, name: string) => {
  await openDashboardForMember(page, name);
});

When(
  'the executive opens the {string} dashboard on a {int} by {int} screen',
  async ({ page }, name: string, width: number, height: number) => {
    await openDashboardForMember(page, name, { width, height });
  }
);

When('the executive reloads the page', async ({ page }) => {
  const member = memberPage(page);

  await member.reload({ waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(member)).toBeVisible(WAIT);
});

When(
  'the teammate adds a global filter where {string} is {string}',
  async ({ page }, property: string, options: string) => {
    await addSelectGlobalFilter(memberPage(page), page, property, options);
  }
);

When(
  'the executive changes the global filter {string} to {string}',
  async ({ page }, name: string, option: string) => {
    await changeSelectGlobalFilter(memberPage(page), name, option);
  }
);

When(
  'the executive opens the {string} row from the {string} widget',
  async ({ page }, title: string, view: string) => {
    const rowId = await rowIdByTitle(page, view, title);

    await openWidgetRow(memberPage(page), namedWidget(memberPage(page), page, view), rowId);
  }
);

Then('the teammate/executive sees the dashboard in View mode without an Edit button', async ({ page }) => {
  await expectMemberViewMode(page);
});

Then(
  'the teammate/executive sees the {string} widget list {string}',
  async ({ page }, view: string, titles: string) => {
    await expectWidgetTitles(memberPage(page), page, view, splitList(titles));
  }
);

Then(
  'the executive sees the {string} widget list in order {string}',
  async ({ page }, view: string, titles: string) => {
    await expectWidgetTitles(memberPage(page), page, view, splitList(titles), true);
  }
);

Then(
  'the executive sees the {string} widget show the number {string}',
  async ({ page }, view: string, value: string) => {
    await expect(namedWidget(memberPage(page), page, view).getByTestId('number-chart-value')).toHaveText(value, WAIT);
  }
);

Then('the teammate/executive sees that the global filter only applies for them', async ({ page }) => {
  await expectLocalOnlyFilters(memberPage(page));
});

Then('the executive sees the global filter {string}', async ({ page }, label: string) => {
  const member = memberPage(page);

  await expect(
    DashboardSelectors.globalFilterChips(member).getByTestId('dashboard-global-filter-chip-label').filter({
      hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`),
    })
  ).toHaveCount(1, WAIT);
});

Then('the executive sees the row page for {string}', async ({ page }, title: string) => {
  await expectRowPage(memberPage(page), title);
});

Then('the executive sees every widget stacked in a single column', async ({ page }) => {
  await expectStackedWidgets(memberPage(page));
});

Then('the teammate sees the {string} widget explain that they have no access', async ({ page }, view: string) => {
  const placeholder = namedWidget(memberPage(page), page, view).getByTestId('dashboard-widget-placeholder');

  await expect(placeholder).toHaveAttribute('data-reason', 'no-access', WAIT);
  await expect(placeholder).toContainText("You don't have access to this database");
});
