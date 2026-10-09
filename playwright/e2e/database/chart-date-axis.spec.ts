/**
 * Chart settings — Date X-axis bucketing.
 *
 * When the X axis is a date-typed field (DateTime / LastEditedTime /
 * CreatedTime) the chart settings panel shows a "Date grouping" row whose
 * page offers Relative / Day / Week / Month / Year (WP11 §1.3).
 *
 * The default Grid template doesn't ship with a Date column, so we add one
 * before testing.
 */
import { expect, test } from '@playwright/test';

import { chooseChartXProperty, openChartPanelRow } from '../../support/chart-settings-helpers';
import {
  addChartViewTab,
  closeDropdown,
  openChartSettings,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import {
  addPropertyColumn,
  signInAndCreateDatabaseView,
} from '../../support/database-ui-helpers';
import { ChartSettingsSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Date X-axis', () => {
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

  test('selecting a date X axis field reveals the Date grouping row', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a DateTime column added. Default name comes from
    // `getFieldName(FieldType.DateTime)` → "Date".
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.DateTime);
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    // No date axis yet: no Date grouping row.
    await expect(ChartSettingsSelectors.row(page, 'x_date_grouping')).toHaveCount(0);

    // When: the X axis becomes the "Date" property
    await chooseChartXProperty(page, 'Date');

    // Then: a "Date grouping" row shows the default, Month, and its page offers all five options
    await expect(ChartSettingsSelectors.row(page, 'x_date_grouping')).toContainText('Month', { timeout: 5000 });
    await openChartPanelRow(page, 'x_date_grouping');
    const options: [number, string][] = [
      [0, 'Relative'],
      [1, 'Day'],
      [2, 'Week'],
      [3, 'Month'],
      [4, 'Year'],
    ];

    for (const [value, label] of options) {
      await expect(ChartSettingsSelectors.option(page, 'x-date-grouping', String(value))).toHaveText(label);
    }

    // Default condition is Month → it carries the check
    await expect(ChartSettingsSelectors.option(page, 'x-date-grouping', '3')).toHaveAttribute('aria-checked', 'true');
    await closeDropdown(page);
  });

  test('switching Date grouping to Week moves the check', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.DateTime);
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    // Activate the date X axis field (default name "Date")
    await chooseChartXProperty(page, 'Date');

    // Click "Week"
    await openChartPanelRow(page, 'x_date_grouping');
    await ChartSettingsSelectors.option(page, 'x-date-grouping', '2').click();
    await closeDropdown(page);

    // Re-open and verify the check moved
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.row(page, 'x_date_grouping')).toContainText('Week', { timeout: 5000 });
    await openChartPanelRow(page, 'x_date_grouping');
    await expect(ChartSettingsSelectors.option(page, 'x-date-grouping', '2')).toHaveAttribute('aria-checked', 'true');
    await expect(ChartSettingsSelectors.option(page, 'x-date-grouping', '3')).toHaveAttribute('aria-checked', 'false');
  });
});
