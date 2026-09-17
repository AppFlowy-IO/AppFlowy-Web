import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import {
  addDashboardView,
  addFixtureDatabase,
  addViewThroughTabs,
  allWidgets,
  chooseWidgetMenuAction,
  cleanupDashboardFixture,
  configureNumberChart,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardSelectors,
  dashboardSidebarEntry,
  dashboardViewId,
  dashboardWorld,
  DatabaseViewLayout,
  dragLocatorBy,
  dragWidgetBeside,
  dragWidgetBetweenRows,
  enterEditMode,
  expectDashboardMode,
  expectGridWidgetRows,
  fixtureDatabase,
  gridDataRows,
  hostDatabase,
  inviteDashboardMember,
  knownWidget,
  labelsOfRow,
  LAYOUT_BY_NAME,
  leaveEditMode,
  memberPage,
  openDashboard,
  openDashboardAsMember,
  openDatabasePage,
  openWidgetPicker,
  parseViewLabel,
  persistedRow,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  readDatabaseViews,
  reloadDashboard,
  renderedRows,
  rowColumnWidth,
  seedDashboardWidgets,
  splitList,
  trashFixtureDatabase,
  viewIdForLabel,
  waitForDashboardSync,
  waitForDatabaseContext,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, DatabaseViewSelectors } from '../../support/selectors';

const { Given, When, Then, Before, After } = createBdd();

const WIDGET_TIMEOUT = { timeout: 30_000 };

Before({ tags: '@dashboard' }, async ({ page, $testInfo }) => {
  // API fixtures, several database pages and cross-database widgets need room.
  $testInfo.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
});

After({ tags: '@dashboard' }, async ({ page, request }) => {
  await cleanupDashboardFixture(page, request);
});

/** Make sure the dashboard (and so the host database doc) is mounted before seeding it. */
async function ensureDashboardOpen(page: Page) {
  if (await DashboardSelectors.view(page).isVisible()) return;
  await openDashboard(page);
}

/**
 * A disabled add button ignores pointer events; its tooltip wrapper takes the
 * click and shows the limit message instead.
 */
async function clickDisabledAddButton(button: Locator) {
  await button.locator('xpath=..').click();
}

/** The banner a refused add shows (a full dashboard also keeps an inline hint with the same test id). */
async function expectLimitMessage(page: Page, reason: 'dashboard' | 'row', count: number) {
  const message = DashboardSelectors.limitMessage(page).and(page.locator('[data-variant="banner"]'));

  await expect(message).toBeVisible();
  await expect(message).toHaveAttribute('data-reason', reason);
  await expect(message).toContainText(String(count));
}

// ---------------------------------------------------------------------------
// Fixture and creation
// ---------------------------------------------------------------------------

Given('the dashboard fixture workspace is ready', async ({ page, request }) => {
  await prepareDashboardFixture(page, request);
});

Given('the fixture also has the {string} database', async ({ page, request }, name: string) => {
  await addFixtureDatabase(page, request, name);
});

Given('{string} also has a {string} view', async ({ page }, database: string, layout: string) => {
  await addViewThroughTabs(page, database, layout);
});

Given(
  'the owner keeps a {string} database in a space the member cannot open',
  async ({ page, request }, name: string) => {
    await addFixtureDatabase(page, request, name);
    await openDashboard(page);
  }
);

When('I add a dashboard to {string} from the view tab menu', async ({ page }, database: string) => {
  await addDashboardView(page, database);
});

Given('I added a dashboard to {string}', async ({ page }, database: string) => {
  await addDashboardView(page, database);
});

Given('I open the dashboard again', async ({ page }) => {
  await openDashboard(page);
});

When('I switch the {string} view to the Dashboard layout', async ({ page }, label: string) => {
  const { database } = parseViewLabel(label);
  const viewId = viewIdForLabel(page, label);
  const world = dashboardWorld(page);

  await openDatabasePage(page, database, viewId);
  await page.getByTestId('database-actions-settings').click();
  await DatabaseViewSelectors.layoutSettingsTrigger(page).hover();
  await expect(DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Dashboard)).toBeVisible();
  await DatabaseViewSelectors.layoutOption(page, DatabaseViewLayout.Dashboard).click();
  await page.keyboard.press('Escape');
  world.dashboardViewId = viewId;
  world.dashboardHost = database;
  await expect
    .poll(
      async () =>
        (await readDatabaseViews(page, fixtureDatabase(page, database).databaseId)).find((view) => view.id === viewId)
          ?.layout
    )
    .toBe(DatabaseViewLayout.Dashboard);
});

