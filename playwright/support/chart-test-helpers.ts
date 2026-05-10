/**
 * Chart test helpers for Playwright E2E tests.
 * Migrated from: cypress/support (chart_view branch)
 */
import { Page, expect } from '@playwright/test';

import {
  ChartDrilldownSelectors,
  ChartSelectors,
  ChartSettingsSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from './selectors';

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
 * Open the Chart settings submenu (gear button → "Chart settings"). Waits for
 * the X-Axis section to be visible so callers can immediately interact.
 */
export async function openChartSettings(page: Page): Promise<void> {
  // Make sure no stale menu is open from a previous interaction.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);

  await ChartSettingsSelectors.settingsButton(page).click({ force: true });
  await page.waitForTimeout(400);
  await ChartSettingsSelectors.chartSettingsSubTrigger(page).click({ force: true });
  await page.waitForTimeout(400);
  await expect(ChartSettingsSelectors.xAxisLabel(page)).toBeVisible({ timeout: 5000 });
  await expect(ChartSettingsSelectors.aggregationLabel(page)).toBeVisible({ timeout: 5000 });
}

/**
 * Close any open dropdown by pressing Escape twice (covers nested submenus).
 */
export async function closeDropdown(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
}

/**
 * Click an aggregation option (e.g. "Count", "Sum") inside the open chart
 * settings dropdown, then close the dropdown so the Yjs write can settle and
 * the next openChartSettings() starts from a clean state.
 */
export async function selectAggregation(page: Page, label: string): Promise<void> {
  await ChartSettingsSelectors.aggregationItem(page, label).click({ force: true });
  await page.waitForTimeout(300);
  await closeDropdown(page);
}

/**
 * Click a chart-type row (Bar / Horizontal Bar / Line / Donut) in the open
 * chart settings dropdown, then close it. Chart type now lives as a flat
 * section at the bottom of the chart settings submenu.
 */
export async function selectChartType(page: Page, label: string): Promise<void> {
  const item = ChartSettingsSelectors.chartTypeItem(page, label);

  await item.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(150);
  await item.click({ force: true });
  await page.waitForTimeout(400);
  await closeDropdown(page);
}

/**
 * Click the "Show empty values" toggle row inside the open chart settings
 * dropdown and close it. The on/off state isn't returned because only the
 * resulting visual change is observable from outside.
 */
export async function toggleShowEmptyValues(page: Page): Promise<void> {
  await ChartSettingsSelectors.showEmptyValuesItem(page).click({ force: true });
  await page.waitForTimeout(300);
  await closeDropdown(page);
}

/**
 * Click the "Cumulative" toggle row inside the open chart settings dropdown
 * and close it.
 */
export async function toggleCumulative(page: Page): Promise<void> {
  await ChartSettingsSelectors.cumulativeItem(page).click({ force: true });
  await page.waitForTimeout(300);
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
 * Close the drilldown popup via Escape (more reliable than targeting the X
 * button when MUI renders multiple buttons inside Dialog).
 */
export async function closeDrilldown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
