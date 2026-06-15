/**
 * Chart settings — aggregation interactions.
 *
 * Verifies the desktop-parity behavior in
 * `src/components/database/components/settings/ChartLayoutSettings.tsx`:
 *
 *  - Count is the default aggregation; the Y-Axis section is hidden.
 *  - Aggregation labels appear in the desktop order
 *    (Count → Count values → Sum → Average → Min → Max → Median).
 *  - Selecting any non-Count aggregation reveals the Y-Axis section.
 *  - Switching back to Count hides the Y-Axis section again.
 *  - Count values requires a Y-Axis field too (matches desktop's
 *    `_needsYAxisField`, which excludes only Count).
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  openChartSettings,
  selectAggregation,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

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

  test('shows Count selected and hides the Y-Axis section by default', async ({
    page,
    request,
  }) => {
    // Given: a fresh chart view sitting on top of a grid
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // Then: Count is selected (its row carries the right-aligned tick) and the
    // Y-Axis section is not rendered yet.
    const countItem = ChartSettingsSelectors.aggregationItem(page, 'Count');

    await expect(countItem).toBeVisible();
    await expect(countItem.locator('svg')).toBeVisible();
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
  });

  test('lists the seven aggregations in desktop order', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // Each label should be present in the menu.
    for (const label of ['Count', 'Count values', 'Sum', 'Average', 'Min', 'Max', 'Median']) {
      await expect(ChartSettingsSelectors.aggregationItem(page, label)).toBeVisible();
    }

    // Order: scoped to the Aggregation list region (skip the X-Axis fields).
    // We check the *relative* positions of the seven aggregation items rather
    // than the entire menuitem index, since the menu also includes X-Axis
    // field rows above the Aggregation section.
    const positions = await Promise.all(
      ['Count', 'Count values', 'Sum', 'Average', 'Min', 'Max', 'Median'].map(async (label) => {
        const box = await ChartSettingsSelectors.aggregationItem(page, label).boundingBox();

        return { label, top: box?.y ?? -1 };
      })
    );
    const tops = positions.map((p) => p.top);

    expect(tops.every((t) => t > 0)).toBe(true);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]).toBeGreaterThan(tops[i - 1]);
    }
  });

  test('selecting Sum reveals the Y-Axis section and moves the tick', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // When: switching aggregation to Sum. selectAggregation closes the menu
    // afterwards so the Yjs write can settle.
    await selectAggregation(page, 'Sum');

    // Reopen and assert state
    await openChartSettings(page);

    // Then: the Y-Axis section is now visible
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible({ timeout: 5000 });

    // And: the tick is on Sum (not Count)
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Sum').locator('svg')
    ).toBeVisible();
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Count').locator('svg')
    ).toHaveCount(0);
  });

  test('Count values also reveals the Y-Axis section', async ({ page, request }) => {
    // Desktop's `_needsYAxisField` excludes only Count — Count values counts
    // distinct values *of* the Y-Axis field, so it requires one too.
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    await selectAggregation(page, 'Count values');
    await openChartSettings(page);

    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible({ timeout: 5000 });
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Count values').locator('svg')
    ).toBeVisible();
  });

  test('switching back to Count hides the Y-Axis section', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await openChartSettings(page);

    // Move to Sum first, confirm Y-Axis is visible
    await selectAggregation(page, 'Sum');
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible({ timeout: 5000 });

    // Then switch back to Count
    await selectAggregation(page, 'Count');
    await openChartSettings(page);

    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
    await expect(
      ChartSettingsSelectors.aggregationItem(page, 'Count').locator('svg')
    ).toBeVisible();
  });
});