Then('the dashboard view is shown', async ({ page }) => {
  await expect(DashboardSelectors.view(page)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the dashboard view is still open', async ({ page }) => {
  await expect(DashboardSelectors.view(page)).toBeVisible();
  await expect(DatabaseViewSelectors.viewTab(page, dashboardViewId(page))).toHaveAttribute('data-state', 'active');
});

Then('the dashboard is in Edit mode', async ({ page }) => {
  await expectDashboardMode(page, 'Edit');
});

Then('the dashboard is in View mode', async ({ page }) => {
  await expectDashboardMode(page, 'View');
});

Then('the dashboard shows width handles', async ({ page }) => {
  await expect(DashboardSelectors.widthHandles(page).first()).toBeAttached();
});

Then('the dashboard shows its empty state with an Add widget button', async ({ page }) => {
  const empty = DashboardSelectors.emptyState(page);

  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Build your dashboard');
  await expect(DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first()).toBeEnabled();
});

Then('the dashboard empty state reads {string}', async ({ page }, text: string) => {
  const empty = DashboardSelectors.emptyState(page);

  await expect(empty).toBeVisible();
  await expect(empty).toContainText(text);
  await expect(empty.getByTestId('dashboard-add-widget-button')).toHaveCount(0);
});

Then('the active dashboard tab is named {string}', async ({ page }, name: string) => {
  const tab = DatabaseViewSelectors.viewTab(page, dashboardViewId(page));

  await expect(tab).toHaveAttribute('data-state', 'active');
  await expect(tab).toContainText(name);
  const views = await readDatabaseViews(page, hostDatabase(page).databaseId);

  expect(views.find((view) => view.id === dashboardViewId(page))?.name).toBe(name);
});

Then('the dashboard layout setting exists with {int} widgets', async ({ page }, count: number) => {
  await expect
    .poll(async () => {
      const setting = await readDashboardSetting(page);

      return setting.exists ? allWidgets(setting).length : -1;
    })
    .toBe(count);
});

Then('the dashboard view tab shows the dashboard icon', async ({ page }) => {
  const tab = DatabaseViewSelectors.viewTab(page, dashboardViewId(page));

  await expect(DashboardSelectors.viewIcon(tab)).toBeVisible();
});

Then('the dashboard sidebar entry shows the dashboard icon', async ({ page }) => {
  const entry = await dashboardSidebarEntry(page);

  await expect(entry).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.viewIcon(entry)).toBeVisible();
});

When('I click the dashboard Done button', async ({ page }) => {
  await leaveEditMode(page);
});

When('I click the dashboard Edit button', async ({ page }) => {
  await enterEditMode(page);
});

When('I delete the dashboard view tab', async ({ page }) => {
  const tab = DatabaseViewSelectors.viewTab(page, dashboardViewId(page));

  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionDelete(page)).toBeVisible();
  await DatabaseViewSelectors.tabActionDelete(page).click();
  await DatabaseViewSelectors.deleteViewConfirmButton(page).click();
});

Then('the dashboard view tab is gone', async ({ page }) => {
  await expect(DatabaseViewSelectors.viewTab(page, dashboardViewId(page))).toHaveCount(0, WIDGET_TIMEOUT);
  await expect(DashboardSelectors.view(page)).toHaveCount(0);
  await expect
    .poll(async () =>
      (await readDatabaseViews(page, hostDatabase(page).databaseId)).some((view) => view.id === dashboardViewId(page))
    )
    .toBe(false);
});

Then('the {string} view still shows {int} rows', async ({ page }, label: string, count: number) => {
  const { database } = parseViewLabel(label);

  await openDatabasePage(page, database, viewIdForLabel(page, label));
  await expect(gridDataRows(DatabaseGridSelectors.grid(page))).toHaveCount(count, WIDGET_TIMEOUT);
});

