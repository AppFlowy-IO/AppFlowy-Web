/**
 * Chart test helpers for Playwright E2E tests.
 * Migrated from: cypress/support (chart_view branch)
 */
import { Page, expect } from '@playwright/test';

import {
  chartAggregationOf,
  chooseChartCalculation,
  chooseChartYProperty,
  closeChartPanel,
  openChartPagePanel,
} from './chart-settings-helpers';
import {
  ChartDrilldownSelectors,
  ChartSelectors,
  ChartSettingsSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from './selectors';

export { mockProSubscription } from './subscription-test-helpers';

/**
 * Wait for the chart container and its inner Recharts SVG to be present.
 * Recharts renders an `.recharts-wrapper` once the chart sized.
 */
export async function waitForChartReady(page: Page): Promise<void> {
  await expect(ChartSelectors.chart(page)).toBeVisible({ timeout: 15000 });
  await expect(ChartSelectors.anyChart(page)).toBeVisible({ timeout: 15000 });
}

/**
 * Add a Chart view tab to an already-open database via the "+" tab button.
 */
export async function addChartViewTab(page: Page): Promise<void> {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });
  await page.waitForTimeout(1000);
  await DatabaseViewSelectors.viewTypeOption(page, 'Chart').click({ force: true });
  await page.waitForTimeout(3000);
}

/**
 * Type a single-select option into the Type cell of a row index.
 * Mirrors the Cypress flow used in chart-basic.cy.ts.
 */
export async function setSelectOptionOnRow(
  page: Page,
  rowIndex: number,
  optionName: string,
): Promise<void> {
  const cell = DatabaseGridSelectors.dataRows(page).nth(rowIndex).locator('.grid-row-cell').nth(1);

  await cell.click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.type(optionName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Open the chart settings panel (gear button → "Chart settings ›"). Waits for
 * the panel so callers can immediately interact.
 */
export async function openChartSettings(page: Page): Promise<void> {
  await openChartPagePanel(page);
}

/**
 * Close any open menu (the panel's page first, then the menus).
 */
export async function closeDropdown(page: Page): Promise<void> {
  await closeChartPanel(page);
}

/**
 * Pick a calculation the way the panel offers it, property first: "Count"
 * (Count all) clears the property; any other label first sets "What to show"
 * to `property` (when given), then picks the calculation. Closes the panel so
 * the Yjs write can settle and the next openChartSettings() starts clean.
 */
export async function selectAggregation(page: Page, label: string, property?: string): Promise<void> {
  const aggregation = chartAggregationOf(label);

  if (aggregation === 0) {
    await chooseChartYProperty(page, null);
  } else {
    if (property) await chooseChartYProperty(page, property);
    await chooseChartCalculation(page, aggregation);
  }

  await closeDropdown(page);
}

/**
 * Click a chart type icon button of the open panel, then close it. The old
 * menu labels map to the buttons: Bar → Vertical bar, Horizontal Bar →
 * Horizontal bar, Line, Donut, Number.
 */
export async function selectChartType(page: Page, label: string): Promise<void> {
  const button = ChartSettingsSelectors.chartTypeButton(page, label);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await closeDropdown(page);
}

/**
 * Click the "Show empty values" switch row of the open panel and close it.
 */
export async function toggleShowEmptyValues(page: Page): Promise<void> {
  await ChartSettingsSelectors.showEmptyToggle(page).click();
  await closeDropdown(page);
}

/**
 * Click the "Cumulative" switch row of the open panel and close it.
 */
export async function toggleCumulative(page: Page): Promise<void> {
  await ChartSettingsSelectors.cumulativeToggle(page).click();
  await closeDropdown(page);
}

/**
 * Click the first rendered bar in a Bar chart to open the drilldown popup.
 */
export async function clickFirstBar(page: Page): Promise<void> {
  await ChartSelectors.bars(page).first().click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Wait for the drilldown popup dialog to be visible.
 */
export async function waitForDrilldownOpen(page: Page): Promise<void> {
  await expect(ChartDrilldownSelectors.dialog(page)).toBeVisible({ timeout: 10000 });
}

/**
 * Close the drill-down with Escape (it closes the innermost layer, WP13
 * §3.12) and wait until it has gone.
 */
export async function closeDrilldown(page: Page): Promise<void> {
  const dialog = ChartDrilldownSelectors.dialog(page);

  await page.keyboard.press('Escape');
  // Focus inside a chip editor or the search swallows the first Escape: retry once with Dismiss.
  const closed = await dialog
    .waitFor({ state: 'detached', timeout: 2000 })
    .then(() => true)
    .catch(() => false);

  if (!closed) {
    await ChartDrilldownSelectors.closeButton(page).click();
  }

  await expect(dialog).toHaveCount(0, { timeout: 10000 });
}
