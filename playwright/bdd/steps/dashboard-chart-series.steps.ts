/**
 * Steps of `dashboard-chart-series.feature` (WP12 §7): charts split by a
 * second property ("Group by"), with stacked, grouped and percent bars, one
 * line per group, segment and band drill-downs, the Group by and Group style
 * settings, and the 50-group cap. The desktop feature
 * `dashboard_chart_series.feature` has the same words. The Background, the
 * dashboard, drill-down, chart type, settings tool and reload steps are the
 * shared use-case, chrome and chart configuration steps.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addTaggedDatabase,
  barOrientation,
  categoryAsText,
  chartRowValue,
  chartSegments,
  chartSettingsShowRow,
  chooseGroupStyle,
  clickBesideBars,
  clickSegment,
  dataLabelTexts,
  drawnGroups,
  expectGroupStyle,
  groupList,
  groupStyleOptions,
  hoverCategoryBand,
  legendLabels,
  plotLength,
  seriesChartRoot,
  SERIES_TIMEOUT,
  sideBySideProblems,
  stackProblems,
  tooltipContent,
  valueTickTexts,
} from '../../support/chart-series-helpers';
import { widgetLocator } from '../../support/dashboard-test-helpers';
import { chartTable } from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

Given(
  'a/an {string} database whose {int} rows are tagged {string} to {string}',
  async ({ page, request }, name: string, count: number, from: string, to: string) => {
    await addTaggedDatabase(page, request, name, count, from, to);
  }
);

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

Then('the {string} chart stacks its bars', async ({ page }, view: string) => {
  await expectGroupStyle(page, view, 'stacked');
  const orientation = await barOrientation(page, view);

  await expect.poll(async () => (await chartSegments(page, view)).length, SERIES_TIMEOUT).toBeGreaterThan(0);
  await expect.poll(async () => stackProblems(await chartSegments(page, view), orientation), SERIES_TIMEOUT).toEqual([]);
});

Then('the {string} chart draws its bars side by side', async ({ page }, view: string) => {
  await expectGroupStyle(page, view, 'grouped');
  const orientation = await barOrientation(page, view);

  await expect.poll(async () => (await chartSegments(page, view)).length, SERIES_TIMEOUT).toBeGreaterThan(1);
  await expect.poll(async () => sideBySideProblems(await chartSegments(page, view), orientation), SERIES_TIMEOUT).toEqual([]);
});

Then('the {string} chart draws its bars as percentages', async ({ page }, view: string) => {
  await expectGroupStyle(page, view, 'percent');
  const orientation = await barOrientation(page, view);

  await expect.poll(async () => (await valueTickTexts(page, view)).at(-1), SERIES_TIMEOUT).toBe('100%');
  const length = await plotLength(page, view, orientation);

  // Every category's segments fill the plot along the value axis.
  await expect
    .poll(async () => {
      const totals = new Map<string, number>();

      (await chartSegments(page, view)).forEach((segment) =>
        totals.set(
          segment.category,
          (totals.get(segment.category) ?? 0) + (orientation === 'vertical' ? segment.height : segment.width)
        )
      );
      return [...totals.values()].every((total) => Math.abs(total - length) <= 1) && totals.size > 0;
    }, SERIES_TIMEOUT)
    .toBe(true);
});

Then('the {string} chart draws one bar per category', async ({ page }, view: string) => {
  await expect(seriesChartRoot(page, view)).toHaveAttribute('data-series-count', '1', SERIES_TIMEOUT);
  await expectGroupStyle(page, view, 'none');
  await expect
    .poll(async () => {
      const nonZero = (await chartTable(widgetLocator(page, view))).filter((row) => row.value !== 0).map((row) => row.label);
      const drawn = (await chartSegments(page, view)).map((segment) => segment.category);

      return drawn.length === nonZero.length && nonZero.every((label) => drawn.includes(label));
    }, SERIES_TIMEOUT)
    .toBe(true);
});

Then('the {string} chart legend lists {string}', async ({ page }, view: string, labels: string) => {
  await expect.poll(() => legendLabels(page, view), SERIES_TIMEOUT).toEqual(groupList(labels));
});

Then('the {string} chart shows {string} as {string}', async ({ page }, view: string, category: string, values: string) => {
  const expected = groupList(values);

  if ((await seriesChartRoot(page, view).getAttribute('data-testid')) === 'line-chart-widget') {
    // Lines have no segments: the tooltip lists the category's non-zero groups in series order.
    await hoverCategoryBand(page, view, category);
    await expect.poll(async () => (await tooltipContent(page)).rows, SERIES_TIMEOUT).toEqual(expected);
    await page.mouse.move(0, 0);
    return;
  }

  await expect.poll(async () => categoryAsText(await chartSegments(page, view), category), SERIES_TIMEOUT).toEqual(expected);
});

Then('the {string} chart labels its bars {string}', async ({ page }, view: string, labels: string) => {
  const orientation = await barOrientation(page, view);

  await expect.poll(() => dataLabelTexts(page, view, orientation), SERIES_TIMEOUT).toEqual(groupList(labels));
});

Then('the {string} chart shows no data labels', async ({ page }, view: string) => {
  const widget = widgetLocator(page, view);

  await expect(widget.locator('.recharts-wrapper')).toBeVisible(SERIES_TIMEOUT);
  await expect(widget.getByTestId('chart-data-label')).toHaveCount(0, SERIES_TIMEOUT);
});

Then('the {string} chart draws {int} lines', async ({ page }, view: string, count: number) => {
  await expect(widgetLocator(page, view).locator('.recharts-line-curve[data-testid="chart-line"]')).toHaveCount(
    count,
    SERIES_TIMEOUT
  );
});

Then('the {string} chart draws {int} groups', async ({ page }, view: string, count: number) => {
  await expect.poll(async () => (await drawnGroups(page, view)).length, SERIES_TIMEOUT).toBe(count);
});

Then('the {string} chart does not draw the groups {string}', async ({ page }, view: string, groups: string) => {
  const drawn = await drawnGroups(page, view);

  expect(drawn.length).toBeGreaterThan(0);
  groupList(groups).forEach((group) => expect(drawn).not.toContain(group));
});

Then('the {string} chart says {string}', async ({ page }, view: string, text: string) => {
  await expect(widgetLocator(page, view).getByTestId('chart-truncation-caption')).toHaveText(text, SERIES_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Tooltip and drill-down
// ---------------------------------------------------------------------------

When('I hover the {string} bar of the {string} chart', async ({ page }, category: string, view: string) => {
  await hoverCategoryBand(page, view, category);
});

Then('the chart tooltip is titled {string} and lists {string}', async ({ page }, title: string, rows: string) => {
  await expect.poll(() => tooltipContent(page), SERIES_TIMEOUT).toEqual({ title, rows: groupList(rows) });
});

Then('the chart tooltip ends with {string}', async ({ page }, text: string) => {
  const tooltip = page.getByTestId('chart-tooltip');
  const footer = tooltip.getByTestId('chart-tooltip-footer');

  await expect(footer).toHaveText(text, SERIES_TIMEOUT);
  // The footer is the tooltip's last line.
  expect(await footer.evaluate((element) => element.nextElementSibling === null)).toBe(true);
});

When(
  'I click the {string} segment of the {string} bar in the {string} chart',
  async ({ page }, series: string, category: string, view: string) => {
    await clickSegment(page, view, category, series);
  }
);

When('I click beside the {string} bars of the {string} chart', async ({ page }, category: string, view: string) => {
  await clickBesideBars(page, view, category);
});

// ---------------------------------------------------------------------------
// Chart settings
// ---------------------------------------------------------------------------

Then('the chart settings show {string} as {string}', async ({ page }, label: string, value: string) => {
  await expect.poll(() => chartRowValue(page, label), SERIES_TIMEOUT).toBe(value);
});

Then('the chart settings do not show {string}', async ({ page }, label: string) => {
  await expect.poll(() => chartSettingsShowRow(page, label), SERIES_TIMEOUT).toBe(false);
});

Then(
  'the chart settings offer the group styles {string} with {string} selected',
  async ({ page }, styles: string, selected: string) => {
    await expect.poll(() => groupStyleOptions(page), SERIES_TIMEOUT).toEqual({ labels: groupList(styles), selected: [selected] });
  }
);

When('I choose the {string} group style', async ({ page, request }, style: string) => {
  await chooseGroupStyle(page, request, style);
});
