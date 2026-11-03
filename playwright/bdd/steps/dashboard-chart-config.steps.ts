/**
 * Steps of `dashboard-chart-config.feature` (WP11): the chart settings panel
 * of a dashboard widget, chart data configuration and the Number card. The
 * desktop feature `dashboard_chart_config.feature` has the same words.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { chartTable, waitForTypeOptionSync, writeCellInBackground, writeTypeOptions } from '../../support/chart-render-helpers';
import {
  backToChartPanelRoot,
  chartAggregationOf,
  chartCalculateMenuText,
  chartPanel,
  chartPanelRowLabels,
  chartPanelSectionTitles,
  chartTypeButtons,
  chooseChartCalculation,
  chooseChartPanelOption,
  chooseChartXProperty,
  chooseChartYProperty,
  expectStoredChartKey,
  openChartPanelRow,
  openChartPanelRowByLabel,
  pickChartPanelField,
  readStoredChartMap,
} from '../../support/chart-settings-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  databaseForLabel,
  FieldType,
  fixtureDatabase,
  openDatabasePage,
  splitList,
  viewIdForLabel,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { ChartSettingsSelectors } from '../../support/selectors';

const { Given, When, Then } = createBdd();

/** The chart whose settings the scenario edits ("the saved chart …"). */
const currentChart = new WeakMap<Page, string>();
/** The option a scenario added under the same name as another one, by name. */
const secondOptions = new WeakMap<Page, { database: string; property: string; ids: Record<string, string> }>();

function rememberChart(page: Page, label: string) {
  currentChart.set(page, label);
}

function savedChartViewId(page: Page): string {
  const label = currentChart.get(page);

  if (!label) throw new Error('No chart settings were opened in this scenario');
  return viewIdForLabel(page, label);
}

/** The options of a select property as the browser's database doc holds them. */
async function readSelectOptions(page: Page, databaseId: string, fieldId: string) {
  return page.evaluate(
    ({ databaseId, fieldId, type }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const field = bridge.byDatabase(databaseId).databaseDoc.getMap('data').get('database').get('fields').get(fieldId);
      const content = field?.get('type_option')?.get(String(type))?.get('content');

      return (content ? JSON.parse(content) : { options: [] }) as {
        options: { id: string; name: string; color: string }[];
        disable_color?: boolean;
      };
    },
    { databaseId, fieldId, type: FieldType.SingleSelect }
  );
}

// ---------------------------------------------------------------------------
// Seeding (database pages, before the dashboard is added)
// ---------------------------------------------------------------------------

