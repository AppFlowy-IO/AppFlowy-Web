/**
 * Helpers of `dashboard-chart-series.feature` (WP12 §7.1): reading the bar
 * segments, data labels, legend and tooltip of a chart with a Group by, the
 * chart settings rows WP12 adds, and the "Tags" database of the caps
 * scenario. Charts are read through their test hooks: `chart-bar-segment`
 * (`data-category`, `data-series`, `data-series-index`, `data-value` and the
 * segment's own rectangle), `chart-data-label`, `chart-legend-item`, the
 * category anchors and the portal tooltip.
 */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { backToChartPanelRoot, chartPanel, chartPanelRowByLabel, chartPanelRowLabels } from './chart-settings-helpers';
import { dashboardWorld, FieldSpec, FieldType, splitList, widgetLocator } from './dashboard-test-helpers';
import {
  addUseCaseDatabase,
  addUseCaseRows,
  drillDown,
  namedView,
  rememberFieldTypes,
  rememberSelectOptions,
  USE_CASE_TIMEOUT,
  waitForViewSync,
} from './dashboard-usecase-helpers';

export const SERIES_TIMEOUT = { timeout: USE_CASE_TIMEOUT };

/** A drawn segment in SVG coordinates (its rectangle attributes, normalized), with its names and raw value. */
export interface ChartSegment {
  category: string;
  series: string;
  seriesIndex: number;
  value: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The chart root of a widget: the element that carries `data-group-style` and `data-series-count`. */
export function seriesChartRoot(page: Page, view: string): Locator {
  return widgetLocator(page, view).locator('[data-group-style]').first();
}

/** Wait until the widget draws a chart with this group style (`none` without a Group by). */
export async function expectGroupStyle(page: Page, view: string, style: string) {
  await expect(seriesChartRoot(page, view)).toHaveAttribute('data-group-style', style, SERIES_TIMEOUT);
}

/** Whether the chart's bars grow up (`vertical`) or right (`horizontal`). */
export async function barOrientation(page: Page, view: string): Promise<'vertical' | 'horizontal'> {
  const testId = await seriesChartRoot(page, view).getAttribute('data-testid');

  return testId === 'horizontal-bar-chart-widget' ? 'horizontal' : 'vertical';
}

/** Every drawn segment of the widget's chart, in DOM order. */
export async function chartSegments(page: Page, view: string): Promise<ChartSegment[]> {
  return widgetLocator(page, view)
    .locator('[data-testid="chart-bar-segment"]')
    .evaluateAll((segments) =>
      segments.map((segment) => {
        const x = Number(segment.getAttribute('x'));
        const y = Number(segment.getAttribute('y'));
        const width = Number(segment.getAttribute('width'));
        const height = Number(segment.getAttribute('height'));

        return {
          category: segment.getAttribute('data-category') ?? '',
          series: segment.getAttribute('data-series') ?? '',
          seriesIndex: Number(segment.getAttribute('data-series-index')),
          value: Number(segment.getAttribute('data-value')),
          left: Math.min(x, x + width),
          top: Math.min(y, y + height),
          width: Math.abs(width),
          height: Math.abs(height),
        };
      })
    );
}

function byCategory(segments: ChartSegment[]): Map<string, ChartSegment[]> {
  const groups = new Map<string, ChartSegment[]>();

  segments.forEach((segment) => groups.set(segment.category, [...(groups.get(segment.category) ?? []), segment]));
  return groups;
}

/**
 * Stacked: every category's non-zero segments share one centre on the
 * category axis and touch end to end along the value axis. Returns the
 * problems found (empty when the chart stacks).
 */
export function stackProblems(segments: ChartSegment[], orientation: 'vertical' | 'horizontal'): string[] {
  const problems: string[] = [];

  byCategory(segments).forEach((list, category) => {
    const centre = (segment: ChartSegment) =>
      orientation === 'vertical' ? segment.left + segment.width / 2 : segment.top + segment.height / 2;
    const start = (segment: ChartSegment) => (orientation === 'vertical' ? segment.top : segment.left);
    const length = (segment: ChartSegment) => (orientation === 'vertical' ? segment.height : segment.width);
    const sorted = [...list].sort((a, b) => start(a) - start(b));

    if (sorted.some((segment) => Math.abs(centre(segment) - centre(sorted[0])) > 1)) {
      problems.push(`${category}: segments are not on one centre`);
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const gap = start(sorted[index]) - (start(sorted[index - 1]) + length(sorted[index - 1]));

      if (Math.abs(gap) > 1) problems.push(`${category}: a ${gap.toFixed(1)}px gap between segments`);
    }
  });
  return problems;
}

/**
 * Side by side: the segments of a category stand in series order with
 * distinct centres, each slot one bar wide and 2px ± 1 from the next. A
 * series with no value in the category keeps its (empty) slot, so two drawn
 * bars around it are one slot further apart.
 */
export function sideBySideProblems(segments: ChartSegment[], orientation: 'vertical' | 'horizontal'): string[] {
  const problems: string[] = [];

  byCategory(segments).forEach((list, category) => {
    if (list.length < 2) return;
    const start = (segment: ChartSegment) => (orientation === 'vertical' ? segment.left : segment.top);
    const size = (segment: ChartSegment) => (orientation === 'vertical' ? segment.width : segment.height);
    const sorted = [...list].sort((a, b) => a.seriesIndex - b.seriesIndex);

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const gap = start(current) - (start(previous) + size(previous));
      const expected = 2 + (current.seriesIndex - previous.seriesIndex - 1) * (size(previous) + 2);

      if (Math.abs(gap - expected) > 1) {
        problems.push(`${category}: a ${gap.toFixed(1)}px gap between ${previous.series} and ${current.series}`);
      }
    }
  });
  return problems;
}

