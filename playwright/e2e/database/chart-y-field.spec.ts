/**
 * Chart settings — the value property with a numeric column present (WP11).
 *
 *  - The property comes first: picking a Number property in "What to show"
 *    writes it with its default calculation, Sum (`defaultAggregationFor`).
 *  - The picked property carries the check in the property list.
 *  - Switching the calculation back to Count all clears the property and
 *    hides the Calculate row.
 */
import { expect, test } from '@playwright/test';

import { chooseChartCalculation, chooseChartYProperty, openChartPanelRow } from '../../support/chart-settings-helpers';
import { addChartViewTab, closeDropdown, openChartSettings, waitForChartReady } from '../../support/chart-test-helpers';
import {
  addPropertyColumn,
  signInAndCreateDatabaseView,
} from '../../support/database-ui-helpers';
import { ChartSettingsSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/** The name a new Number property gets (`grid.field.numberFieldName`). */
const NUMBER_FIELD = 'Numbers';

test.describe('Chart settings — Y-axis with numeric field', () => {
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

  test('picking a number property writes it with Sum', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a Number column added → the chart can sum it.
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.Number);
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Default state: Count all, nothing to calculate.
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText('Count all');
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toHaveCount(0);

    // When: the user picks the Number property in "What to show"
    await chooseChartYProperty(page, NUMBER_FIELD);
    await closeDropdown(page);
    await openChartSettings(page);

    // Then: the property is shown, calculated as Sum
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText(NUMBER_FIELD, { timeout: 5000 });
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toContainText('Sum');
    await openChartPanelRow(page, 'y_calculate');
    await expect(ChartSettingsSelectors.aggItem(page, 1)).toHaveAttribute('aria-checked', 'true');

    // And: the picked property carries the check in the property list.
    await openChartPanelRow(page, 'y_what');
    await expect(ChartSettingsSelectors.fieldItemByName(page, NUMBER_FIELD)).toHaveAttribute('aria-checked', 'true');
    await expect(ChartSettingsSelectors.fieldNone(page)).toHaveAttribute('aria-checked', 'false');
  });

  test('switching to Count all clears the property', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.Number);
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Take the Number property first, then switch the calculation back to Count all
    await openChartSettings(page);
    await chooseChartYProperty(page, NUMBER_FIELD);
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toBeVisible({ timeout: 5000 });

    await chooseChartCalculation(page, 0);
    await closeDropdown(page);
    await openChartSettings(page);

    // Calculate is gone again, and "What to show" counts all rows
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toHaveCount(0);
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText('Count all');
    await openChartPanelRow(page, 'y_what');
    await expect(ChartSettingsSelectors.fieldNone(page)).toHaveAttribute('aria-checked', 'true');
  });
});
