/**
 * Helpers that drive the chart settings panel (WP11): on a chart page it opens
 * from the gear menu's "Chart settings ›", in a dashboard widget it is the
 * body of the widget's settings host. Rows, options and items are found by
 * their test ids; labels are read the way a user reads them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { expect, Locator, Page } from '@playwright/test';

import { ChartSettingsSelectors } from './selectors';

const PANEL_TIMEOUT = { timeout: 15_000 };
/** The `layout_settings` key of a chart view's settings. */
const CHART_LAYOUT_KEY = '3';

/** Aggregation labels (WP11 §1.14, and the old menu's "Count" / "Count values") → `aggregation_type`. */
export const CHART_AGGREGATION_BY_NAME: Record<string, number> = {
  Count: 0,
  'Count all': 0,
  Sum: 1,
  Average: 2,
  Min: 3,
  Max: 4,
  Median: 5,
  'Count unique values': 6,
  'Count values': 7,
  'Count empty': 8,
  'Percent empty': 9,
  'Percent not empty': 10,
  'Percent checked': 11,
  'Percent unchecked': 12,
  Earliest: 13,
  Latest: 14,
  'Date range': 15,
  Range: 16,
};

export function chartAggregationOf(label: string): number {
  const aggregation = CHART_AGGREGATION_BY_NAME[label];

  if (aggregation === undefined) throw new Error(`Unknown chart calculation "${label}"`);
  return aggregation;
}

export function chartPanel(page: Page): Locator {
  return ChartSettingsSelectors.panel(page);
}

/**
 * Point at the open "Chart settings" submenu the way a user does: across into
 * the submenu at the trigger's height first (a straight jump from the trigger
 * crosses the root menu, which closes the submenu).
 */
async function pointIntoChartSubmenu(page: Page) {
  const trigger = await ChartSettingsSelectors.chartSettingsSubTrigger(page).boundingBox();
  const panel = await chartPanel(page).boundingBox();

  if (!trigger || !panel) return;
  await page.mouse.move(panel.x + panel.width / 2, trigger.y + trigger.height / 2, { steps: 10 });
}

/** Open the panel of the open chart page: gear → "Chart settings ›". */
export async function openChartPagePanel(page: Page) {
  await closeChartPanel(page);
  await ChartSettingsSelectors.settingsButton(page).first().click();
  const trigger = ChartSettingsSelectors.chartSettingsSubTrigger(page);

  await expect(trigger).toBeVisible(PANEL_TIMEOUT);
  await trigger.click();
  await expect(chartPanel(page)).toBeVisible(PANEL_TIMEOUT);
  await pointIntoChartSubmenu(page);
}

/** Close the panel and its host (Escape returns from a page first, then closes). */
export async function closeChartPanel(page: Page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const open = (await page.locator('[role="menu"]').count()) > 0 || (await chartPanel(page).count()) > 0;

    if (!open) return;
    await page.keyboard.press('Escape');
  }

  await expect(page.locator('[role="menu"]')).toHaveCount(0);
}

/** Back to the panel's root page if a page is open. */
export async function backToChartPanelRoot(page: Page) {
  const panel = chartPanel(page);

  await expect(panel).toBeVisible(PANEL_TIMEOUT);
  if ((await panel.getAttribute('data-page')) !== 'root') await ChartSettingsSelectors.back(page).click();
  await expect(panel).toHaveAttribute('data-page', 'root');
}

/** Open the page of a root row (`x_sort`, `y_calculate`, …). */
export async function openChartPanelRow(page: Page, rowId: string) {
  await backToChartPanelRoot(page);
  const row = ChartSettingsSelectors.row(page, rowId);

  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(chartPanel(page)).toHaveAttribute('data-page', rowId);
}

