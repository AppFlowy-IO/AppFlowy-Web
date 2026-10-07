import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import { expectAnnounced, expectNoLimitBanner } from '../../support/dashboard-limits-helpers';
import {
  readDatabaseViews as readOwnedDatabaseViews,
  switchViewToDashboard,
} from '../../support/dashboard-owned-views-helpers';
import { dashboardEditOffered, expectDashboardViewMode } from '../../support/dashboard-platform-helpers';
import { pressEscapeUntilHidden, WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  addFixtureDatabase,
  addViewThroughTabs,
  allWidgets,
  chooseWidgetMenuAction,
  cleanupDashboardFixture,
  configureNumberChart,
  DASHBOARD_FIXTURE_DATABASES,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardSelectors,
  dashboardSidebarEntry,
  dashboardViewId,
  dashboardWorld,
  databaseForLabel,
  dragLocatorBy,
  dragWidgetBeside,
  dragWidgetBetweenRows,
  dragWidthHandle,
  enterEditMode,
  expectDashboardMode,
  expectGridWidgetRows,
  expectRowHeight,
  expectRowWidths,
  expectWidgetCount,
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
  openWidgetRow,
  parseViewLabel,
  persistedRow,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  readViewConditions,
  readDatabaseViews,
  reloadDashboard,
  renderedRows,
  seedDashboardWidgets,
  splitList,
  trashFixtureDatabase,
  viewIdForLabel,
  waitForDashboardSync,
  waitForDatabaseContext,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { boardColumn, expectMemberViewMode, expectRowPage } from '../../support/dashboard-usecase-helpers';
import { restoreEmployeeCells } from '../../support/employees-database';
import { selectFilterOption } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  EditorSelectors,
  SlashCommandSelectors,
} from '../../support/selectors';

const { Given, When, Then, Before, After } = createBdd();

Before({ tags: '@dashboard' }, async ({ page, $testInfo }) => {
  // API fixtures, several database pages and cross-database widgets need room.
  $testInfo.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
});

After({ tags: '@dashboard' }, async ({ page, request }) => {
  try {
    await restoreEmployeeCells(page);
  } finally {
    await cleanupDashboardFixture(page, request);
  }
});

/** Make sure the dashboard (and so the host database doc) is mounted before seeding it. */
async function ensureDashboardOpen(page: Page) {
  if (await DashboardSelectors.view(page).isVisible()) return;
  await openDashboard(page);
}

/**
 * A refused add button is `aria-disabled`, not disabled: it keeps the pointer
 * events, so the press reaches it and is announced (never a banner).
 * Playwright treats an aria-disabled button as not enabled, so the press
 * skips its actionability wait.
 */
async function clickDisabledAddButton(button: Locator) {
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.click({ force: true });
}

// ---------------------------------------------------------------------------
// Fixture and creation
// ---------------------------------------------------------------------------

Given('the dashboard fixture workspace is ready', async ({ page, request }) => {
  await prepareDashboardFixture(page, request);
});

// ---------------------------------------------------------------------------
// Slash menu: a new dashboard, or a linked dashboard, inside a document.
// ---------------------------------------------------------------------------

const documentViewIds = new WeakMap<Page, string>();

function documentViewId(page: Page) {
  const viewId = documentViewIds.get(page);

  if (!viewId) throw new Error('No document is being edited');
  return viewId;
}

function dashboardBlock(page: Page) {
  return page.locator(`#editor-${documentViewId(page)} [data-block-type="dashboard"]`);
}

Given('I am editing a new document in the fixture workspace', async ({ page }) => {
  documentViewIds.set(page, await createDocumentPageAndNavigate(page));
});

When('I insert a Dashboard through the slash menu', async ({ page }) => {
  const editor = EditorSelectors.firstEditor(page);

  await editor.click({ force: true });
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('slash-menu-dashboard').click();
});

Then('the dashboard opens in the page modal', async ({ page }) => {
  const dialog = page.locator('[role="dialog"]').last();

  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId('dashboard-view')).toBeVisible({ timeout: 30_000 });
});

When('I close the dashboard page modal', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
});

