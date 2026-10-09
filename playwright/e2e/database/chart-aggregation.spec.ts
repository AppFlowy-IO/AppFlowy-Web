/**
 * Chart settings — calculations (WP11 panel).
 *
 * The chart settings panel is property first: "What to show" picks the
 * property (or Count all), and the Calculate row appears once a property is
 * picked, grouped as Count › Percent › More options for the property's type.
 *
 *  - Count all is the default; there is no Calculate row.
 *  - A checkbox offers Count all, Count values, Count unique values, Count
 *    empty, then Percent checked, Percent unchecked, in that order.
 *  - Picking a property reveals Calculate with the type's default (Percent
 *    checked for a checkbox).
 *  - Count values keeps the property (it counts the property's values).
 *  - Picking Count all clears the property and hides Calculate again.
 */
import { expect, test } from '@playwright/test';

import { chooseChartCalculation, chooseChartYProperty, openChartPanelRow } from '../../support/chart-settings-helpers';
import { addChartViewTab, openChartSettings, selectAggregation } from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/** The default grid's checkbox property. */
const CHECKBOX = 'Done';

test.describe('Chart settings — Aggregation', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('shows Count all and no Calculate row by default', async ({ page, request }) => {
    // Given: a fresh chart view sitting on top of a grid
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // Then: "What to show" counts all rows and there is nothing to calculate yet.
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText('Count all');
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toHaveCount(0);
  });

  test('lists the checkbox calculations in Notion order', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);
    await chooseChartYProperty(page, CHECKBOX);
    await openChartPanelRow(page, 'y_calculate');

    const expected: [number, string][] = [
      [0, 'Count all'],
      [7, 'Count values'],
      [6, 'Count unique values'],
      [8, 'Count empty'],
      [11, 'Percent checked'],
      [12, 'Percent unchecked'],
    ];

    for (const [aggregation, label] of expected) {
      await expect(ChartSettingsSelectors.aggItem(page, aggregation)).toHaveText(label);
    }

    // A checkbox has no "More options" (Sum and the like are for numbers).
    await expect(page.getByTestId('chart-agg-group-more')).toHaveCount(0);
    await expect(page.getByTestId('chart-agg-group-count')).toContainText('Count');
    await expect(page.getByTestId('chart-agg-group-percent')).toContainText('Percent');

    // Order: each item sits below the previous one.
    const tops = await Promise.all(
      expected.map(async ([aggregation]) => (await ChartSettingsSelectors.aggItem(page, aggregation).boundingBox())?.y ?? -1)
    );

    expect(tops.every((top) => top > 0)).toBe(true);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]).toBeGreaterThan(tops[i - 1]);
    }
  });

  test('picking a property reveals Calculate with its default and moves the tick', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // When: "What to show" becomes the checkbox property.
    await chooseChartYProperty(page, CHECKBOX);

    // Then: Calculate appears with the checkbox default, Percent checked.
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText(CHECKBOX);
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toContainText('Percent checked', { timeout: 5000 });

    // And: the tick is on Percent checked (not on Count all).
    await openChartPanelRow(page, 'y_calculate');
    await expect(ChartSettingsSelectors.aggItem(page, 11)).toHaveAttribute('aria-checked', 'true');
    await expect(ChartSettingsSelectors.aggItem(page, 0)).toHaveAttribute('aria-checked', 'false');
  });

  test('Count values keeps the property and its Calculate row', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    await selectAggregation(page, 'Count values', CHECKBOX);
    await openChartSettings(page);

    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toContainText('Count values', { timeout: 5000 });
    await openChartPanelRow(page, 'y_calculate');
    await expect(ChartSettingsSelectors.aggItem(page, 7)).toHaveAttribute('aria-checked', 'true');
  });

  test('switching back to Count all clears the property and hides Calculate', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // Take the property first, confirm Calculate is visible
    await chooseChartYProperty(page, CHECKBOX);
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toBeVisible({ timeout: 5000 });

    // Then switch the calculation back to Count all
    await chooseChartCalculation(page, 0);
    await expect(ChartSettingsSelectors.panel(page)).toHaveAttribute('data-page', 'root');
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toHaveCount(0);
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText('Count all');
  });
});