Then('the {string} database still has its {string} view', async ({ page }, database: string, layout: string) => {
  const viewId = fixtureDatabase(page, database).views[layout];

  expect(viewId, `"${database}" never had a ${layout} view`).toBeTruthy();
  const views = await readDatabaseViews(page, fixtureDatabase(page, database).databaseId);

  expect(views.find((view) => view.id === viewId)?.layout).toBe(LAYOUT_BY_NAME[layout]);
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

Given('the dashboard has these widgets:', async ({ page }, table: DataTable) => {
  await ensureDashboardOpen(page);
  const layout = table.hashes().map((entry) => ({ row: Number(entry.row), label: entry.widget }));

  await seedDashboardWidgets(page, layout);
});

Given('the dashboard has {int} widgets in {int} full rows', async ({ page }, count: number, rows: number) => {
  expect(count).toBe(DASHBOARD_MAX_WIDGETS);
  await ensureDashboardOpen(page);
  const databases = ['Projects', 'Tasks', 'Notes'];
  const perRow = count / rows;
  const layout = Array.from({ length: count }, (_, index) => ({
    row: Math.floor(index / perRow) + 1,
    label: `${databases[index % databases.length]} Grid #${index + 1}`,
  }));

  await seedDashboardWidgets(page, layout);
});

When('I open the widget picker', async ({ page }) => {
  await openWidgetPicker(page);
});

When('I pick the {string} view in the widget picker', async ({ page }, label: string) => {
  await pickExistingView(page, viewIdForLabel(page, label));
});

When(
  'I search the widget picker for {string} and pick the {string} view',
  async ({ page }, query: string, label: string) => {
    const viewId = viewIdForLabel(page, label);
    const { database } = parseViewLabel(label);
    const option = DashboardSelectors.pickerOption(page, viewId);

    await DashboardSelectors.pickerSearch(page).fill(query);
    await expect(option).toBeVisible(WIDGET_TIMEOUT);
    await expect(option).toHaveAttribute('data-database-id', fixtureDatabase(page, database).databaseId);
    // Views of databases that do not match the query are filtered out.
    await expect(DashboardSelectors.pickerOption(page, fixtureDatabase(page, 'Notes').views.Grid)).toHaveCount(0);
    await pickExistingView(page, viewId);
  }
);

When(
  'I create a new {string} view of {string} from the widget picker',
  async ({ page }, layoutName: string, database: string) => {
    const layout = LAYOUT_BY_NAME[layoutName];
    const target = fixtureDatabase(page, database);
    const world = dashboardWorld(page);

    world.viewCountBefore = (await readDatabaseViews(page, target.databaseId)).length;
    await DashboardSelectors.pickerNewView(page).click();
    // Pick the source database first (the host is listed as "This database"), then the layout.
    const databaseChoice = DashboardSelectors.pickerDatabase(page, target.databaseId);

    await expect(databaseChoice).toBeVisible(WIDGET_TIMEOUT);
    if ((await databaseChoice.getAttribute('data-selected')) !== 'true') await databaseChoice.click();
    await expect(databaseChoice).toHaveAttribute('data-selected', 'true');
    await DashboardSelectors.pickerLayoutOption(page, layout).click();
    await expect(DashboardSelectors.picker(page)).toBeHidden(WIDGET_TIMEOUT);
  }
);

Then('the dashboard shows {int} widget(s)', async ({ page }, count: number) => {
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, WIDGET_TIMEOUT);
  await expect.poll(async () => allWidgets(await readDashboardSetting(page)).length).toBe(count);
});

Then('the {string} widget shows the rows {string}', async ({ page }, label: string, titles: string) => {
  await expectGridWidgetRows(widgetLocator(page, label), splitList(titles));
});

Then('the {string} widget shows no rows', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);

  await expect(widget).toBeVisible(WIDGET_TIMEOUT);
  await expect(gridDataRows(widget)).toHaveCount(0, WIDGET_TIMEOUT);
});

Then(
  'the dashboard layout setting references the {string} view in row {int}',
  async ({ page }, label: string, rowIndex: number) => {
    const { database } = parseViewLabel(label);
    const viewId = viewIdForLabel(page, label);

    await expect
      .poll(async () => {
        const { rows } = await readDashboardSetting(page);

        return rows[rowIndex - 1]?.widgets.some(
          (widget) => widget.view_id === viewId && widget.database_id === fixtureDatabase(page, database).databaseId
        );
      })
      .toBe(true);
    const widget = DashboardSelectors.widgetsForView(page, viewId).first();

    await expect(widget).toHaveAttribute('data-database-id', fixtureDatabase(page, database).databaseId);
  }
);

