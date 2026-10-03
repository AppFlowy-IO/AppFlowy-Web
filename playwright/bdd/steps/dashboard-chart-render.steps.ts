/**
 * Steps of `dashboard-chart-render.feature` (WP10 §6.3), whose text is shared
 * with desktop. Parameters use bdd_widget_test's brace syntax (`{'Revenue'}`),
 * so these expressions escape the braces around `{string}` / `{int}`.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  categoryPoint,
  CHART_TIMEOUT,
  chartRoot,
  chartTable,
  chartTooltip,
  dataLabels,
  hoverChartCategory,
  parseLabelMap,
  parseWidgetRows,
  pickChartStyleOption,
  seedChartFixture,
  setDashboardRowHeight,
  spellStoredValue,
  storedChartValue,
  toggleChartStyleRow,
  valueTicks,
  writeCellInBackground,
} from '../../support/chart-render-helpers';
import { openDatabasePage, splitList, widgetLocator } from '../../support/dashboard-test-helpers';
import {
  chartBarPath,
  namedView,
  openUseCaseDashboard,
  prepareUseCaseWorkspace,
  seedUseCaseDashboard,
  waitForViewSync,
} from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

/** The category the last "hovers the first category" step pointed at, per scenario page. */
const hoveredCategory = new WeakMap<Page, string>();

/** The chart inside the dashboard widget of `viewName`. */
function widgetChart(page: Page, viewName: string): Locator {
  return chartRoot(widgetLocator(page, viewName));
}

/** The chart of the open chart page. */
function pageChart(page: Page): Locator {
  return chartRoot(page);
}

async function expectDataLabels(chart: Locator, text: string) {
  const expected = parseLabelMap(text);

  await expect.poll(() => dataLabels(chart), CHART_TIMEOUT).toEqual(expected);
}

async function expectStored(page: Page, viewName: string, key: string, expected: string) {
  await expect.poll(async () => spellStoredValue(await storedChartValue(page, viewName, key)), CHART_TIMEOUT).toBe(expected);
}

/** The bar path of a category, by its place in the data table. */
const barPath = chartBarPath;

