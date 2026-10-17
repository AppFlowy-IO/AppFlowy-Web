/**
 * Chart settings — aggregation interactions.
 *
 * Verifies the desktop-parity behavior in
 * `src/components/database/components/settings/ChartLayoutSettings.tsx`:
 *
 *  - Count is the default aggregation; the Y-Axis section is hidden.
 *  - Aggregation labels appear in the desktop order
 *    (Count → Count values → Sum → Average → Min → Max → Median).
 *  - Selecting any non-Count aggregation keeps the popover open, reveals the
 *    Y-Axis section and auto-picks the first Y-Axis field (desktop's
 *    `_onAggregationTypeSelected`); the chart is retitled "<aggregation>(Type)".
 *  - Count values requires a Y-Axis field too (matches desktop's
 *    `_needsYAxisField`, which excludes only Count).
 *  - Switching back to Count hides the Y-Axis section again.
 *
 * The default grid's only Y-Axis candidate is the Done checkbox, unchecked on
 * every row, so the chart shows a single "No Type" bucket of three rows.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  closeChartSettings,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  expectOptionNotSelected,
  expectOptionSelected,
  openChartSettings,
  selectAggregation,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Aggregation', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('shows Count selected and hides the Y-Axis section by default', async ({ page, request }) => {
    // Given: a fresh chart view sitting on top of a grid
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');

    // When: opening the chart settings
    await openChartSettings(page);

    // Then: Count is selected (its row carries the tick) and the Y-Axis
    // section is not rendered.
    await expectOptionSelected(ChartSettingsSelectors.aggregationItem(page, 'Count'));
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
    await expect(ChartSettingsSelectors.yAxisFields(page)).toHaveCount(0);
  });

  test('lists the seven aggregations in desktop order', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    // Then: the Aggregation section lists the seven rows in desktop order,
    // with exactly one of them selected.
    await expect(ChartSettingsSelectors.aggregationItems(page)).toHaveText([
      'Count',
      'Count values',
      'Sum',
      'Average',
      'Min',
      'Max',
      'Median',
    ]);
    await expect(ChartSettingsSelectors.aggregationItems(page).and(page.locator('[data-selected="true"]'))).toHaveCount(
      1
    );
  });

  test('selecting Sum reveals the Y-Axis section and retitles the chart', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    // When: switching aggregation to Sum
    await selectAggregation(page, 'Sum');

    // Then: the popover stays open with the tick moved to Sum
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();
    await expectOptionSelected(ChartSettingsSelectors.aggregationItem(page, 'Sum'));
    await expectOptionNotSelected(ChartSettingsSelectors.aggregationItem(page, 'Count'));

    // And: the Y-Axis section lists the Done checkbox and auto-picks it
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();
    await expect(ChartSettingsSelectors.yAxisFields(page)).toHaveText(['Done']);
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));

    // And: the chart sums Done (unchecked everywhere) under the new title
    await closeChartSettings(page);
    await expect(ChartSelectors.title(page)).toHaveText('Sum(Type)');
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['0']);
  });

  test('Count values also reveals the Y-Axis section', async ({ page, request }) => {
    // Desktop's `_needsYAxisField` excludes only Count — Count values counts
    // distinct values *of* the Y-Axis field, so it requires one too.
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    await selectAggregation(page, 'Count values');

    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();
    await expectOptionSelected(ChartSettingsSelectors.aggregationItem(page, 'Count values'));
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));

    // Then: three unchecked rows hold one distinct Done value
    await closeChartSettings(page);
    await expect(ChartSelectors.title(page)).toHaveText('Count values(Type)');
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1']);
  });

  test('switching back to Count hides the Y-Axis section', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await openChartSettings(page);

    // Move to Sum first, confirm Y-Axis is visible
    await selectAggregation(page, 'Sum');
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();

    // Then switch back to Count
    await selectAggregation(page, 'Count');

    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
    await expectOptionSelected(ChartSettingsSelectors.aggregationItem(page, 'Count'));
    await expectOptionNotSelected(ChartSettingsSelectors.aggregationItem(page, 'Sum'));

    // And: the chart counts rows again
    await closeChartSettings(page);
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);
  });
});