Then('the document contains a dashboard block', async ({ page }) => {
  const block = dashboardBlock(page);

  await expect(block).toHaveCount(1, { timeout: 15_000 });
  await expect(block.getByTestId('dashboard-view')).toBeVisible({ timeout: 30_000 });
});

When('I link the {string} database as a dashboard through the slash menu', async ({ page }, name: string) => {
  await insertLinkedDatabaseViaSlash(page, documentViewId(page), name, 'Dashboard');
});

Then('the document contains a dashboard block titled {string}', async ({ page }, title: string) => {
  const block = dashboardBlock(page);

  await expect(block).toHaveCount(1, { timeout: 15_000 });
  await expect(block.getByTestId('dashboard-view')).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText(title);
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
  // Converting creates the view's owned copy first (WP05 §1.6): this waits for
  // the layout and for that copy as the one widget, and records the copy.
  await switchViewToDashboard(page, parseViewLabel(label).database, viewIdForLabel(page, label));
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
  // No Edit button either while Edit mode cannot be entered (WP14a).
  await expectDashboardViewMode(page);
});

Then('the dashboard shows width handles', async ({ page }) => {
  await expect(DashboardSelectors.widthHandles(page).first()).toBeAttached();
});

// WP06 §1.9: the edit placeholder widget with its "+ New view" pill, without a border.
Then('the dashboard shows its edit-mode empty state with a New view button', async ({ page }) => {
  const empty = DashboardSelectors.emptyState(page);

  await expect(empty).toBeVisible();
  await expect(empty).toHaveAttribute('data-editing', 'true');
  await expect(DashboardSelectors.emptyPlaceholder(page)).toBeVisible();
  await expect(DashboardSelectors.emptyNewViewButton(page)).toBeEnabled();
  expect(await empty.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
});

Then('the dashboard empty state reads {string}', async ({ page }, text: string) => {
  const empty = DashboardSelectors.emptyState(page);

  await expect(empty).toBeVisible();
  await expect(empty).toContainText(text);
  await expect(DashboardSelectors.emptyNewViewButton(page)).toHaveCount(0);
  // Writers who can enter Edit mode get "Edit dashboard": expected from the test's own access
  // state, not from the toolbar (a regression hiding both buttons would otherwise pass).
  await expect(DashboardSelectors.emptyEditDashboardButton(page)).toHaveCount(dashboardEditOffered(page) ? 1 : 0);
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

// Like desktop, the sidebar marks every view under a database page with a dot
// rather than its layout icon; the layout icon lives on the view tab.
Then('the dashboard is listed in the sidebar under its database', async ({ page }) => {
  const entry = await dashboardSidebarEntry(page);

  await expect(entry).toBeVisible(WIDGET_TIMEOUT);
  await expect(entry.getByTestId('database-view-dot')).toBeVisible();
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
  // The fixture databases of the scenario (the add-widget scenarios only prepare Projects).
  const databases = ['Projects', 'Tasks', 'Notes'].filter((name) => dashboardWorld(page).databases[name]);
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

    // WP06: "+" already created the widget's own view (counted by `openWidgetPicker`).
    if (target.databaseId === hostDatabase(page).databaseId) {
      // A New view type turns that view into this layout in place; the dock is closed afterwards.
      await DashboardSelectors.pickerLayoutOption(page, layout).click();
      await expect(DashboardSelectors.newViewPanel(page)).toBeVisible(WIDGET_TIMEOUT);
      await expect(DashboardSelectors.newViewTile(page, layout)).toHaveAttribute('data-selected', 'true');
      await page.getByTestId('dashboard-widget-new-view-panel-close').click();
      await expect(DashboardSelectors.newViewPanel(page)).toHaveCount(0, WIDGET_TIMEOUT);
      return;
    }

    // Another database: Other data sources › New view in {database} › the layout.
    world.viewCountBefore = (await readDatabaseViews(page, target.databaseId)).length;
    await DashboardSelectors.pickerOtherSources(page).click();
    await DashboardSelectors.pickerNewInDatabase(page, target.databaseId).click();
    await DashboardSelectors.pickerLayoutOption(page, layout).click();
    await expect(DashboardSelectors.picker(page)).toBeHidden(WIDGET_TIMEOUT);
  }
);

Then('the dashboard shows {int} widget(s)', async ({ page }, count: number) => {
  await expectWidgetCount(page, count);
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
  // WP05: named after its layout ("Board", then "Board (1)") and owned by the dashboard.
  const created = async () =>
    (await readOwnedDatabaseViews(page, target.databaseId)).find((view) => view.id === newViewId);

  await expect
    .poll(async () => (await created())?.name, WIDGET_TIMEOUT)
    .toMatch(new RegExp(`^${layoutName}( \\(\\d+\\))?$`));
  await expect.poll(async () => (await created())?.dashboardOwner, WIDGET_TIMEOUT).toBe(dashboardViewId(page));
});

Then('the new board widget shows the {string} column', async ({ page }, column: string) => {
  await expect(boardColumn(widgetLocator(page, 'Projects Board'), column)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the {string} widget header shows its view name', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);
  const { database } = parseViewLabel(label);
  const databaseId = fixtureDatabase(page, database).databaseId;
  const viewId = viewIdForLabel(page, label);
  const title = widget.getByTestId('dashboard-widget-header').getByTestId('dashboard-widget-title');
  let name = '';

  // The view must be there to compare with: a view that never mounts fails here.
  await expect
    .poll(
      async () => {
        name = (await readDatabaseViews(page, databaseId)).find((view) => view.id === viewId)?.name ?? '';
        return name;
      },
      { ...WIDGET_TIMEOUT, message: `the "${label}" view is not mounted or has no name` }
    )
    .not.toBe('');
  await expect(title).toBeVisible(WIDGET_TIMEOUT);
  await expect(title).not.toHaveText('');
  await expect(title).toContainText(name);
});

When('I choose {string} in the {string} widget menu', async ({ page }, action: string, label: string) => {
  const before = await readDashboardSetting(page);

  await chooseWidgetMenuAction(page, widgetLocator(page, label), action as Parameters<typeof chooseWidgetMenuAction>[2]);
  // Navigating to the data source or opening the settings host writes no layout.
  if (action !== 'view-data-source' && action !== 'edit-view') {
    await expect
      .poll(async () => JSON.stringify((await readDashboardSetting(page)).rows))
      .not.toBe(JSON.stringify(before.rows));
  }
});

Then('the {string} view is open outside the dashboard', async ({ page }, label: string) => {
  // A label ("Tasks Grid") or a view known by its name ("Grid" of the dashboard host).
  const database = databaseForLabel(page, label);
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
  // The grid shows the fixture's first row, or (a use-case database, whose rows the scenario
  // seeded) any of its rows: the open view may filter the first one out.
  const fixtureTitle = DASHBOARD_FIXTURE_DATABASES[database]?.rows[0]?.Name;
  const seededTitles = Object.keys(target.rowIds);
  const anyTitle =
    fixtureTitle !== undefined || seededTitles.length === 0
      ? String(fixtureTitle ?? 'Write launch plan')
      : new RegExp(seededTitles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
  const grid = DatabaseGridSelectors.grid(page).filter({ hasText: anyTitle }).last();

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

When('I move dashboard row {int} up', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);

  await DashboardSelectors.row(page, row.id).hover();
  await page.locator(`[data-testid="dashboard-row-move-up"][data-row-id="${row.id}"]`).click();
  await expect.poll(async () => (await readDashboardSetting(page)).rows[rowIndex - 2]?.id).toBe(row.id);
});

When('I move dashboard row {int} down', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);

  await DashboardSelectors.row(page, row.id).hover();
  await page.locator(`[data-testid="dashboard-row-move-down"][data-row-id="${row.id}"]`).click();
  await expect.poll(async () => (await readDashboardSetting(page)).rows[rowIndex]?.id).toBe(row.id);
});

/** Row labels, a view the scenario did not name (a duplicate's copy) by "<Database> <view name>". */
async function rowLabels(page: Page, rowIndex: number) {
  const { rows } = await readDashboardSetting(page);
  const row = rows[rowIndex - 1];

  if (!row) return [];
  const labels = labelsOfRow(page, row);

  return Promise.all(
    labels.map(async (label, index) => {
      if (!label.startsWith('?')) return label;
      const widget = row.widgets[index];
      const database = Object.values(dashboardWorld(page).databases).find(
        (candidate) => candidate.databaseId === widget.database_id
      );
      const name = (await readDatabaseViews(page, widget.database_id)).find((view) => view.id === widget.view_id)?.name;

      return database && name ? `${database.name} ${name}` : label;
    })
  );
}

Then('dashboard row {int} holds {string}', async ({ page }, rowIndex: number, labels: string) => {
  const expected = splitList(labels);

  await expect.poll(() => rowLabels(page, rowIndex), WIDGET_TIMEOUT).toEqual(expected);
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
  await expectRowWidths(page, rowIndex, splitList(widths).map(Number));
});

Then('the dashboard has {int} rows', async ({ page }, count: number) => {
  await expect.poll(async () => (await readDashboardSetting(page)).rows.length).toBe(count);
  await expect(DashboardSelectors.rows(page)).toHaveCount(count);
});

Then('adding another widget is refused with the Dashboard is full tooltip', async ({ page }) => {
  const addButton = DashboardSelectors.grid(page).getByTestId('dashboard-add-widget-button');

  await expect(addButton).toBeVisible(WIDGET_TIMEOUT);
  await expect(addButton).toHaveAttribute('aria-disabled', 'true');
  await addButton.hover();
  const tooltip = page.getByTestId('dashboard-full-tooltip');

  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Dashboard is full');
  await expect(tooltip).toContainText('Delete a view to add a new one');
  const viewsBefore = (await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id).sort();

  await clickDisabledAddButton(addButton);
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
  await expect(DashboardSelectors.pendingWidget(page)).toHaveCount(0);
  await expectNoLimitBanner(page);
  // WP06 #16: a refused add creates no view.
  expect((await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id).sort()).toEqual(
    viewsBefore
  );
  // Every row is full (4 widgets): none offers "Add to row".
  const { rows } = await readDashboardSetting(page);

  for (const row of rows) {
    expect(row.widgets).toHaveLength(DASHBOARD_MAX_WIDGETS_PER_ROW);
    await DashboardSelectors.row(page, row.id).hover();
    await expect(DashboardSelectors.addWidgetRowButton(page, row.id)).toHaveCount(0);
  }

  expect(allWidgets(await readDashboardSetting(page))).toHaveLength(DASHBOARD_MAX_WIDGETS);
});

Then('dashboard row {int} offers no add widget button', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);

  await DashboardSelectors.row(page, row.id).hover();
  // A full row hides its "+" (Notion): nothing to press, no banner.
  await expect(DashboardSelectors.addWidgetRowButton(page, row.id)).toHaveCount(0);
});

Then('dashboard row {int} offers an add widget button', async ({ page }, rowIndex: number) => {
  const row = await persistedRow(page, rowIndex);
  const button = DashboardSelectors.addWidgetRowButton(page, row.id);

  await DashboardSelectors.row(page, row.id).hover();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
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

// ---------------------------------------------------------------------------
// A widget's own filters in View mode (local to the viewer until saved).
// ---------------------------------------------------------------------------

async function addWidgetSelectFilter(scope: Page, widget: Locator, field: string, option: string) {
  await widget.hover();
  const filterButton = widget.getByTestId('database-actions-filter');

  await expect(filterButton).toBeVisible(WIDGET_TIMEOUT);
  // With no filter yet, the button opens the property list straight away.
  await filterButton.click();
  const property = DatabaseFilterSelectors.propertyItemByName(scope, field);

  await expect(property).toBeVisible({ timeout: 10_000 });
  await property.click();
  await selectFilterOption(scope, option);
  // Close the rule editor, then the widget's Filters popover it opened in.
  await pressEscapeUntilHidden(scope, scope.getByTestId('dashboard-widget-filters-popover'));
}

When(
  'I add a {string} is {string} filter inside the {string} widget',
  async ({ page }, field: string, option: string, label: string) => {
    await addWidgetSelectFilter(page, DashboardSelectors.widget(page, knownWidget(page, label).id), field, option);
  }
);

When(
  'the member adds a {string} is {string} filter inside the {string} widget',
  async ({ page }, field: string, option: string, label: string) => {
    const member = memberPage(page);

    await addWidgetSelectFilter(member, DashboardSelectors.widget(member, knownWidget(page, label).id), field, option);
  }
);

Then('I see the {string} widget with {int} rows', async ({ page }, label: string, count: number) => {
  const widget = DashboardSelectors.widget(page, knownWidget(page, label).id);

  await expect(gridDataRows(widget)).toHaveCount(count, WIDGET_TIMEOUT);
});

// Something differs from the saved dashboard (WP07): an orange dot, and Reset in the filter bar.
Then('the dashboard shows unsaved changes', async ({ page }) => {
  await expect(DashboardSelectors.unsavedDots(page).first()).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.privateControls(page)).toBeVisible();
  await expect(DashboardSelectors.globalFilterReset(page)).toBeVisible();
});

Then('the {string} view has {int} saved filters', async ({ page }, label: string, count: number) => {
  const viewId = viewIdForLabel(page, label);

  await expect.poll(async () => (await readViewConditions(page, viewId)).filters.length, WIDGET_TIMEOUT).toBe(count);
});

Then('the member sees the {string} widget with {int} rows', async ({ page }, label: string, count: number) => {
  const widget = DashboardSelectors.widget(memberPage(page), knownWidget(page, label).id);

  await expect(gridDataRows(widget)).toHaveCount(count, WIDGET_TIMEOUT);
});

Then('the member sees the dashboard in View mode without the Edit button', async ({ page }) => {
  await expectMemberViewMode(page);
});

// ---------------------------------------------------------------------------
// Layout editing
// ---------------------------------------------------------------------------

When(
  'I drag the {string} widget onto the right side of the {string} widget',
  async ({ page }, source: string, target: string) => {
    await dragWidgetBeside(page, widgetLocator(page, source), widgetLocator(page, target), 'right');
    // The drop has been handled, and any layout write made, once the dashboard stops dragging
    // (useDashboardDnd clears the drag and moves the widget in one handler): a refused drop must
    // not pass early.
    await expect(DashboardSelectors.view(page)).not.toHaveAttribute('data-dragging', 'true', WIDGET_TIMEOUT);
  }
);

// A refusal is told to assistive technology only (never a banner): the live region's text.
Then('the refusal {string} was announced', async ({ page }, text: string) => {
  await expectAnnounced(page, text);
});

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
    await dragWidthHandle(page, rowIndex, handle, columns);
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

// "About": a drag snaps the stored height, so it may land within one snap step of the target.
Then('dashboard row {int} is about {int} px tall', async ({ page }, rowIndex: number, height: number) => {
  await expectRowHeight(page, rowIndex, height, { storedTolerance: 24, renderedTolerance: 32 });
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

  // WP11: only "No data", without a caption or a value.
  await expect(chart).toBeVisible(WIDGET_TIMEOUT);
  await expect(chart).toHaveAttribute('data-empty', 'true');
  await expect(chart.getByTestId('number-chart-empty')).toHaveText('No data');
  await expect(chart.getByTestId('number-chart-title')).toHaveCount(0);
  await expect(chart.getByTestId('number-chart-value')).toHaveCount(0);
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
  // The chart drill-down itself: a record's side peek is a dialog too (WP13).
  const dialog = page.getByTestId('chart-drilldown');

  await expect(dialog).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(async () => {
      const listed = (await dialog.getByTestId('drill-row-title').allTextContents()).map((title) => title.trim());

      return splitList(titles).filter((title) => listed.includes(title)).length;
    })
    .toBe(1);
  // The drill-down is an overlay; the dashboard stays underneath.
  await expect(DashboardSelectors.view(page)).toBeAttached();
});

When('I open the {string} row from the {string} widget', async ({ page }, title: string, label: string) => {
  const rowId = fixtureDatabase(page, databaseForLabel(page, label)).rowIds[title];

  expect(rowId, `no "${title}" row behind the "${label}" widget`).toBeTruthy();
  await openWidgetRow(page, widgetLocator(page, label), rowId);
});

Then('the row page for {string} is open', async ({ page }, title: string) => {
  // A row page carries the row title editor (a chart drill-down lists the title too).
  await expectRowPage(page, title);
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
    await expect(boardColumn(widgetLocator(page, label), column).locator('.board-card')).toHaveCount(
      count,
      WIDGET_TIMEOUT
    );
  }
);
