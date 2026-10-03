import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
} from '../../../src/application/database-yjs/dashboard-geometry';
import {
  PARITY_ENUM,
  PARITY_PROBE,
  PARITY_PROBE_KEY,
  expectDashboardProbes,
  mergeRawLayout,
  readRawLayout,
  seedDashboardProbes,
} from '../../support/dashboard-parity-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  addViewThroughTabs,
  chooseGlobalFilterCondition,
  chooseWidgetMenuAction,
  closeGlobalFilterMenu,
  DASHBOARD_LAYOUT_KEY,
  DashboardSelectors,
  dashboardViewId,
  dragLocatorBy,
  enterEditMode,
  FieldType,
  fixtureDatabase,
  globalFilterChip,
  labelsOfRow,
  leaveEditMode,
  openGlobalFilterChip,
  openWidgetPicker,
  persistedRow,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  seedDashboardWidgets,
  viewIdForLabel,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { ChartSettingsSelectors } from '../../support/selectors';

const { Given, When, Then } = createBdd();

/** `CheckboxFilterCondition` (`fields/checkbox/checkbox.type.ts`). */
const CHECKBOX_IS_CHECKED = 0;
const CHECKBOX_IS_UNCHECKED = 1;
/** `ChartType.Donut` and the chart `layout_settings` key (`chart.type.ts`). */
const CHART_TYPE_DONUT = 3;
const CHART_LAYOUT_KEY = '3';
const GLOBAL_FILTER_ID = 'gf:parity';
const GLOBAL_FILTER_NAME = 'Urgent';
const CHART_LABEL = 'Projects Chart';
/** A row height reads back within this many pixels on screen. */
const RENDERED_HEIGHT_TOLERANCE = 2;

async function storedGlobalFilter(page: Page) {
  const layout = await readRawLayout(page, dashboardViewId(page), DASHBOARD_LAYOUT_KEY);

  return ((layout.global_filters ?? []) as Record<string, unknown>[]).find((filter) => filter.id === GLOBAL_FILTER_ID);
}

async function readChartLayout(page: Page) {
  return readRawLayout(page, viewIdForLabel(page, CHART_LABEL), CHART_LAYOUT_KEY);
}

/** The last dashboard row has `height`, stored and on screen. */
async function expectLastRowHeight(page: Page, height: number) {
  await expect.poll(async () => (await readDashboardSetting(page)).rows.at(-1)?.height).toBe(height);
  const { rows } = await readDashboardSetting(page);
  const row = DashboardSelectors.row(page, rows[rows.length - 1].id);

  await expect
    .poll(async () => Math.abs(((await row.boundingBox())?.height ?? 0) - height))
    .toBeLessThanOrEqual(RENDERED_HEIGHT_TOLERANCE);
}