Then('the widget shows a new {string} view of {string}', async ({ page }, layoutName: string, database: string) => {
  const target = fixtureDatabase(page, database);
  const world = dashboardWorld(page);
  const known = new Set(Object.values(target.views));

  known.add(dashboardViewId(page));
  let newViewId = '';

  await expect
    .poll(async () => {
      const views = await readDatabaseViews(page, target.databaseId);
      const created = views.find((view) => !known.has(view.id) && view.layout === LAYOUT_BY_NAME[layoutName]);
      const setting = await readDashboardSetting(page);

      newViewId = created?.id ?? '';
      return (
        views.length === (world.viewCountBefore ?? 0) + 1 &&
        Boolean(created) &&
        allWidgets(setting).some((widget) => widget.view_id === created?.id)
      );
    }, WIDGET_TIMEOUT)
    .toBe(true);
  target.views[layoutName] = newViewId;
  await expect(DashboardSelectors.widgetsForView(page, newViewId)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the new board widget shows the {string} column', async ({ page }, column: string) => {
  const widget = widgetLocator(page, 'Projects Board');

  await expect(
    widget
      .getByTestId('board-column')
      .filter({ has: page.getByTestId('board-column-name').getByText(column, { exact: true }) })
  ).toBeVisible(WIDGET_TIMEOUT);
});

Then('the {string} widget header shows its view name', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);
  const { database } = parseViewLabel(label);
  const views = await readDatabaseViews(page, fixtureDatabase(page, database).databaseId).catch(() => []);
  const name = views.find((view) => view.id === viewIdForLabel(page, label))?.name;
  const title = widget.getByTestId('dashboard-widget-header').getByTestId('dashboard-widget-title');

  await expect(title).toBeVisible(WIDGET_TIMEOUT);
  await expect(title).not.toHaveText('');
  if (name) await expect(title).toContainText(name);
});

When('I choose {string} in the {string} widget menu', async ({ page }, action: string, label: string) => {
  const before = await readDashboardSetting(page);

  await chooseWidgetMenuAction(page, widgetLocator(page, label), action as Parameters<typeof chooseWidgetMenuAction>[2]);
  if (action !== 'open') {
    await expect
      .poll(async () => JSON.stringify((await readDashboardSetting(page)).rows))
      .not.toBe(JSON.stringify(before.rows));
  }
});

Then('the {string} view is open outside the dashboard', async ({ page }, label: string) => {
  const { database } = parseViewLabel(label);
  const target = fixtureDatabase(page, database);
  const viewId = viewIdForLabel(page, label);

  await expect
    .poll(async () => {
      const url = page.url();
      const navigated = url.includes(viewId) || url.includes(target.pageId);
      const dialog = page.locator('[role="dialog"]').filter({ has: page.getByTestId('database-grid') });

      return navigated || (await dialog.isVisible());
    }, WIDGET_TIMEOUT)
    .toBe(true);
  await waitForDatabaseContext(page, target.databaseId);
  const grid = DatabaseGridSelectors.grid(page).filter({ hasText: 'Write launch plan' }).last();

  await expect(grid).toBeVisible(WIDGET_TIMEOUT);
});

Then(
  'dashboard row {int} has {int} widgets showing the {string} view',
  async ({ page }, rowIndex: number, count: number, label: string) => {
    const viewId = viewIdForLabel(page, label);

    await expect
      .poll(
        async () => (await persistedRow(page, rowIndex)).widgets.filter((widget) => widget.view_id === viewId).length
      )
      .toBe(count);
    const row = await persistedRow(page, rowIndex);

    await expect(DashboardSelectors.row(page, row.id).locator(`[data-view-id="${viewId}"]`)).toHaveCount(count);
  }
);

Then('every dashboard row spans {int} columns', async ({ page }, columns: number) => {
  const { rows } = await readDashboardSetting(page);

  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(
      row.widgets.reduce((sum, widget) => sum + widget.width, 0),
      `row ${row.id} widths ${row.widgets.map((widget) => widget.width).join(', ')}`
    ).toBe(columns);
  }
});

When(
  'I add the {string} view through the add button of dashboard row {int}',
  async ({ page }, label: string, rowIndex: number) => {
    const row = await persistedRow(page, rowIndex);

    await DashboardSelectors.row(page, row.id).hover();
    await openWidgetPicker(page, DashboardSelectors.addWidgetRowButton(page, row.id));
    await pickExistingView(page, viewIdForLabel(page, label));
  }
);