/** The plot length along the value axis: a category anchor spans the plot. */
export async function plotLength(page: Page, view: string, orientation: 'vertical' | 'horizontal'): Promise<number> {
  const anchor = widgetLocator(page, view).locator('[data-testid="chart-category-anchor"]').first();
  const value = await anchor.getAttribute(orientation === 'vertical' ? 'height' : 'width');

  return Number(value);
}

/** The value-axis tick texts, in DOM order (bottom to top, or left to right). */
export async function valueTickTexts(page: Page, view: string): Promise<string[]> {
  return widgetLocator(page, view)
    .locator('[data-testid="chart-value-tick"]')
    .evaluateAll((ticks) => ticks.map((tick) => (tick.textContent ?? '').trim()));
}

/** The legend's item labels, in order. */
export async function legendLabels(page: Page, view: string): Promise<string[]> {
  return widgetLocator(page, view)
    .getByTestId('chart-legend-item')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-label') ?? ''));
}

/** `"{series} {value}"` for the category's non-zero segments, in series order. */
export function categoryAsText(segments: ChartSegment[], category: string): string[] {
  return segments
    .filter((segment) => segment.category === category && segment.value !== 0)
    .sort((a, b) => a.seriesIndex - b.seriesIndex)
    .map((segment) => `${segment.series} ${segment.value}`);
}

/**
 * The data label texts, read along the category axis and then along the
 * value axis (WP12 §7.1).
 */
export async function dataLabelTexts(page: Page, view: string, orientation: 'vertical' | 'horizontal'): Promise<string[]> {
  const labels = await widgetLocator(page, view)
    .locator('[data-testid="chart-data-label"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return { text: (element.textContent ?? '').trim(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })
    );

  return labels
    .sort((a, b) => (orientation === 'vertical' ? a.x - b.x || b.y - a.y : a.y - b.y || a.x - b.x))
    .map((label) => label.text);
}

/** The rectangle of a category's band (its anchor), in viewport coordinates. */
export async function categoryBand(page: Page, view: string, category: string) {
  const anchor = widgetLocator(page, view).locator(`[data-testid="chart-category-anchor"][data-label="${category}"]`);

  await expect(anchor).toHaveCount(1, SERIES_TIMEOUT);
  await anchor.scrollIntoViewIfNeeded();
  const box = await anchor.boundingBox();

  if (!box) throw new Error(`The "${category}" band of "${view}" is not rendered`);
  return box;
}