/** Where the zero line is: its y for vertical charts, its x for horizontal bars. */
async function zeroLine(chart: Locator) {
  const box = await chart.locator('.recharts-reference-line line').first().boundingBox();

  if (!box) throw new Error('The chart draws no zero line');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('a Pro workspace for chart rendering is ready', async ({ page, request }) => {
  await prepareUseCaseWorkspace(page, request, 'Chart rendering');
});

Given('the chart fixture \\{{string}\\} is seeded', async ({ page, request }, key: string) => {
  await seedChartFixture(page, request, key);
});

// ---------------------------------------------------------------------------
// Dashboards and chart pages
// ---------------------------------------------------------------------------

Given(
  'the dashboard \\{{string}\\} on \\{{string}\\} has the rows \\{{string}\\}',
  async ({ page, request }, name: string, host: string, rows: string) => {
    await seedUseCaseDashboard(page, request, name, host, parseWidgetRows(rows));
  }
);

When('the user opens the dashboard \\{{string}\\} on \\{{string}\\}', async ({ page }, name: string, _host: string) => {
  await openUseCaseDashboard(page, name);
});

When(
  'the user opens the chart view \\{{string}\\} of the database \\{{string}\\}',
  async ({ page }, viewName: string, databaseName: string) => {
    await openDatabasePage(page, databaseName, namedView(page, viewName).viewId);
    await expect(pageChart(page)).toBeVisible(CHART_TIMEOUT);
  }
);

When('the dashboard row \\{{int}\\} is resized to \\{{int}\\} pixels', async ({ page }, row: number, height: number) => {
  await setDashboardRowHeight(page, row, height);
  await expect
    .poll(async () => {
      const box = await page.getByTestId('dashboard-widget').first().boundingBox();

      return box ? Math.round(box.height) : 0;
    }, CHART_TIMEOUT)
    .toBe(height);
});

Then('the chart of the dashboard widget \\{{string}\\} fills its card', async ({ page }, viewName: string) => {
  const widget = widgetLocator(page, viewName);

  await expect(widget.getByTestId('dashboard-widget-body')).toBeVisible(CHART_TIMEOUT);
  await expect
    .poll(
      () =>
        widget.evaluate((element) => {
          const body = element.querySelector('[data-testid="dashboard-widget-body"]');
          const chart = body?.querySelector('[data-testid="database-chart"]') as HTMLElement | null;

          if (!body || !chart) return 'no chart in the card';
          const bodyRect = body.getBoundingClientRect();
          const chartRect = chart.getBoundingClientRect();
          const conditions = body.querySelector(':scope > div:first-child:not([data-testid="database-chart"])');
          const conditionsHeight =
            conditions && !conditions.contains(chart) ? conditions.getBoundingClientRect().height : 0;
          const problems: string[] = [];

          if (chartRect.left < bodyRect.left - 1 || chartRect.right > bodyRect.right + 1) problems.push('wider than the card');
          if (chartRect.top < bodyRect.top - 1 || chartRect.bottom > bodyRect.bottom + 1) problems.push('taller than the card');
          if (chartRect.height < bodyRect.height - 2 - conditionsHeight) problems.push(`leaves ${Math.round(bodyRect.height - chartRect.height)}px of the card empty`);
          if (chart.scrollHeight > chart.clientHeight + 1) problems.push('scrolls inside the card');
          const pie = body.querySelector('.recharts-pie');

          if (pie) {
            const pieRect = pie.getBoundingClientRect();

            if (pieRect.top < bodyRect.top - 1 || pieRect.bottom > bodyRect.bottom + 1) problems.push('the donut overflows');
          }

          return problems.join(', ') || 'fills';
        }),
      CHART_TIMEOUT
    )
    .toBe('fills');
});

// ---------------------------------------------------------------------------
// Axes, labels and bars
// ---------------------------------------------------------------------------

Then(
  'the dashboard widget \\{{string}\\} shows the value axis ticks \\{{string}\\}',
  async ({ page }, viewName: string, ticks: string) => {
    await expect.poll(() => valueTicks(widgetChart(page, viewName)), CHART_TIMEOUT).toEqual(splitList(ticks));
  }
);

Then('the dashboard widget \\{{string}\\} shows no value axis line', async ({ page }, viewName: string) => {
  const chart = widgetChart(page, viewName);

  await expect(chart.locator('.recharts-wrapper')).toBeVisible(CHART_TIMEOUT);
  await expect(chart.locator('.recharts-yAxis .recharts-cartesian-axis-line')).toHaveCount(0);
});

Then(
  'the dashboard widget \\{{string}\\} shows the data labels \\{{string}\\}',
  async ({ page }, viewName: string, labels: string) => {
    await expectDataLabels(widgetChart(page, viewName), labels);
  }
);

Then('the chart shows the data labels \\{{string}\\}', async ({ page }, labels: string) => {
  await expectDataLabels(pageChart(page), labels);
});

Then('the chart shows no data labels', async ({ page }) => {
  await expect(pageChart(page).locator('.recharts-wrapper')).toBeVisible(CHART_TIMEOUT);
  await expect(pageChart(page).getByTestId('chart-data-label')).toHaveCount(0, CHART_TIMEOUT);
});

Then(
  'the bar \\{{string}\\} of the dashboard widget \\{{string}\\} extends below the zero line',
  async ({ page }, label: string, viewName: string) => {
    const chart = widgetChart(page, viewName);

    await expect.poll(async () => {
      const bar = await (await barPath(chart, label)).boundingBox();
      const zero = await zeroLine(chart);

      // A bar hangs from the zero line (a tiny value is a sliver of a pixel).
      return Boolean(bar && bar.y >= zero.y - 1 && bar.y + bar.height > zero.y);
    }, CHART_TIMEOUT).toBe(true);
  }
);

Then(
  'the bar \\{{string}\\} of the dashboard widget \\{{string}\\} extends above the zero line',
  async ({ page }, label: string, viewName: string) => {
    const chart = widgetChart(page, viewName);

    await expect.poll(async () => {
      const bar = await (await barPath(chart, label)).boundingBox();
      const zero = await zeroLine(chart);

      return Boolean(bar && bar.y + bar.height <= zero.y + 1 && bar.y < zero.y);
    }, CHART_TIMEOUT).toBe(true);
  }
);

Then(
  'the bar \\{{string}\\} of the dashboard widget \\{{string}\\} extends left of the zero line',
  async ({ page }, label: string, viewName: string) => {
    const chart = widgetChart(page, viewName);

    await expect.poll(async () => {
      const bar = await (await barPath(chart, label)).boundingBox();
      const zero = await zeroLine(chart);

      return Boolean(bar && bar.x < zero.x && bar.x + bar.width <= zero.x + 1);
    }, CHART_TIMEOUT).toBe(true);
  }
);

Then('the category labels of the dashboard widget \\{{string}\\} are rotated', async ({ page }, viewName: string) => {
  const labels = widgetChart(page, viewName).getByTestId('chart-category-label');

  await expect(labels.first()).toBeVisible(CHART_TIMEOUT);
  await expect
    .poll(() => labels.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-rotated') === 'true')), CHART_TIMEOUT)
    .toBe(true);
});

Then('the category labels of the dashboard widget \\{{string}\\} are horizontal', async ({ page }, viewName: string) => {
  const labels = widgetChart(page, viewName).getByTestId('chart-category-label');

  await expect(labels.first()).toBeVisible(CHART_TIMEOUT);
  await expect
    .poll(() => labels.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-rotated') === 'false')), CHART_TIMEOUT)
    .toBe(true);
});

Then(
  'the first category label of the dashboard widget \\{{string}\\} ends with an ellipsis',
  async ({ page }, viewName: string) => {
    const first = widgetChart(page, viewName).getByTestId('chart-category-label').first();

    await expect(first).toBeVisible(CHART_TIMEOUT);
    // The `<title>` holds the full name; the drawn text is the rest.
    await expect
      .poll(() => first.evaluate((node) => Array.from(node.childNodes).filter((child) => child.nodeType === 3).map((child) => child.textContent).join('')), CHART_TIMEOUT)
      .toMatch(/…$/);
  }
);

// ---------------------------------------------------------------------------
// Hover and tooltip
// ---------------------------------------------------------------------------

When(
  'the user hovers the category \\{{string}\\} of the dashboard widget \\{{string}\\}',
  async ({ page }, label: string, viewName: string) => {
    await hoverChartCategory(page, widgetChart(page, viewName), label);
  }
);

When('the user hovers the first category of the dashboard widget \\{{string}\\}', async ({ page }, viewName: string) => {
  const chart = widgetChart(page, viewName);

  await expect.poll(async () => (await chartTable(chart)).length, CHART_TIMEOUT).toBeGreaterThan(0);
  const label = (await chartTable(chart))[0].label;

  await hoverChartCategory(page, chart, label);
  hoveredCategory.set(page, label);
});

Then('the chart tooltip shows \\{{string}\\} with the value \\{{string}\\}', async ({ page }, name: string, value: string) => {
  const tooltip = chartTooltip(page);

  await expect(tooltip).toBeVisible(CHART_TIMEOUT);
  await expect(tooltip.getByTestId('chart-tooltip-name')).toHaveText(name);
  await expect(tooltip.getByTestId('chart-tooltip-value')).toHaveText(value);
});

Then('the chart tooltip offers \\{{string}\\}', async ({ page }, text: string) => {
  await expect(chartTooltip(page).getByTestId('chart-tooltip-footer')).toHaveText(text, CHART_TIMEOUT);
});

Then('the chart tooltip shows the full name of that category', async ({ page }) => {
  const label = hoveredCategory.get(page);

  expect(label, 'no category was hovered').toBeTruthy();
  await expect(chartTooltip(page).getByTestId('chart-tooltip-name')).toHaveText(label as string, CHART_TIMEOUT);
});

Then(
  'the dashboard widget \\{{string}\\} highlights the category \\{{string}\\}',
  async ({ page }, viewName: string, label: string) => {
    const chart = widgetChart(page, viewName);
    const band = chart.locator('.recharts-tooltip-cursor');

    await expect(band).toBeVisible(CHART_TIMEOUT);
    expect(await band.getAttribute('fill')).toBe('var(--chart-hover-band)');
    const point = await categoryPoint(chart, label);
    const box = await band.boundingBox();

    expect(box && point.x >= box.x && point.x <= box.x + box.width, `the band does not cover "${label}"`).toBe(true);
  }
);

When('the pointer leaves the dashboard widget \\{{string}\\}', async ({ page }, _viewName: string) => {
  await page.mouse.move(0, 0);
});

Then('no chart tooltip is shown', async ({ page }) => {
  await expect(chartTooltip(page)).toHaveCount(0, CHART_TIMEOUT);
});

When(
  'the \\{{string}\\} of \\{{string}\\} in \\{{string}\\} changes to \\{{string}\\} in the background',
  async ({ page }, property: string, rowTitle: string, databaseName: string, value: string) => {
    await writeCellInBackground(page, databaseName, rowTitle, property, value);
  }
);

// ---------------------------------------------------------------------------
// Donuts, colors, lines and legends
// ---------------------------------------------------------------------------

Then(
  'the dashboard widget \\{{string}\\} shows the donut total \\{{string}\\} over \\{{string}\\}',
  async ({ page }, viewName: string, total: string, caption: string) => {
    const chart = widgetChart(page, viewName);

    await expect(chart.getByTestId('chart-donut-total')).toHaveText(total, CHART_TIMEOUT);
    await expect(chart.getByTestId('chart-donut-caption')).toHaveText(caption);
  }
);

Then(
  'the dashboard widget \\{{string}\\} shows the outside label \\{{string}\\}',
  async ({ page }, viewName: string, text: string) => {
    await expect(
      widgetChart(page, viewName).locator('.recharts-pie-labels [data-testid="chart-donut-outside-label"]').filter({ hasText: text })
    ).toHaveText(text, CHART_TIMEOUT);
  }
);

Then(
  'the dashboard widget \\{{string}\\} shows no outside label for \\{{string}\\}',
  async ({ page }, viewName: string, label: string) => {
    const chart = widgetChart(page, viewName);

    // The anchors appear with the labels, once the ring is drawn.
    await expect(chart.locator(`[data-testid="chart-donut-slice-anchor"][data-label="${label}"]`)).toHaveCount(1, CHART_TIMEOUT);
    await expect(chart.locator(`[data-testid="chart-donut-outside-label"][data-label="${label}"]`)).toHaveCount(0);
  }
);

async function expectCategoryColors(chart: Locator, expected: Record<string, string>) {
  await expect
    .poll(async () => {
      const rows = await chartTable(chart);

      return Object.fromEntries(rows.filter((row) => row.label in expected).map((row) => [row.label, row.color]));
    }, CHART_TIMEOUT)
    .toEqual(Object.fromEntries(Object.entries(expected).map(([label, color]) => [label, color.toUpperCase()])));
  // The table reports what is drawn: the first mark has the first category's color.
  const first = (await chartTable(chart))[0];
  const fill = await chart.locator('.recharts-bar-rectangle path, .recharts-pie-sector path').first().getAttribute('fill');

  expect(fill?.toUpperCase()).toBe(first.color);
}

Then(
  'the dashboard widget \\{{string}\\} colors the categories \\{{string}\\}',
  async ({ page }, viewName: string, colors: string) => {
    await expectCategoryColors(widgetChart(page, viewName), parseLabelMap(colors));
  }
);

Then(
  'the dashboard widget \\{{string}\\} colors the category \\{{string}\\} with \\{{string}\\}',
  async ({ page }, viewName: string, label: string, color: string) => {
    await expectCategoryColors(widgetChart(page, viewName), { [label]: color });
  }
);

Then('the chart colors its categories in display order with \\{{string}\\}', async ({ page }, colors: string) => {
  const expected = splitList(colors).map((color) => color.toUpperCase());

  await expect.poll(async () => (await chartTable(pageChart(page))).map((row) => row.color), CHART_TIMEOUT).toEqual(expected);
});

Then('the dashboard widget \\{{string}\\} draws a smooth line', async ({ page }, viewName: string) => {
  const curve = widgetChart(page, viewName).locator('.recharts-line-curve');

  await expect(curve).toBeVisible(CHART_TIMEOUT);
  expect(await curve.getAttribute('d')).toContain('C');
  expect(await curve.getAttribute('stroke-width')).toBe('1.5');
});

Then('the dashboard widget \\{{string}\\} shows no data points', async ({ page }, viewName: string) => {
  const chart = widgetChart(page, viewName);

  await expect(chart.locator('.recharts-line-curve')).toBeVisible(CHART_TIMEOUT);
  await expect(chart.locator('.recharts-dot')).toHaveCount(0);
  await expect(chart.locator('.recharts-active-dot')).toHaveCount(0);
});

Then(
  'the dashboard widget \\{{string}\\} shows a data point at \\{{string}\\}',
  async ({ page }, viewName: string, label: string) => {
    const chart = widgetChart(page, viewName);
    const dot = chart.locator('.recharts-active-dot');

    await expect(dot).toHaveCount(1, CHART_TIMEOUT);
    const box = await dot.boundingBox();
    const anchor = await chart.locator(`[data-testid="chart-category-anchor"][data-label="${label}"]`).boundingBox();

    expect(box && anchor && box.x + box.width / 2 >= anchor.x && box.x + box.width / 2 <= anchor.x + anchor.width).toBe(true);
  }
);

Then(
  'the dashboard widget \\{{string}\\} shows the legend \\{{string}\\}',
  async ({ page }, viewName: string, items: string) => {
    const legend = widgetChart(page, viewName).getByTestId('chart-legend');

    await expect(legend).toBeVisible(CHART_TIMEOUT);
    await expect(legend.getByTestId('chart-legend-item')).toHaveText(splitList(items));
  }
);

Then('the chart shows no legend', async ({ page }) => {
  await expect(pageChart(page).locator('.recharts-wrapper')).toBeVisible(CHART_TIMEOUT);
  await expect(pageChart(page).getByTestId('chart-legend')).toHaveCount(0, CHART_TIMEOUT);
});

Then('the legend of the dashboard widget \\{{string}\\} is paginated', async ({ page }, viewName: string) => {
  await expect(widgetChart(page, viewName).getByTestId('chart-legend-pager')).toBeVisible(CHART_TIMEOUT);
});

When('the user shows the next legend page of the dashboard widget \\{{string}\\}', async ({ page }, viewName: string) => {
  await widgetChart(page, viewName).getByTestId('chart-legend-next').click();
});

Then(
  'the legend of the dashboard widget \\{{string}\\} shows page \\{{int}\\}',
  async ({ page }, viewName: string, pageNumber: number) => {
    await expect(widgetChart(page, viewName).getByTestId('chart-legend-page')).toHaveText(
      new RegExp(`^${pageNumber}/`),
      CHART_TIMEOUT
    );
  }
);

// ---------------------------------------------------------------------------
// Empty charts
// ---------------------------------------------------------------------------

Then(
  'the dashboard widget \\{{string}\\} shows an empty donut ring with \\{{string}\\}',
  async ({ page }, viewName: string, text: string) => {
    const chart = widgetChart(page, viewName);

    await expect(chart.getByTestId('chart-donut-empty-ring')).toBeVisible(CHART_TIMEOUT);
    await expect(chart.getByTestId('chart-no-data')).toHaveText(text);
  }
);

Then('the dashboard widget \\{{string}\\} shows \\{{string}\\}', async ({ page }, viewName: string, text: string) => {
  await expect(widgetChart(page, viewName).getByTestId('chart-no-data')).toHaveText(text, CHART_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Style settings
// ---------------------------------------------------------------------------

When('the user sets the chart decimal places to \\{{string}\\}', async ({ page }, value: string) => {
  const option = value === 'Auto' ? 'auto' : value;

  await pickChartStyleOption(page, 'chart-style-decimal-places', `chart-style-decimal-places-option-${option}`);
});

When('the user sets the chart color to \\{{string}\\}', async ({ page }, theme: string) => {
  await pickChartStyleOption(page, 'chart-style-color', `chart-style-color-option-${theme.toLowerCase()}`);
});

When('the user sets the chart legend to \\{{string}\\}', async ({ page }, position: string) => {
  await pickChartStyleOption(page, 'chart-style-legend', `chart-style-legend-option-${position.toLowerCase()}`);
});

When('the user turns off the chart data labels', async ({ page }) => {
  await toggleChartStyleRow(page, 'chart-style-data-labels');
});

Then(
  'the chart view \\{{string}\\} stores \\{{string}\\} as \\{{string}\\}',
  async ({ page, request }, viewName: string, key: string, value: string) => {
    await expectStored(page, viewName, key, value);
    // Saved for everyone: the server holds what the browser wrote.
    const view = namedView(page, viewName);

    await waitForViewSync(page, request, view.database, [view.viewId]);
  }
);
