import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  chooseNewViewType,
  closeDockedPicker,
  expectedNewViewTypes,
  layoutOf,
  newWidget,
  newWidgetRecord,
  pickerNewViewTypes,
  readChartMap,
  refuseChartViewCreation,
  viewsOwnedBy,
} from '../../support/dashboard-add-widget-helpers';
import { WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  addFixtureDatabase,
  allWidgets,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  expectDashboardMode,
  fixtureDatabase,
  hostDatabase,
  lastPickerWidget,
  leaveEditMode,
  openDashboard,
  openWidgetPicker,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  readDatabaseViews,
  seedDashboardWidgets,
  splitList,
} from '../../support/dashboard-test-helpers';

/**
 * WP06 add-widget flow (`dashboard-add-widget.feature`). The wording is
 * identical on desktop (`dashboard_add_widget_cloud.feature`,
 * `dashboard_add_widget_local.feature`).
 */
const { Given, When, Then } = createBdd();

const ADD_WIDGET_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../src/application/database-yjs/__fixtures__/dashboard-parity/add-widget.json', import.meta.url)
    ),
    'utf8'
  )
) as { default_number_chart: { required: Record<string, unknown> } };

/** The views of the host database before an add was tried. */
const viewsBefore = new WeakMap<Page, string[]>();

async function hostViewIds(page: Page) {
  return (await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id).sort();
}

