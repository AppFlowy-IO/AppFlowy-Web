/**
 * Chart settings — persistence on page reload.
 *
 * The chart settings flow writes to Yjs via `useUpdateChartSetting` (with
 * desktop's storage keys) and reads back via `useChartLayoutSetting`. On
 * reload the settings should round-trip from the cloud, restoring the same
 * chart type / aggregation / Y-Axis field. These tests guard against
 * regressions in the Yjs schema or the layout-settings persistence path.
 * (The X-Axis field, the date grouping and Omit zero values are covered by
 * reload steps in their own specs.)
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  closeChartSettings,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  expectOptionNotSelected,
  expectOptionSelected,
  mockProSubscription,
  openChartSettings,
  selectAggregation,
  selectChartType,
  setSelectOptionOnRow,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Persistence', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockProSubscription(page);
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('chart type survives a page reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Seed two select options so every chart type has rendered data after
    // reload.
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Switch to Line chart
    await openChartSettings(page);
    await selectChartType(page, 'Line');
    await closeChartSettings(page);

    // Confirm pre-reload state: line series is rendered
    await expect(ChartSelectors.lineChart(page)).toBeVisible({ timeout: 10000 });

    // When: page is reloaded
    await page.reload();
    await waitForChartReady(page);

    // Then: line series is still rendered (chart type persisted)
    await expect(ChartSelectors.lineWidget(page)).toBeVisible({ timeout: 15000 });
    await expect(ChartSelectors.lineChart(page)).toBeVisible();
    await expect(ChartSelectors.barWidget(page)).toHaveCount(0);

    // And: the chart type grid presses Line
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Line')).toHaveAttribute('aria-pressed', 'true');
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-pressed', 'false');
  });

  test('aggregation and Y-Axis field survive a page reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Switch aggregation to Sum, which auto-picks the Done checkbox as Y-Axis
    await openChartSettings(page);
    await selectAggregation(page, 'Sum');
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));
    await closeChartSettings(page);
    await expect(ChartSelectors.title(page)).toHaveText('Sum(Type)');

    // Reload
    await page.reload();
    await waitForChartReady(page);

    // Then: the chart is still titled by Sum
    await expect(ChartSelectors.title(page)).toHaveText('Sum(Type)');

    // And: re-opening the settings shows Sum and the Done Y-Axis field
    await openChartSettings(page);
    await expectOptionSelected(ChartSettingsSelectors.aggregationItem(page, 'Sum'));
    await expectOptionNotSelected(ChartSettingsSelectors.aggregationItem(page, 'Count'));
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));
  });
});