/** The root row with `label` in the section titled `section` (or anywhere on the root page). */
export function chartPanelRowByLabel(page: Page, label: string, section?: string): Locator {
  const scope = section ? ChartSettingsSelectors.section(page, section) : chartPanel(page);

  return scope.locator('[data-row-id]').filter({ has: page.locator('span.flex-1', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Open a row by its label (`"Calculate"` in `"Data"`). */
export async function openChartPanelRowByLabel(page: Page, label: string, section?: string) {
  await backToChartPanelRoot(page);
  const row = chartPanelRowByLabel(page, label, section).first();

  await expect(row).toBeVisible(PANEL_TIMEOUT);
  await row.click();
  await expect(chartPanel(page)).not.toHaveAttribute('data-page', 'root');
}

/** Pick a property on an open field page by its name; the panel returns to the root. */
export async function pickChartPanelField(page: Page, name: string) {
  const item = ChartSettingsSelectors.fieldItemByName(page, name);

  await expect(item).toBeVisible(PANEL_TIMEOUT);
  await item.click();
  await expect(chartPanel(page)).toHaveAttribute('data-page', 'root');
}

/** Set "What to show" of the value axis: a property by name, or "Count all" for `null`. */
export async function chooseChartYProperty(page: Page, name: string | null) {
  await openChartPanelRow(page, 'y_what');
  if (name === null) {
    await ChartSettingsSelectors.fieldNone(page).click();
    await expect(chartPanel(page)).toHaveAttribute('data-page', 'root');
    return;
  }

  await pickChartPanelField(page, name);
}

/** Set "What to show" of the category axis to a property by name. */
export async function chooseChartXProperty(page: Page, name: string) {
  await openChartPanelRow(page, 'x_what');
  await pickChartPanelField(page, name);
}

/** Pick a calculation on the Calculate page (opening it when needed). */
export async function chooseChartCalculation(page: Page, aggregation: number) {
  if ((await chartPanel(page).getAttribute('data-page')) !== 'y_calculate') await openChartPanelRow(page, 'y_calculate');
  const item = ChartSettingsSelectors.aggItem(page, aggregation);

  await item.click();
  // Count all clears the property, so the Calculate page (and row) goes away.
  if (aggregation === 0) await expect(chartPanel(page)).toHaveAttribute('data-page', 'root');
  else await expect(item).toHaveAttribute('aria-checked', 'true');
}

/** Pick an option of a single-choice page by its visible label (Sort by, Group by text, …). */
export async function chooseChartPanelOption(page: Page, label: string) {
  const option = chartPanel(page).getByRole('menuitemradio', { name: label, exact: true });

  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
}

/** The non-empty section titles of the root page, in order. */
export async function chartPanelSectionTitles(page: Page): Promise<string[]> {
  await backToChartPanelRoot(page);
  return chartPanel(page)
    .locator('[data-section-title]')
    .evaluateAll((sections) => sections.map((section) => section.getAttribute('data-section-title') ?? '').filter(Boolean));
}

/** The row labels of a section (or the whole root page), in order. */
export async function chartPanelRowLabels(page: Page, section?: string): Promise<string[]> {
  await backToChartPanelRoot(page);
  const scope = section ? ChartSettingsSelectors.section(page, section) : chartPanel(page);

  return scope
    .locator('[data-row-id]')
    .evaluateAll((rows) => rows.map((row) => row.querySelector('span.flex-1')?.textContent?.trim() ?? ''));
}

/** The labels of the chart type buttons, in order, and the selected one. */
export async function chartTypeButtons(page: Page): Promise<{ labels: string[]; selected: string[] }> {
  return page
    .getByTestId('chart-type-row')
    .locator('button')
    .evaluateAll((buttons) => ({
      labels: buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      selected: buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.getAttribute('aria-label') ?? ''),
    }));
}

/** The Calculate page groups as "Count: Count all, Count values; Percent: …". */
export async function chartCalculateMenuText(page: Page): Promise<string> {
  return chartPanel(page)
    .locator('[data-testid^="chart-agg-group-"]')
    .evaluateAll((groups) =>
      groups
        .map((group) => {
          const header = group.querySelector('[data-agg-group-header]')?.textContent?.trim() ?? '';
          const items = Array.from(group.querySelectorAll('[data-testid^="chart-agg-"]:not([data-testid^="chart-agg-group-"])')).map(
            (item) => item.textContent?.trim() ?? ''
          );

          return `${header}: ${items.join(', ')}`;
        })
        .join('; ')
    );
}

/** A chart view's stored chart map (snake_case keys, numbers as numbers), from the browser's doc. */
export async function readStoredChartMap(page: Page, viewId: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ id, layoutKey }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const view = bridge?.byView(id)?.databaseDoc.getMap('data').get('database').get('views').get(id);
      const setting = view?.get('layout_settings')?.get(layoutKey);
      const plain = (value: unknown): unknown => {
        if (typeof value === 'bigint') return Number(value);
        if (value && typeof (value as any).toJSON === 'function') return plain((value as any).toJSON());
        if (Array.isArray(value)) return value.map(plain);
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
        }

        return value;
      };

      if (!setting) return {};
      const result: Record<string, unknown> = {};

      setting.forEach((value: unknown, key: string) => {
        result[key] = plain(value);
      });
      return result;
    },
    { id: viewId, layoutKey: CHART_LAYOUT_KEY }
  );
}

/** Poll one stored chart key until it equals `expected`. */
export async function expectStoredChartKey(page: Page, viewId: string, key: string, expected: unknown) {
  await expect.poll(async () => (await readStoredChartMap(page, viewId))[key], PANEL_TIMEOUT).toEqual(expected);
}