Then('dashboard row {int} holds {string}', async ({ page }, rowIndex: number, labels: string) => {
  const expected = splitList(labels);

  await expect
    .poll(async () => {
      const { rows } = await readDashboardSetting(page);
      const row = rows[rowIndex - 1];

      return row ? labelsOfRow(page, row) : [];
    }, WIDGET_TIMEOUT)
    .toEqual(expected);
  const row = await persistedRow(page, rowIndex);

  await expect
    .poll(async () => (await renderedRows(page))[rowIndex - 1])
    .toEqual(row.widgets.map((widget) => widget.id));
});

Then('the {string} widget is in dashboard row {int}', async ({ page }, label: string, rowIndex: number) => {
  const widgetId = knownWidget(page, label).id;

  await expect
    .poll(async () =>
      (await readDashboardSetting(page)).rows[rowIndex - 1]?.widgets.some((widget) => widget.id === widgetId)
    )
    .toBe(true);
  const row = await persistedRow(page, rowIndex);

  await expect(DashboardSelectors.row(page, row.id).locator(`[data-widget-id="${widgetId}"]`)).toBeVisible();
});

Then('the widths of dashboard row {int} are {string}', async ({ page }, rowIndex: number, widths: string) => {
  const expected = splitList(widths).map(Number);

  await expect
    .poll(async () => (await readDashboardSetting(page)).rows[rowIndex - 1]?.widgets.map((widget) => widget.width))
    .toEqual(expected);
});

Then('the dashboard has {int} rows', async ({ page }, count: number) => {
  await expect.poll(async () => (await readDashboardSetting(page)).rows.length).toBe(count);
  await expect(DashboardSelectors.rows(page)).toHaveCount(count);
});

Then('adding another widget is refused with the widget limit message', async ({ page }) => {
  const addButton = DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first();

  await expect(addButton).toBeVisible(WIDGET_TIMEOUT);
  await expect(addButton).toBeDisabled();
  await clickDisabledAddButton(addButton);
  await expectLimitMessage(page, 'dashboard', DASHBOARD_MAX_WIDGETS);
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
  // Every row add button is disabled too, whichever row it belongs to.
  const { rows } = await readDashboardSetting(page);

  for (const row of rows) {
    await DashboardSelectors.row(page, row.id).hover();
    await expect(DashboardSelectors.addWidgetRowButton(page, row.id)).toBeDisabled();
  }

  expect(allWidgets(await readDashboardSetting(page))).toHaveLength(DASHBOARD_MAX_WIDGETS);
});

Then('dashboard row {int} offers no add widget button', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);
  const button = DashboardSelectors.addWidgetRowButton(page, row.id);

  await DashboardSelectors.row(page, row.id).hover();
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await clickDisabledAddButton(button);
  await expectLimitMessage(page, 'row', DASHBOARD_MAX_WIDGETS_PER_ROW);
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
});

Then('dashboard row {int} offers an add widget button', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);
  const button = DashboardSelectors.addWidgetRowButton(page, row.id);

  await DashboardSelectors.row(page, row.id).hover();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
});

When('the {string} database is moved to the trash', async ({ page, request }, database: string) => {
  await trashFixtureDatabase(page, request, database);
});

When('I reload the dashboard', async ({ page }) => {
  await reloadDashboard(page);
});

Then('the {string} widget shows the {string} placeholder', async ({ page }, label: string, reason: string) => {
  const placeholder = widgetLocator(page, label).getByTestId('dashboard-widget-placeholder');

  await expect(placeholder).toHaveAttribute('data-reason', reason, WIDGET_TIMEOUT);
  await expect(placeholder).toContainText(
    reason === 'not-found' ? 'This view no longer exists' : "You don't have access to this database"
  );
});

When('I remove the {string} widget from its placeholder', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);

  await widget.getByTestId('dashboard-widget-remove-button').click();
  await expect(widget).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

Given('a workspace member with {string} access to the dashboard space', async ({ page, request }, access: string) => {
  if (access !== 'read-only' && access !== 'read-and-write') throw new Error(`Unknown access "${access}"`);
  await inviteDashboardMember(page, request, access);
});

When('the member opens the dashboard', async ({ page }) => {
  await openDashboardAsMember(page);
});