/** Point at the middle of a category's band, the way a user hovers a bar. */
export async function hoverCategoryBand(page: Page, view: string, category: string) {
  const box = await categoryBand(page, view, category);

  await page.mouse.move(box.x + box.width / 2 - 1, box.y + box.height / 2 - 1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await expect(page.getByTestId('chart-tooltip')).toBeVisible(SERIES_TIMEOUT);
}

/** The open tooltip: its title and `"{name} {value}"` per series row. */
export async function tooltipContent(page: Page): Promise<{ title: string; rows: string[] }> {
  const tooltip = page.getByTestId('chart-tooltip');

  await expect(tooltip).toBeVisible(SERIES_TIMEOUT);
  const title = ((await tooltip.getByTestId('chart-tooltip-title').textContent()) ?? '').trim();
  const rows = await tooltip.getByTestId('chart-tooltip-row').evaluateAll((elements) =>
    elements.map((row) => {
      const name = (row.querySelector('[data-testid="chart-tooltip-name"]')?.textContent ?? '').trim();
      const value = (row.querySelector('[data-testid="chart-tooltip-value"]')?.textContent ?? '').trim();

      return `${name} ${value}`;
    })
  );

  return { title, rows };
}

/** Click one segment of a category's bar and wait for the drill-down. */
export async function clickSegment(page: Page, view: string, category: string, series: string) {
  const segment = widgetLocator(page, view).locator(
    `[data-testid="chart-bar-segment"][data-category="${category}"][data-series="${series}"]`
  );

  await expect(segment).toHaveCount(1, SERIES_TIMEOUT);
  // The bars animate in (and again when rows arrive): click the segment once it holds still.
  await expect(async () => {
    const before = await segment.boundingBox({ timeout: 1_000 });

    await page.waitForTimeout(150);
    expect(await segment.boundingBox({ timeout: 1_000 })).toEqual(before);
    expect(before).not.toBeNull();
  }).toPass(SERIES_TIMEOUT);
  await segment.click();
  await expect(drillDown(page)).toBeVisible(SERIES_TIMEOUT);
}

/** Click inside a category's band, 3px from its start and away from its bars, and wait for the drill-down. */
export async function clickBesideBars(page: Page, view: string, category: string) {
  const orientation = await barOrientation(page, view);
  const box = await categoryBand(page, view, category);

  if (orientation === 'vertical') await page.mouse.click(box.x + 3, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + 3);
  await expect(drillDown(page)).toBeVisible(SERIES_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Chart settings rows (WP12 §2.11)
// ---------------------------------------------------------------------------

/** The value a root row of the chart settings shows ("None", the property name…). */
export async function chartRowValue(page: Page, label: string): Promise<string> {
  await backToChartPanelRoot(page);
  const row = chartPanelRowByLabel(page, label).first();

  await expect(row).toBeVisible(SERIES_TIMEOUT);
  return ((await row.locator('[data-row-value]').textContent()) ?? '').trim();
}

/** Whether the root page of the chart settings shows a row with this label. */
export async function chartSettingsShowRow(page: Page, label: string): Promise<boolean> {
  return (await chartPanelRowLabels(page)).includes(label);
}

/** The group style segments: their labels and the pressed one. */
export async function groupStyleOptions(page: Page): Promise<{ labels: string[]; selected: string[] }> {
  const control = chartPanel(page).getByTestId('chart-group-style');

  await expect(control).toBeVisible(SERIES_TIMEOUT);
  return control.locator('button').evaluateAll((buttons) => ({
    labels: buttons.map((button) => (button.textContent ?? '').trim()),
    selected: buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => (button.textContent ?? '').trim()),
  }));
}

/**
 * Pick a group style by its label, and wait until the server holds the
 * settings of every widget view of the dashboard (a reload may follow).
 */
export async function chooseGroupStyle(page: Page, request: APIRequestContext, label: string) {
  const button = chartPanel(page).getByTestId('chart-group-style').getByRole('button', { name: label, exact: true });

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', SERIES_TIMEOUT);
  const byDatabase = new Map<string, string[]>();

  Object.keys(dashboardWorld(page).widgets).forEach((name) => {
    const { database, viewId } = namedView(page, name);

    byDatabase.set(database, [...(byDatabase.get(database) ?? []), viewId]);
  });
  for (const [database, viewIds] of byDatabase) await waitForViewSync(page, request, database, viewIds);
}

// ---------------------------------------------------------------------------
// The caps scenario's "Tags" database
// ---------------------------------------------------------------------------

/** `"T01"` to `"T52"` → the tags in between, keeping the prefix and the zero padding. */
export function tagRange(from: string, to: string): string[] {
  const first = /^(.*?)(\d+)$/.exec(from);
  const last = /^(.*?)(\d+)$/.exec(to);

  if (!first || !last || first[1] !== last[1]) throw new Error(`Cannot count from "${from}" to "${to}"`);
  const width = first[2].length;
  const tags: string[] = [];

  for (let number = Number(first[2]); number <= Number(last[2]); number += 1) {
    tags.push(`${first[1]}${String(number).padStart(width, '0')}`);
  }

  return tags;
}

/**
 * A database with a one-option "Kind" select (`All`) and a "Tag" select with
 * the tags in order, and one row per tag (`Row 01` … with `Kind = All`).
 */
export async function addTaggedDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  count: number,
  from: string,
  to: string
) {
  const tags = tagRange(from, to);

  if (tags.length !== count) throw new Error(`"${from}" to "${to}" is ${tags.length} tags, not ${count}`);
  const fields: FieldSpec[] = [
    { name: 'Kind', type: FieldType.SingleSelect, options: ['All'] },
    { name: 'Tag', type: FieldType.SingleSelect, options: tags },
  ];
  const width = String(count).length;

  await addUseCaseDatabase(page, request, name, fields);
  rememberFieldTypes(page, name, fields);
  rememberSelectOptions(page, name, fields);
  await addUseCaseRows(
    page,
    request,
    name,
    tags.map((tag, index) => ({ Name: `Row ${String(index + 1).padStart(width, '0')}`, Kind: 'All', Tag: tag }))
  );
}

/** The distinct series the widget's segments draw. */
export async function drawnGroups(page: Page, view: string): Promise<string[]> {
  return [...new Set((await chartSegments(page, view)).map((segment) => segment.series))];
}

/** The groups listed in a step: `"Business, Consumers"` → `['Business', 'Consumers']`. */
export function groupList(text: string): string[] {
  return splitList(text);
}