Given(
  'the {string} property of {string} has a second option named {string}',
  async ({ page, request }, property: string, databaseName: string, name: string) => {
    const database = fixtureDatabase(page, databaseName);
    const fieldId = database.fieldIds[property];

    if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
    await openDatabasePage(page, databaseName, database.views.Grid);
    const typeOption = await readSelectOptions(page, database.databaseId, fieldId);

    expect(typeOption.options.map((option) => option.name)).toContain(name);
    const id = `c3-second-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const updates = [
      {
        fieldId,
        type: FieldType.SingleSelect,
        entries: {
          content: JSON.stringify({ ...typeOption, options: [...typeOption.options, { id, name, color: 'Pink' }] }),
        },
      },
    ];

    await writeTypeOptions(page, database.databaseId, updates);
    await waitForTypeOptionSync(page, request, database.databaseId, updates);
    secondOptions.set(page, { database: databaseName, property, ids: { [name]: id } });
  }
);

Given('{string} uses the second {string} option', async ({ page }, rowTitle: string, name: string) => {
  const second = secondOptions.get(page);
  const id = second?.ids[name];

  if (!second || !id) throw new Error(`No second "${name}" option was added`);
  await writeCellInBackground(page, second.database, rowTitle, second.property, id);
});

When('the {string} property of {string} is deleted', async ({ page }, property: string, databaseName: string) => {
  const database = fixtureDatabase(page, databaseName);
  const fieldId = database.fieldIds[property];

  if (!fieldId) throw new Error(`"${databaseName}" has no "${property}" property`);
  await page.evaluate(
    ({ databaseId, fieldId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const doc = bridge.byDatabase(databaseId).databaseDoc;
      const database = doc.getMap('data').get('database');

      doc.transact(() => {
        database.get('fields').delete(fieldId);
        database.get('views').forEach((view: any) => {
          const orders = view.get('field_orders');
          const index = orders?.toArray().findIndex((order: { id: string }) => order.id === fieldId) ?? -1;

          if (index >= 0) orders.delete(index, 1);
          view.get('field_settings')?.delete(fieldId);
        });
      });
    },
    { databaseId: database.databaseId, fieldId }
  );
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

When('I open the settings of the {string} widget', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);
  const tool = widget.getByTestId('dashboard-widget-settings-button');

  await widget.hover();
  await expect(tool).toBeVisible(WIDGET_TIMEOUT);
  if ((await tool.getAttribute('data-state')) !== 'open') await tool.click();
  await expect(page.getByTestId('dashboard-widget-settings')).toBeVisible(WIDGET_TIMEOUT);
  await expect(chartPanel(page)).toBeVisible(WIDGET_TIMEOUT);
  rememberChart(page, label);
});

Then('the chart settings show the chart types {string}', async ({ page }, types: string) => {
  expect((await chartTypeButtons(page)).labels).toEqual(splitList(types));
});

Then('the {string} chart type is selected', async ({ page }, type: string) => {
  await expect.poll(async () => (await chartTypeButtons(page)).selected, WIDGET_TIMEOUT).toEqual([type]);
});

When('I choose the {string} chart type', async ({ page }, type: string) => {
  const button = page.getByTestId('chart-type-row').getByRole('button', { name: type, exact: true });

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

Then('the chart settings show the sections {string}', async ({ page }, sections: string) => {
  await expect.poll(() => chartPanelSectionTitles(page), WIDGET_TIMEOUT).toEqual(splitList(sections));
});

Then('the {string} chart settings section includes {string}', async ({ page }, section: string, rows: string) => {
  const labels = await chartPanelRowLabels(page, section);

  expect(labels).toEqual(expect.arrayContaining(splitList(rows)));
});

Then('the chart settings do not offer {string}', async ({ page }, label: string) => {
  expect(await chartPanelRowLabels(page)).not.toContain(label);
});

When('I open {string} in the {string} chart settings section', async ({ page }, row: string, section: string) => {
  await openChartPanelRowByLabel(page, row, section);
});

When('I search the chart fields for {string}', async ({ page }, query: string) => {
  await ChartSettingsSelectors.fieldSearch(page).fill(query);
});

Then('the chart fields list only {string}', async ({ page }, names: string) => {
  await expect
    .poll(
      () =>
        chartPanel(page)
          .locator('[data-field-name]')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-field-name'))),
      WIDGET_TIMEOUT
    )
    .toEqual(splitList(names));
});

Then('the chart fields say {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('chart-field-no-results')).toHaveText(text);
  await expect(chartPanel(page).locator('[data-field-name]')).toHaveCount(0);
});

When('I set the chart Y axis to {string} with {string}', async ({ page }, property: string, calculation: string) => {
  await chooseChartYProperty(page, property);
  const aggregation = chartAggregationOf(calculation);

  await openChartPanelRow(page, 'y_calculate');
  if ((await ChartSettingsSelectors.aggItem(page, aggregation).getAttribute('aria-checked')) !== 'true') {
    await chooseChartCalculation(page, aggregation);
  }

  await backToChartPanelRoot(page);
});

When('I set the chart X axis to {string}', async ({ page }, property: string) => {
  await chooseChartXProperty(page, property);
});

When('I set the chart {string} to {string}', async ({ page }, row: string, property: string) => {
  await openChartPanelRowByLabel(page, row);
  await pickChartPanelField(page, property);
});

When('I sort the chart by {string}', async ({ page }, sort: string) => {
  await openChartPanelRow(page, 'x_sort');
  await chooseChartPanelOption(page, sort);
  await backToChartPanelRoot(page);
});

When('I group the chart text by {string}', async ({ page }, grouping: string) => {
  await openChartPanelRow(page, 'x_text_grouping');
  await chooseChartPanelOption(page, grouping);
  await backToChartPanelRoot(page);
});

When('I set the chart range size to {string}', async ({ page }, size: string) => {
  await openChartPanelRow(page, 'x_buckets');
  const input = page.getByTestId('chart-bucket-size');

  await input.fill(size);
  await input.press('Enter');
  await expect(input).toHaveValue(size);
  await backToChartPanelRoot(page);
});

When('I choose {string} in the chart settings', async ({ page }, label: string) => {
  const item = chartPanel(page).getByRole('menuitemradio', { name: label, exact: true });

  await item.click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
});

When('I choose the chart calculation {string}', async ({ page }, calculation: string) => {
  await chooseChartCalculation(page, chartAggregationOf(calculation));
});

Then('the chart Calculate menu offers {string}', async ({ page }, menu: string) => {
  await expect.poll(() => chartCalculateMenuText(page), WIDGET_TIMEOUT).toBe(menu);
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function groupRow(page: Page, label: string) {
  return chartPanel(page)
    .locator('[role="listitem"][data-testid^="chart-group-"]')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) })
    .first();
}

When('I hide the {string} chart group', async ({ page }, label: string) => {
  const row = groupRow(page, label);

  await expect(row).toBeVisible(WIDGET_TIMEOUT);
  await row.locator('[data-testid^="chart-group-eye-"]').click();
  await expect(row).toHaveAttribute('data-hidden', 'true');
});

When('I drag the {string} chart group above {string}', async ({ page }, label: string, target: string) => {
  const source = groupRow(page, label);
  const destination = groupRow(page, target);

  await source.hover();
  await source.locator('[data-testid^="chart-group-handle-"]').dragTo(destination, { targetPosition: { x: 40, y: 3 } });
  await expect
    .poll(
      () =>
        chartPanel(page)
          .locator('[role="listitem"][data-testid^="chart-group-"] span.flex-1')
          .evaluateAll((labels) => labels.map((item) => item.textContent?.trim())),
      WIDGET_TIMEOUT
    )
    .toEqual(expect.arrayContaining([label, target]));
});

When('I show all chart groups', async ({ page }) => {
  await page.getByTestId('chart-groups-show-all').click();
  await expect(chartPanel(page).locator('[role="listitem"][data-hidden="true"]')).toHaveCount(0);
});

Then('the saved chart hides the groups {string}', async ({ page }, names: string) => {
  const label = currentChart.get(page) ?? '';
  const database = fixtureDatabase(page, databaseForLabel(page, label));
  const viewId = savedChartViewId(page);

  await expect
    .poll(async () => {
      const stored = await readStoredChartMap(page, viewId);
      const fieldId = String(stored.x_field_id || database.fieldIds.Status);
      const { options } = await readSelectOptions(page, database.databaseId, fieldId);
      const hidden = Array.isArray(stored.hidden_groups) ? (stored.hidden_groups as string[]) : [];

      return hidden.map((key) => options.find((option) => option.id === key)?.name ?? key);
    }, WIDGET_TIMEOUT)
    .toEqual(splitList(names));
});

Then('the saved chart is sorted {string}', async ({ page }, sort: string) => {
  await expectStoredChartKey(page, savedChartViewId(page), 'x_sort', sort);
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

Then('the {string} widget shows the categories in order {string}', async ({ page }, label: string, categories: string) => {
  const widget = widgetLocator(page, label);

  await expect.poll(async () => (await chartTable(widget)).map((row) => row.label), WIDGET_TIMEOUT).toEqual(splitList(categories));
});

Then('the {string} widget shows the value {string} for {string}', async ({ page }, label: string, value: string, category: string) => {
  const widget = widgetLocator(page, label);

  await expect
    .poll(async () => (await chartTable(widget)).find((row) => row.label === category)?.value, WIDGET_TIMEOUT)
    .toBe(Number(value));
});

// ---------------------------------------------------------------------------
// Number card
// ---------------------------------------------------------------------------

Then(
  'the {string} widget shows the caption {string} above the number {string}',
  async ({ page }, label: string, caption: string, value: string) => {
    const chart = widgetLocator(page, label).getByTestId('number-chart');
    const title = chart.getByTestId('number-chart-title');
    const number = chart.getByTestId('number-chart-value');

    await expect(title).toHaveText(caption, WIDGET_TIMEOUT);
    await expect(number).toHaveText(value, WIDGET_TIMEOUT);
    const [titleBox, numberBox] = [await title.boundingBox(), await number.boundingBox()];

    expect(titleBox && numberBox && titleBox.y + titleBox.height <= numberBox.y + 1).toBe(true);
  }
);

When('I turn off the chart title', async ({ page }) => {
  await backToChartPanelRoot(page);
  const toggle = page.getByTestId('chart-number-title-toggle');

  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

Then('the {string} widget shows the number {string} without a caption', async ({ page }, label: string, value: string) => {
  const chart = widgetLocator(page, label).getByTestId('number-chart');

  await expect(chart.getByTestId('number-chart-value')).toHaveText(value, WIDGET_TIMEOUT);
  await expect(chart.getByTestId('number-chart-title')).toHaveCount(0);
});

Then('the saved chart does not show its title', async ({ page }) => {
  await expectStoredChartKey(page, savedChartViewId(page), 'show_title', false);
});

async function openNumberColorPage(page: Page) {
  if ((await chartPanel(page).getAttribute('data-page')) !== 'number_color') await openChartPanelRow(page, 'number_color');
}

When('I pick the {string} number color', async ({ page }, color: string) => {
  await openNumberColorPage(page);
  const chip = chartPanel(page).locator(`[data-testid="chart-number-color-${color.toLowerCase()}"]`);

  await expect(chip).toHaveAttribute('aria-label', color);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-checked', 'true');
});

Then('the {string} number is shown in {string}', async ({ page }, label: string, color: string) => {
  await expect(widgetLocator(page, label).getByTestId('number-chart-value')).toHaveAttribute('data-color', color, WIDGET_TIMEOUT);
});

When('I turn on dynamic color', async ({ page }) => {
  await openNumberColorPage(page);
  const toggle = page.getByTestId('chart-number-dynamic-color');

  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('chart-number-rule-0')).toBeVisible();
});

async function setNumberColorRule(page: Page, index: number, operator: string, value: string, color: string) {
  const rule = page.getByTestId(`chart-number-rule-${index}`);

  await expect(rule).toBeVisible(WIDGET_TIMEOUT);
  await page.getByTestId(`chart-number-rule-${index}-operator`).click();
  await rule.getByRole('menuitemradio', { name: operator, exact: true }).click();
  const input = page.getByTestId(`chart-number-rule-${index}-value`);

  await input.fill(value);
  await input.press('Enter');
  await page.getByTestId(`chart-number-rule-${index}-color`).click();
  await page.getByTestId(`chart-number-rule-${index}-color-${color.toLowerCase()}`).click();
  await expect(page.getByTestId(`chart-number-rule-${index}-color`)).toHaveAttribute('data-color', color.toLowerCase());
  await expect(input).toHaveValue(value);
}

When(
  'I set dynamic color rule {int} to {string} {string} in {string}',
  async ({ page }, position: number, operator: string, value: string, color: string) => {
    await openNumberColorPage(page);
    await setNumberColorRule(page, position - 1, operator, value, color);
  }
);

When('I add a dynamic color rule {string} {string} in {string}', async ({ page }, operator: string, value: string, color: string) => {
  await openNumberColorPage(page);
  const rules = page.locator('[data-testid^="chart-number-rule-"][data-parity-id="dash-number-color-rule"]');
  const count = await rules.count();

  await page.getByTestId('chart-number-add-rule').click();
  await expect(rules).toHaveCount(count + 1);
  await setNumberColorRule(page, count, operator, value, color);
});

When('I set the dynamic color else to {string}', async ({ page }, color: string) => {
  await openNumberColorPage(page);
  await page.getByTestId('chart-number-else-color').click();
  await page.getByTestId(`chart-number-else-color-${color.toLowerCase()}`).click();
  await expect(page.getByTestId('chart-number-else-color')).toHaveAttribute('data-color', color.toLowerCase());
});

Then('the saved chart has {int} dynamic color rules', async ({ page }, count: number) => {
  const viewId = savedChartViewId(page);

  await expect
    .poll(async () => {
      const stored = (await readStoredChartMap(page, viewId)).number_conditional_color as { rules?: unknown[] } | undefined;

      return stored?.rules?.length ?? 0;
    }, WIDGET_TIMEOUT)
    .toBe(count);
});