Then(
  'the member sees the {string} widget with the {string} placeholder',
  async ({ page }, label: string, reason: string) => {
    const member = memberPage(page);
    const widget = DashboardSelectors.widget(member, knownWidget(page, label).id);
    const placeholder = widget.getByTestId('dashboard-widget-placeholder');

    await expect(placeholder).toHaveAttribute('data-reason', reason, WIDGET_TIMEOUT);
    // The member cannot edit the layout, so the placeholder offers no removal.
    await expect(widget.getByTestId('dashboard-widget-remove-button')).toHaveCount(0);
    await expect(widget).not.toContainText('Salary review');
  }
);

Then('the member sees the {string} widget with {int} rows', async ({ page }, label: string, count: number) => {
  const widget = DashboardSelectors.widget(memberPage(page), knownWidget(page, label).id);

  await expect(gridDataRows(widget)).toHaveCount(count, WIDGET_TIMEOUT);
});

Then('the member sees the dashboard in View mode without the Edit button', async ({ page }) => {
  const member = memberPage(page);

  await expect(DashboardSelectors.view(member)).toBeVisible();
  await expect(DashboardSelectors.widgets(member).first()).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.editButton(member)).toHaveCount(0);
  await expect(DashboardSelectors.doneButton(member)).toHaveCount(0);
  await expect(DashboardSelectors.widthHandles(member)).toHaveCount(0);
  await expect(DashboardSelectors.addWidgetButton(member).filter({ visible: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Layout editing
// ---------------------------------------------------------------------------

When(
  'I drag the {string} widget onto the right side of the {string} widget',
  async ({ page }, source: string, target: string) => {
    await dragWidgetBeside(page, widgetLocator(page, source), widgetLocator(page, target), 'right');
  }
);

When(
  'I drag the {string} widget between dashboard rows {int} and {int}',
  async ({ page }, source: string, upper: number, lower: number) => {
    const upperRow = await persistedRow(page, upper);
    const lowerRow = await persistedRow(page, lower);

    await dragWidgetBetweenRows(page, widgetLocator(page, source), upperRow.id, lowerRow.id);
  }
);

When(
  'I drag width handle {int} of dashboard row {int} by {int} columns',
  async ({ page }, handle: number, rowIndex: number, columns: number) => {
    const row = await persistedRow(page, rowIndex);
    const columnWidth = await rowColumnWidth(page, row.id);

    await DashboardSelectors.row(page, row.id).hover();
    // Handle N sits between widget N and widget N + 1 (`data-index` is 0-based).
    await dragLocatorBy(page, DashboardSelectors.widthHandle(page, row.id, handle - 1), columns * columnWidth, 0);
  }
);

Then('the rendered widgets of dashboard row {int} follow their widths', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);

  await expect
    .poll(async () => {
      const boxes = await DashboardSelectors.row(page, row.id)
        .getByTestId('dashboard-widget')
        .evaluateAll((widgets) => widgets.map((widget) => widget.getBoundingClientRect().width));
      const total = boxes.reduce((sum, width) => sum + width, 0);

      return (
        boxes.length === row.widgets.length &&
        boxes.every((width, index) => Math.abs(width / total - row.widgets[index].width / DASHBOARD_GRID_COLUMNS) < 0.04)
      );
    })
    .toBe(true);
});

When(
  'I drag the height handle of dashboard row {int} down by {int} px',
  async ({ page }, rowIndex: number, pixels: number) => {
    const row = await persistedRow(page, rowIndex);

    await DashboardSelectors.row(page, row.id).hover();
    await dragLocatorBy(page, DashboardSelectors.heightHandle(page, row.id), 0, pixels);
  }
);

Then('dashboard row {int} is about {int} px tall', async ({ page }, rowIndex: number, height: number) => {
  await expect
    .poll(async () => Math.abs(((await readDashboardSetting(page)).rows[rowIndex - 1]?.height ?? 0) - height))
    .toBeLessThanOrEqual(24);
  const row = await persistedRow(page, rowIndex);
  const widget = DashboardSelectors.row(page, row.id).getByTestId('dashboard-widget').first();

  await expect
    .poll(async () => Math.abs(((await widget.boundingBox())?.height ?? 0) - row.height))
    .toBeLessThanOrEqual(32);
});

When('I wait for the dashboard layout to reach the server', async ({ page, request }) => {
  await waitForDashboardSync(page, request);
});

/**
 * History hotkeys act on the database scope that last received a pointerdown.
 * Widgets mount nested databases with their own scope, so point at the
 * dashboard surface itself (the host database) before pressing the shortcut.
 */
async function pressDashboardHistoryShortcut(page: Page, action: 'undo' | 'redo') {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await DashboardSelectors.view(page).dispatchEvent('pointerdown', { bubbles: true });
  await page.keyboard.press(action === 'undo' ? `${modifier}+z` : `${modifier}+Shift+z`);
}

When('I press the dashboard undo shortcut', async ({ page }) => {
  await pressDashboardHistoryShortcut(page, 'undo');
});

When('I press the dashboard redo shortcut', async ({ page }) => {
  await pressDashboardHistoryShortcut(page, 'redo');
});

When('the browser window is {int} px wide', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 900 });
});

