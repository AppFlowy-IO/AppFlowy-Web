/**
 * Chart settings — Y-axis behavior with a numeric column present.
 *
 * Verifies the desktop-parity logic in
 * `ChartLayoutSettings.tsx` → `handleAggregationSelect`:
 *
 *  - Switching from Count to a non-Count aggregation auto-picks the first
 *    Y-axis candidate (Number / Checkbox / DateTime). Mirrors desktop's
 *    `_onAggregationTypeSelected`.
 *  - The Y-axis row that gets auto-picked is rendered with the right-aligned
 *    tick.
 *  - Switching back to Count clears the y-field and hides the Y-axis section.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  openChartSettings,
  selectAggregation,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import {
  addPropertyColumn,
  signInAndCreateDatabaseView,
} from '../../support/database-ui-helpers';
import { ChartSettingsSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

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

  test('selecting Sum auto-picks the first y-axis candidate', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a Number column added → chart sees an additional
    // y-field candidate (Done Checkbox + new Number field).
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.Number);
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Default state: 2 ticks rendered in the dropdown (Count aggregation +
    // Bar chart type — chart-type now lives flat in the same submenu).
    await openChartSettings(page);
    const ticks = page.locator('[data-slot="dropdown-menu-tick"]');

    await expect(ticks).toHaveCount(2);

    // When: user picks Sum from the Aggregation list
    await selectAggregation(page, 'Sum');
    await openChartSettings(page);

    // Then: Y-Axis section is now visible
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible({ timeout: 5000 });

    // And: the dropdown now has 3 ticks (Sum + auto-picked y-field + Bar).
    // This is the only assertion that proves the auto-pick fired — without
    // it, the count would stay at 2 (Sum + Bar).
    await expect(ticks).toHaveCount(3, { timeout: 5000 });
  });

  test('switching to Count clears the auto-picked y-field', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.Number);
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Take Sum first, then switch back to Count
    await openChartSettings(page);
    await selectAggregation(page, 'Sum');
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible({ timeout: 5000 });

    await selectAggregation(page, 'Count');
    await openChartSettings(page);

    // Y-Axis section is gone again, and Count carries the tick
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Count').locator('svg')
    ).toBeVisible();
  });
});