/** The persisted widget's view id and the DOM box agree. */
async function expectNewWidgetView(page: Page, viewId: string) {
  await expect.poll(async () => (await newWidgetRecord(page)).view_id, WIDGET_TIMEOUT).toBe(viewId);
  await expect(newWidget(page)).toHaveAttribute('data-view-id', viewId, WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

Given(
  'a {string} database with {int} rows and an empty dashboard open in Edit mode',
  async ({ page, request }, database: string, rows: number) => {
    await prepareDashboardFixture(page, request, [database]);
    const fixture = fixtureDatabase(page, database);

    await expect
      .poll(
        async () =>
          (
            await readDatabaseViews(page, fixture.databaseId, { rowIds: true })
          ).find((view) => view.id === fixture.views.Grid)?.rowIds?.length,
        WIDGET_TIMEOUT
      )
      .toBe(rows);
    await addDashboardView(page, database);
    await expectDashboardMode(page, 'Edit');
  }
);

Given('a {string} database with {int} rows', async ({ page, request }, database: string, rows: number) => {
  await addFixtureDatabase(page, request, database, {
    fields: [],
    rows: Array.from({ length: rows }, (_, index) => ({ Name: `${database} row ${index + 1}` })),
  });
  await openDashboard(page);
});

Given(
  'the {string} database also has the views {string}',
  async ({ page, request }, database: string, names: string) => {
    let prevViewId: string | undefined;

    for (const name of splitList(names)) {
      prevViewId = await createDatabaseViewThroughApi(page, request, { database, name, folderLayout: 1, prevViewId });
    }

    await openDashboard(page);
  }
);

Given(
  'the dashboard shows the {string} view of {string} in row {int}',
  async ({ page }, layout: string, database: string, row: number) => {
    await seedDashboardWidgets(page, [{ row, label: `${database} ${layout}` }]);
  }
);

Given('chart views cannot be created in this workspace', async ({ page }) => {
  await refuseChartViewCreation(page);
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

When('the user clicks {string} in the empty dashboard', async ({ page }, label: string) => {
  const pill = DashboardSelectors.emptyNewViewButton(page);

  await expect(pill).toHaveText(label);
  await openWidgetPicker(page, pill);
});

When('the user clicks the add button of dashboard row {int}', async ({ page }, rowIndex: number) => {
  const row = DashboardSelectors.rows(page).nth(rowIndex - 1);
  const rowId = (await row.getAttribute('data-row-id')) ?? '';

  await row.hover();
  await openWidgetPicker(page, DashboardSelectors.addWidgetRowButton(page, rowId));
});

When('the user closes the {string} picker', async ({ page }, _title: string) => {
  await closeDockedPicker(page);
});

When('the user presses Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('the user picks the {string} view in the {string} picker', async ({ page }, layout: string, _title: string) => {
  const viewId = hostDatabase(page).views[layout];

  if (!viewId) throw new Error(`The dashboard's database has no ${layout} view`);
  await pickExistingView(page, viewId);
});

When(
  'the user chooses the new view type {string} in the {string} picker',
  async ({ page }, layout: string, _title: string) => {
    await chooseNewViewType(page, layout);
  }
);

When('the user clicks {string}', async ({ page }, label: string) => {
  if (label === 'Edit chart') {
    await DashboardSelectors.editChartButton(page).click();
    return;
  }

  if (label === 'Edit dashboard') {
    await DashboardSelectors.emptyEditDashboardButton(page).click();
    return;
  }

  if (/^Show \d+ more$/.test(label)) {
    await DashboardSelectors.pickerShowMore(page).filter({ hasText: label }).click();
    return;
  }

  throw new Error(`No dashboard control is called "${label}"`);
});

When('the user clicks the dashboard Done button', async ({ page }) => {
  await leaveEditMode(page);
});

When('the user types {string} in the {string} picker search', async ({ page }, text: string, _title: string) => {
  await DashboardSelectors.pickerSearch(page).fill(text);
});

When('the user tries to add a widget from the add button under the last row', async ({ page }) => {
  viewsBefore.set(page, await hostViewIds(page));
  const button = DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first();

  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled, not disabled: the click still reaches the button, which explains the refusal.
  await button.click({ force: true });
});

// ---------------------------------------------------------------------------
// The empty dashboard
// ---------------------------------------------------------------------------

Then(
  'the empty dashboard shows a placeholder widget with {int} view icons and a {string} button',
  async ({ page }, icons: number, label: string) => {
    const empty = DashboardSelectors.emptyState(page);

    await expect(empty).toHaveAttribute('data-editing', 'true', WIDGET_TIMEOUT);
    await expect(DashboardSelectors.emptyPlaceholder(page)).toBeVisible();
    await expect(empty.getByTestId('dashboard-empty-type-icon')).toHaveCount(icons);
    await expect(DashboardSelectors.emptyNewViewButton(page)).toHaveText(label);
  }
);

Then('the empty dashboard shows no border and no {string} button', async ({ page }, label: string) => {
  const empty = DashboardSelectors.emptyState(page);

  await expect(empty).toBeVisible(WIDGET_TIMEOUT);
  expect(await empty.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const button =
    label === 'Edit dashboard'
      ? DashboardSelectors.emptyEditDashboardButton(page)
      : DashboardSelectors.emptyNewViewButton(page);

  await expect(button).toHaveCount(0);
});

Then(
  'the empty dashboard reads {string} above an {string} button and its illustration',
  async ({ page }, text: string, label: string) => {
    const empty = DashboardSelectors.emptyState(page);

    await expect(empty).toHaveAttribute('data-editing', 'false', WIDGET_TIMEOUT);
    const textLine = empty.getByText(text, { exact: true });
    const button = DashboardSelectors.emptyEditDashboardButton(page);
    const illustration = DashboardSelectors.emptyIllustration(page);

    await expect(textLine).toBeVisible();
    await expect(button).toHaveText(label);
    await expect(illustration).toBeVisible();
    const [textBox, buttonBox, illustrationBox] = await Promise.all([
      textLine.boundingBox(),
      button.boundingBox(),
      illustration.boundingBox(),
    ]);

    expect(textBox && buttonBox && illustrationBox).toBeTruthy();
    expect((textBox?.y ?? 0) < (buttonBox?.y ?? 0)).toBe(true);
    expect((buttonBox?.y ?? 0) < (illustrationBox?.y ?? 0)).toBe(true);
  }
);

// ---------------------------------------------------------------------------
// The new widget
// ---------------------------------------------------------------------------

Then('the new widget is selected', async ({ page }) => {
  await expect(newWidget(page)).toHaveAttribute('data-selected', 'true', WIDGET_TIMEOUT);
});

Then('no dashboard widget is selected', async ({ page }) => {
  await expect(page.locator('[data-testid="dashboard-widget"][data-selected="true"]')).toHaveCount(0);
});

Then('the new widget is titled {string}', async ({ page }, title: string) => {
  await expect(newWidget(page).getByTestId('dashboard-widget-title')).toHaveText(title, WIDGET_TIMEOUT);
});

Then(
  'the new widget shows the number {string} with the caption {string}',
  async ({ page }, value: string, caption: string) => {
    const widget = newWidget(page);

    await expect(widget.getByTestId('number-chart-value')).toHaveText(value, { timeout: WIDGET_TIMEOUT_MS * 2 });
    await expect(widget.getByTestId('number-chart-title')).toHaveText(caption);
  }
);

Then("the new widget's chart is saved as a compact Count all Number chart", async ({ page }) => {
  const { view_id: viewId, database_id: databaseId } = await newWidgetRecord(page);

  await expect
    .poll(async () => {
      const chart = (await readChartMap(page, databaseId, viewId)) ?? {};

      return Object.fromEntries(
        Object.keys(ADD_WIDGET_FIXTURE.default_number_chart.required).map((key) => [key, chart[key]])
      );
    }, WIDGET_TIMEOUT)
    .toEqual(ADD_WIDGET_FIXTURE.default_number_chart.required);
});

Then('the new widget shows the {string} view of {string}', async ({ page }, layout: string, database: string) => {
  await expectNewWidgetView(page, fixtureDatabase(page, database).views[layout]);
});

Then('the new widget shows a {string} view of {string}', async ({ page }, layout: string, database: string) => {
  const target = fixtureDatabase(page, database);

  await expect
    .poll(async () => {
      const { view_id: viewId } = await newWidgetRecord(page);

      return (await readDatabaseViews(page, target.databaseId)).find((view) => view.id === viewId)?.layout;
    }, WIDGET_TIMEOUT)
    .toBe(layoutOf(layout));
});

Then(
  'the new widget shows the {string} view of {string} as a table',
  async ({ page }, name: string, database: string) => {
    const target = fixtureDatabase(page, database);
    const { view_id: viewId } = await newWidgetRecord(page);
    const view = (await readDatabaseViews(page, target.databaseId)).find((candidate) => candidate.id === viewId);

    expect(view?.name).toBe(name);
    expect(view?.layout).toBe(layoutOf('Grid'));
    await expect(newWidget(page).getByTestId('database-grid')).toBeVisible(WIDGET_TIMEOUT);
  }
);

Then('the second widget of dashboard row {int} is the selected Count all widget', async ({ page }, rowIndex: number) => {
  const { widgetId } = lastPickerWidget(page);
  const row = (await readDashboardSetting(page)).rows[rowIndex - 1];

  expect(row?.widgets[1]?.id).toBe(widgetId);
  await expect(newWidget(page)).toHaveAttribute('data-selected', 'true');
  const chart = await readChartMap(page, row.widgets[1].database_id, row.widgets[1].view_id);

  expect(chart?.chart_type).toBe(4);
  expect(chart?.aggregation_type).toBe(0);
});

// ---------------------------------------------------------------------------
// The docked picker
// ---------------------------------------------------------------------------

Then('the {string} picker is open beside the new widget with its search focused', async ({ page }, title: string) => {
  const picker = DashboardSelectors.picker(page);
  const { widgetId } = lastPickerWidget(page);

  await expect(picker).toHaveAttribute('data-state', 'ready', WIDGET_TIMEOUT);
  await expect(picker).toHaveAttribute('data-widget-id', widgetId);
  await expect(picker.locator('[data-parity-id="dash-widget-picker__title"]')).toHaveText(title);
  await expect(DashboardSelectors.pickerSearch(page)).toBeFocused();
  const side = await picker.getAttribute('data-side');
  const [pickerBox, widgetBox] = await Promise.all([picker.boundingBox(), newWidget(page).boundingBox()]);

  expect(pickerBox && widgetBox).toBeTruthy();
  if (!pickerBox || !widgetBox) return;
  // Docked at the box's top-right corner: 8px to its right, or overlapping its right part (WP06 §1.6).
  if (side === 'right') expect(Math.abs(pickerBox.x - (widgetBox.x + widgetBox.width + 8))).toBeLessThanOrEqual(1);
  else expect(Math.abs(pickerBox.x + pickerBox.width - (widgetBox.x + widgetBox.width - 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(pickerBox.y - widgetBox.y)).toBeLessThanOrEqual(1);
});

Then('the picker lists {string} before the new view types', async ({ page }, title: string) => {
  const host = DashboardSelectors.pickerSection(page, 'host');
  const sections = await page
    .getByTestId('dashboard-widget-picker-section')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section')));

  await expect(host.getByTestId('dashboard-widget-picker-section-title')).toHaveText(title);
  expect(sections.indexOf('host')).toBeLessThan(sections.indexOf('new'));
});

Then("the picker's new view types are {string}", async ({ page }, labels: string) => {
  const expected = expectedNewViewTypes(splitList(labels));

  await expect.poll(() => pickerNewViewTypes(page), WIDGET_TIMEOUT).toEqual(expected);
});

Then('the picker lists no new view types', async ({ page }) => {
  await expect(DashboardSelectors.pickerLayoutOptions(page)).toHaveCount(0);
});

Then(
  'the picker lists the {string} view of {string} under {string}',
  async ({ page }, layout: string, database: string, section: string) => {
    const other = DashboardSelectors.pickerSection(page, 'other');
    const option = other.locator(
      `[data-testid="dashboard-widget-picker-option"][data-view-id="${fixtureDatabase(page, database).views[layout]}"]`
    );

    await expect(option).toBeVisible(WIDGET_TIMEOUT);
    // Under the section the Gherkin names (desktop checks the same title).
    await expect(other.getByTestId('dashboard-widget-picker-section-title')).toHaveText(section);
  }
);

Then(
  'the picker lists {int} views under {string} and offers {string}',
  async ({ page }, count: number, title: string, more: string) => {
    const host = DashboardSelectors.pickerSection(page, 'host');

    await expect(host.getByTestId('dashboard-widget-picker-section-title')).toHaveText(title);
    await expect(host.getByTestId('dashboard-widget-picker-option')).toHaveCount(count, WIDGET_TIMEOUT);
    await expect(host.getByTestId('dashboard-widget-picker-show-more')).toHaveText(more);
  }
);

Then('the picker lists {int} views under {string}', async ({ page }, count: number, title: string) => {
  const host = DashboardSelectors.pickerSection(page, 'host');

  await expect(host.getByTestId('dashboard-widget-picker-section-title')).toHaveText(title);
  await expect(host.getByTestId('dashboard-widget-picker-option')).toHaveCount(count, WIDGET_TIMEOUT);
  await expect(host.getByTestId('dashboard-widget-picker-show-more')).toHaveCount(0);
});

Then(
  'the {string} panel shows the view name {string} with the {string} layout selected',
  async ({ page }, _title: string, name: string, layout: string) => {
    await expect(DashboardSelectors.newViewName(page)).toHaveValue(name, WIDGET_TIMEOUT);
    await expect(DashboardSelectors.newViewTile(page, layoutOf(layout))).toHaveAttribute('data-selected', 'true');
  }
);

Then('the {string} popover is open beside the new widget', async ({ page }, title: string) => {
  const settings = page.getByTestId('dashboard-widget-settings');

  await expect(settings).toBeVisible(WIDGET_TIMEOUT);
  await expect(settings).toContainText(title);
  await expect(DashboardSelectors.newViewPanel(page)).toHaveCount(0);
  const [settingsBox, widgetBox] = await Promise.all([settings.boundingBox(), newWidget(page).boundingBox()]);

  expect(settingsBox && widgetBox).toBeTruthy();
  if (!settingsBox || !widgetBox) return;
  const side = await settings.getAttribute('data-side');

  if (side === 'right') expect(settingsBox.x).toBeGreaterThanOrEqual(widgetBox.x + widgetBox.width);
  else expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(widgetBox.x + widgetBox.width);
});

Then('the chart type {string} is selected in the view settings', async ({ page }, type: string) => {
  const settings = page.getByTestId('dashboard-widget-settings');
  const button = settings.getByTestId(`chart-type-${type.toLowerCase()}`);

  if (!(await button.isVisible()))
    await settings
      .getByText(/^Chart$/)
      .first()
      .hover();
  await expect(page.getByTestId(`chart-type-${type.toLowerCase()}`)).toHaveAttribute(
    'data-selected',
    'true',
    WIDGET_TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Views the dashboard created
// ---------------------------------------------------------------------------

Then(
  'the {string} database has {int} views created by the dashboard',
  async ({ page }, database: string, count: number) => {
    const target = fixtureDatabase(page, database);

    await expect
      .poll(async () => (await viewsOwnedBy(page, target.databaseId)).length, { timeout: WIDGET_TIMEOUT_MS * 2 })
      .toBe(count);
  }
);

Then('the add is refused with {string} and {string}', async ({ page }, title: string, hint: string) => {
  const button = DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first();

  // The press closed the tooltip, which stays closed until the pointer leaves: hover the button afresh.
  await page.mouse.move(0, 0);
  await button.hover();
  const tooltip = page.getByTestId('dashboard-full-tooltip');

  await expect(tooltip).toBeVisible(WIDGET_TIMEOUT);
  await expect(tooltip).toContainText(title);
  await expect(tooltip).toContainText(hint);
  expect(allWidgets(await readDashboardSetting(page))).toHaveLength(12);
});

Then('no {string} picker is open', async ({ page }, _title: string) => {
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
  await expect(DashboardSelectors.pendingWidget(page)).toHaveCount(0);
});

Then('the {string} database has the same views as before', async ({ page }, database: string) => {
  const before = viewsBefore.get(page);

  if (!before) throw new Error('No add was tried in this scenario');
  expect(fixtureDatabase(page, database).databaseId).toBe(hostDatabase(page).databaseId);
  expect(await hostViewIds(page)).toEqual(before);
});