async function rowWidgetBoxes(page: Page, rowIndex: number) {
  const row = await persistedRow(page, rowIndex);

  return DashboardSelectors.row(page, row.id)
    .getByTestId('dashboard-widget')
    .evaluateAll((widgets) =>
      widgets.map((widget) => {
        const rect = widget.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })
    );
}

Then('the widgets of dashboard row {int} are stacked', async ({ page }, rowIndex: number) => {
  await expect
    .poll(async () => {
      const boxes = await rowWidgetBoxes(page, rowIndex);
      const viewport = page.viewportSize()?.width ?? 0;

      return (
        boxes.length > 1 &&
        boxes.every((box, index) => index === 0 || box.y >= boxes[index - 1].y + boxes[index - 1].height - 1) &&
        boxes.every((box) => Math.abs(box.x - boxes[0].x) < 2 && box.width > viewport * 0.6)
      );
    })
    .toBe(true);
  // No horizontal page scroll on a narrow screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

Then('the widgets of dashboard row {int} are side by side', async ({ page }, rowIndex: number) => {
  await expect
    .poll(async () => {
      const boxes = await rowWidgetBoxes(page, rowIndex);

      return (
        boxes.length > 1 &&
        boxes.every((box, index) => index === 0 || (Math.abs(box.y - boxes[0].y) < 2 && box.x > boxes[index - 1].x))
      );
    })
    .toBe(true);
});

// ---------------------------------------------------------------------------
// Number chart
// ---------------------------------------------------------------------------

Given('the {string} chart is a Number chart using {string}', async ({ page }, database: string, aggregation: string) => {
  await configureNumberChart(page, database, aggregation);
});

Given(
  'the {string} chart is a Number chart using {string} of {string}',
  async ({ page }, database: string, aggregation: string, property: string) => {
    await configureNumberChart(page, database, aggregation, property);
  }
);

Then('the {string} widget shows the number {string}', async ({ page }, label: string, value: string) => {
  await expect(widgetLocator(page, label).getByTestId('number-chart-value')).toHaveText(value, WIDGET_TIMEOUT);
});

Then('the {string} widget shows a number starting with {string}', async ({ page }, label: string, prefix: string) => {
  await expect(widgetLocator(page, label).getByTestId('number-chart-value')).toHaveText(
    new RegExp(`^\\s*${prefix.replace('.', '\\.')}`),
    WIDGET_TIMEOUT
  );
});

Then('the {string} widget shows a number chart title', async ({ page }, label: string) => {
  const title = widgetLocator(page, label).getByTestId('number-chart-title');

  await expect(title).toBeVisible(WIDGET_TIMEOUT);
  await expect(title).not.toHaveText('');
});

Then('the {string} widget shows a number chart', async ({ page }, label: string) => {
  const chart = widgetLocator(page, label).getByTestId('number-chart');

  await expect(chart).toHaveAttribute('data-empty', 'false', WIDGET_TIMEOUT);
  await expect(chart.getByTestId('number-chart-value')).toHaveText('3');
});

Then('the {string} widget shows an empty number chart', async ({ page }, label: string) => {
  const chart = widgetLocator(page, label).getByTestId('number-chart');

  await expect(chart).toBeVisible(WIDGET_TIMEOUT);
  await expect(chart).toHaveAttribute('data-empty', 'true');
  await expect(chart).toContainText(/No rows to count|^\s*0\s*$/);
});

// ---------------------------------------------------------------------------
// Layout integration
// ---------------------------------------------------------------------------

Then('the {string} widget shows {int} timeline bars', async ({ page }, label: string, count: number) => {
  const widget = widgetLocator(page, label);

  await expect(widget.getByTestId('timeline-view')).toBeVisible(WIDGET_TIMEOUT);
  await expect(widget.locator('[data-testid^="timeline-bar-"]')).toHaveCount(count, WIDGET_TIMEOUT);
  for (const title of Object.keys(fixtureDatabase(page, 'Projects').rowIds)) {
    await expect(widget.locator('[data-testid^="timeline-bar-"]').filter({ hasText: title })).toHaveCount(1);
  }
});

function monthTitle(offset: number) {
  const date = new Date();

  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return date.toLocaleString('en-US', { month: 'long' });
}

When('I step the {string} widget to the next month', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);

  await expect(widget.getByTestId('calendar-title')).toContainText(monthTitle(0), WIDGET_TIMEOUT);
  await widget.getByTestId('calendar-next-button').click();
});

