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

import { openChartPanelRow } from '../../support/chart-settings-helpers';
import {
  addChartViewTab,
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
    await mockProSubscription(page);
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

  test('the property and its calculation survive a page reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // "What to show" becomes the Done checkbox, calculated as Count values
    await openChartSettings(page);
    await selectAggregation(page, 'Count values', 'Done');

    // Reload
    await page.reload();
    await waitForChartReady(page);

    // Re-open chart settings and verify the property and Count values are still picked
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.row(page, 'y_what')).toContainText('Done', { timeout: 5000 });
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toContainText('Count values');
    await openChartPanelRow(page, 'y_calculate');
    await expect(ChartSettingsSelectors.aggItem(page, 7)).toHaveAttribute('aria-checked', 'true');
    await expect(ChartSettingsSelectors.aggItem(page, 0)).toHaveAttribute('aria-checked', 'false');
    // The chart still renders after the reload.
    await expect(ChartSelectors.chart(page)).toBeVisible();
  });
});