/** Open the chart settings of a chart widget (WP11 moves these into the settings panel). */
async function openWidgetChartSettings(page: Page, label: string) {
  const widget = widgetLocator(page, label);

  await widget.hover();
  // The Edit-mode settings tool opens the widget's settings host (WP03).
  await widget.getByTestId('dashboard-widget-settings-button').click();
  await ChartSettingsSelectors.chartSettingsSubTrigger(page).click();
  await expect(page.getByTestId('chart-type-donut')).toBeVisible(WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('a dashboard with two widgets in one row', async ({ page, request }) => {
  await prepareDashboardFixture(page, request);
  await addDashboardView(page, 'Projects');
  await seedDashboardWidgets(page, [
    { row: 1, label: 'Projects Grid' },
    { row: 1, label: 'Tasks Grid' },
  ]);
  await leaveEditMode(page);
  await expect(DashboardSelectors.widgets(page)).toHaveCount(2, WIDGET_TIMEOUT);
});

Given('a dashboard with a chart widget', async ({ page, request }) => {
  await prepareDashboardFixture(page, request);
  await addViewThroughTabs(page, 'Projects', 'Chart');
  await addDashboardView(page, 'Projects');
  await seedDashboardWidgets(page, [{ row: 1, label: CHART_LABEL }]);
  await leaveEditMode(page);
  await expect(DashboardSelectors.widgets(page)).toHaveCount(1, WIDGET_TIMEOUT);
});

Given('the dashboard layout holds settings from a newer app version', async ({ page }) => {
  await seedDashboardProbes(page);
});

Given('the dashboard has a checkbox global filter from a newer app version', async ({ page }) => {
  const projects = fixtureDatabase(page, 'Projects');

  await mergeRawLayout(page, dashboardViewId(page), DASHBOARD_LAYOUT_KEY, {
    global_filters: [
      {
        id: GLOBAL_FILTER_ID,
        name: GLOBAL_FILTER_NAME,
        ty: FieldType.Checkbox,
        condition: CHECKBOX_IS_UNCHECKED,
        content: '',
        targets: { [projects.databaseId]: projects.fieldIds.Urgent },
        target_order: [projects.databaseId],
        [PARITY_PROBE_KEY]: PARITY_PROBE,
      },
    ],
  });
  await expect(globalFilterChip(page, GLOBAL_FILTER_NAME)).toBeVisible(WIDGET_TIMEOUT);
});

Given('the chart holds settings from a newer app version', async ({ page }) => {
  await mergeRawLayout(page, viewIdForLabel(page, CHART_LABEL), CHART_LAYOUT_KEY, {
    [PARITY_PROBE_KEY]: PARITY_PROBE,
    zz_parity_enum: PARITY_ENUM,
  });
  await expect.poll(async () => (await readChartLayout(page)).zz_parity_enum).toBe(PARITY_ENUM);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('the first widget is moved to the right through its menu in Edit mode', async ({ page }) => {
  await enterEditMode(page);
  const row = await persistedRow(page, 1);

  await chooseWidgetMenuAction(page, DashboardSelectors.widget(page, row.widgets[0].id), 'move-right');
});

When('the checkbox global filter is changed to checked in Edit mode', async ({ page }) => {
  await enterEditMode(page);
  await openGlobalFilterChip(page, GLOBAL_FILTER_NAME);
  await chooseGlobalFilterCondition(page, 'Is checked');
  await expect(DashboardSelectors.globalFilterCondition(page)).toContainText('Is checked');
  await closeGlobalFilterMenu(page);
});

When('the chart widget is changed to a donut chart in Edit mode', async ({ page }) => {
  await enterEditMode(page);
  await openWidgetChartSettings(page, CHART_LABEL);
  await page.getByTestId('chart-type-donut').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('a widget is added in a new row below the last row in Edit mode', async ({ page }) => {
  await enterEditMode(page);
  const { rows } = await readDashboardSetting(page);

  await openWidgetPicker(page);
  await pickExistingView(page, viewIdForLabel(page, 'Notes Grid'));
  await expect.poll(async () => (await readDashboardSetting(page)).rows.length).toBe(rows.length + 1);
  await expect(DashboardSelectors.widgets(page)).toHaveCount(3, WIDGET_TIMEOUT);
});

When('the new row is resized well below the minimum height', async ({ page }) => {
  const { rows } = await readDashboardSetting(page);
  const rowId = rows[rows.length - 1].id;

  await DashboardSelectors.row(page, rowId).hover();
  await dragLocatorBy(
    page,
    DashboardSelectors.heightHandle(page, rowId),
    0,
    -(DASHBOARD_DEFAULT_ROW_HEIGHT - DASHBOARD_MIN_ROW_HEIGHT + 200)
  );
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the two widgets have swapped places', async ({ page }) => {
  await expect.poll(async () => labelsOfRow(page, await persistedRow(page, 1))).toEqual(['Tasks Grid', 'Projects Grid']);
});

Then('the dashboard layout still holds the settings from the newer app version', async ({ page }) => {
  await expectDashboardProbes(page);
});

Then('the checkbox global filter is saved as checked', async ({ page }) => {
  await expect.poll(async () => (await storedGlobalFilter(page))?.condition).toBe(CHECKBOX_IS_CHECKED);
});

Then('the checkbox global filter still holds the settings from the newer app version', async ({ page }) => {
  expect((await storedGlobalFilter(page))?.[PARITY_PROBE_KEY]).toEqual(PARITY_PROBE);
});

Then('the chart is saved as a donut chart', async ({ page }) => {
  await expect.poll(async () => (await readChartLayout(page)).chart_type).toBe(CHART_TYPE_DONUT);
});

Then('the chart still holds the settings from the newer app version', async ({ page }) => {
  const chart = await readChartLayout(page);

  expect(chart[PARITY_PROBE_KEY]).toEqual(PARITY_PROBE);
  expect(chart.zz_parity_enum).toBe(PARITY_ENUM);
});

Then('the new row has the default row height', async ({ page }) => {
  await expectLastRowHeight(page, DASHBOARD_DEFAULT_ROW_HEIGHT);
});

Then('the new row has the minimum row height', async ({ page }) => {
  await expectLastRowHeight(page, DASHBOARD_MIN_ROW_HEIGHT);
});