Then('the {string} widget title shows next month', async ({ page }, label: string) => {
  await expect(widgetLocator(page, label).getByTestId('calendar-title')).toContainText(monthTitle(1));
});

Then('the {string} widget title shows the current month', async ({ page }, label: string) => {
  await expect(widgetLocator(page, label).getByTestId('calendar-title')).toContainText(monthTitle(0));
});

When('I click Today in the {string} widget', async ({ page }, label: string) => {
  await widgetLocator(page, label).getByTestId('calendar-today-button').click();
});

function chartBars(page: Page, label: string) {
  return widgetLocator(page, label).locator('.recharts-bar-rectangle path');
}

Then('the {string} widget draws {int} bar(s)', async ({ page }, label: string, count: number) => {
  await expect(widgetLocator(page, label).locator('.recharts-wrapper')).toBeVisible(WIDGET_TIMEOUT);
  await expect(chartBars(page, label)).toHaveCount(count, WIDGET_TIMEOUT);
});

When('I click the first bar of the {string} widget', async ({ page }, label: string) => {
  const bar = chartBars(page, label).first();

  await expect(bar).toBeVisible(WIDGET_TIMEOUT);
  await bar.click();
});

Then('a drill-down lists exactly one of {string}', async ({ page }, titles: string) => {
  const dialog = page.getByRole('dialog').last();

  await expect(dialog).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(async () => {
      const text = (await dialog.textContent()) ?? '';

      return splitList(titles).filter((title) => text.includes(title)).length;
    })
    .toBe(1);
  // The drill-down is an overlay; the dashboard stays underneath.
  await expect(DashboardSelectors.view(page)).toBeAttached();
});

When('I open the {string} row from the {string} widget', async ({ page }, title: string, label: string) => {
  const widget = widgetLocator(page, label);
  const rowId = fixtureDatabase(page, parseViewLabel(label).database).rowIds[title];
  const row = widget.getByTestId(`grid-row-${rowId}`);

  await expect(row).toBeVisible(WIDGET_TIMEOUT);
  await row.hover();
  const expand = widget.getByTestId('row-expand-button').first();

  await expect(expand).toBeVisible();
  await expand.click();
});

Then('the row page for {string} is open', async ({ page }, title: string) => {
  await expect(page.locator('.MuiDialog-paper, [role="dialog"]').filter({ hasText: title }).last()).toBeVisible(
    WIDGET_TIMEOUT
  );
});

When('I close the row page', async ({ page }) => {
  await closeRowDetailWithEscape(page);
});

// ---------------------------------------------------------------------------
// Board widgets
// ---------------------------------------------------------------------------

Then('the {string} widget shows {int} card(s)', async ({ page }, label: string, count: number) => {
  const widget = widgetLocator(page, label);

  await expect(widget.getByTestId('board-column').first()).toBeVisible(WIDGET_TIMEOUT);
  await expect(widget.locator('.board-card')).toHaveCount(count, WIDGET_TIMEOUT);
});

Then(
  'the {string} column of the {string} widget shows {int} card(s)',
  async ({ page }, column: string, label: string, count: number) => {
    const widget = widgetLocator(page, label);
    const columnLocator = widget
      .getByTestId('board-column')
      .filter({ has: page.getByTestId('board-column-name').getByText(column, { exact: true }) });

    await expect(columnLocator.locator('.board-card')).toHaveCount(count, WIDGET_TIMEOUT);
  }
);
