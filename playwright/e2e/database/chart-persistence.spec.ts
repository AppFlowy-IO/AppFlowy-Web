/**
 * Chart settings — persistence on page reload.
 *
 * The chart settings flow writes to Yjs via `useUpdateChartSetting` and reads
 * back via `useChartLayoutSetting` (both observe deeply on the database view).
 * On reload the settings should round-trip from the cloud, restoring the same
 * chart type / aggregation. These tests guard against regressions in the
 * Yjs schema or the layout-settings persistence path.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
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

    // Confirm pre-reload state: line series is rendered
    await expect(page.locator('.recharts-line')).toBeVisible({ timeout: 10000 });

    // When: page is reloaded
    await page.reload();
    await waitForChartReady(page);

    // Then: line series is still rendered (chart type persisted)
    await expect(page.locator('.recharts-line')).toBeVisible({ timeout: 15000 });
  });

  test('aggregation type survives a page reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Switch aggregation to Sum
    await openChartSettings(page);
    await selectAggregation(page, 'Sum');

    // Reload
    await page.reload();
    await waitForChartReady(page);

    // Re-open chart settings and verify Sum still has the tick
    await openChartSettings(page);
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Sum').locator('svg')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Count').locator('svg')
    ).toHaveCount(0);
    // Y-Axis section also re-renders (matches `aggregationNeedsY` rule)
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();

    // Suppress unused-variable warning for ChartSelectors import not yet used
    void ChartSelectors;
  });
});
