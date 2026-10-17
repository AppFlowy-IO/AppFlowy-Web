/**
 * Chart settings — Y-axis behavior with a numeric column present.
 *
 * Verifies the desktop-parity logic in
 * `ChartLayoutSettings.tsx` → `handleAggregationSelect`:
 *
 *  - The Y-Axis section lists the Number / Checkbox / DateTime fields in the
 *    view's field order.
 *  - Switching from Count to a non-Count aggregation auto-picks the first
 *    Y-axis candidate. Mirrors desktop's `_onAggregationTypeSelected`.
 *  - Switching back to Count clears the Y-Axis field, so the next non-Count
 *    aggregation auto-picks the first candidate again.
 *
 * And the aggregated values the chart draws, with the data of desktop's
 * `database_chart_y_axis_test.dart` (Type A/B/A, Amount 100/200/150).
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
  selectYAxisField,
  setSelectOptionOnRow,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { addPropertyColumn, signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { addFieldWithType } from '../../support/field-type-helpers';
import { typeTextIntoCell } from '../../support/filter-test-helpers';
import { ChartAggregationName, ChartSelectors, ChartSettingsSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Y-axis with numeric field', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('Sum auto-picks the first Y-Axis field and Count clears the choice', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a Number column ("Numbers") after the Done checkbox
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.Number);
    await addChartViewTab(page);
    await waitForChartReady(page);

    // When: picking Sum from the Aggregation list
    await openChartSettings(page);
    await selectAggregation(page, 'Sum');

    // Then: both Y-Axis candidates are listed in field order, and the first
    // one (Done) was auto-picked
    await expect(ChartSettingsSelectors.yAxisFields(page)).toHaveText(['Done', 'Numbers']);
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));
    await expectOptionNotSelected(ChartSettingsSelectors.yAxisField(page, 'Numbers'));

    // When: choosing Numbers instead
    await selectYAxisField(page, 'Numbers');

    // Then: the tick moves to Numbers
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Numbers'));
    await expectOptionNotSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));

    // When: switching to Count, then back to Sum
    await selectAggregation(page, 'Count');
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);
    await selectAggregation(page, 'Sum');

    // Then: Count cleared the Y-Axis field, so Sum auto-picks Done again
    await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Done'));
    await expectOptionNotSelected(ChartSettingsSelectors.yAxisField(page, 'Numbers'));
  });

  test('the chart aggregates the chosen Y-Axis field per category', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: Type A / B / A with Numbers 100 / 200 / 150
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    const numbersFieldId = await addFieldWithType(page, FieldType.Number);

    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await setSelectOptionOnRow(page, 2, 'Option A');
    await typeTextIntoCell(page, numbersFieldId, 0, '100');
    await typeTextIntoCell(page, numbersFieldId, 1, '200');
    await typeTextIntoCell(page, numbersFieldId, 2, '150');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Then: Count charts the rows per category; "No Type" stays as an empty
    // bucket of the select field
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['2', '1', '0']);

    // When: summing Numbers
    await openChartSettings(page);
    await selectAggregation(page, 'Sum');
    await selectYAxisField(page, 'Numbers');
    await closeChartSettings(page);

    // Then: A = 100 + 150, B = 200
    await expect(ChartSelectors.title(page)).toHaveText('Sum(Type)');
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['250', '200', '0']);

    // And: the other aggregations keep the Numbers field
    const expectations: Array<[ChartAggregationName, string[]]> = [
      ['Average', ['125', '200', '0']],
      ['Min', ['100', '200', '0']],
      ['Max', ['150', '200', '0']],
    ];

    for (const [aggregation, values] of expectations) {
      await openChartSettings(page);
      await selectAggregation(page, aggregation);
      await expectOptionSelected(ChartSettingsSelectors.yAxisField(page, 'Numbers'));
      await closeChartSettings(page);

      await expect(ChartSelectors.title(page)).toHaveText(`${aggregation}(Type)`);
      await expect(ChartSelectors.valueLabels(page)).toHaveText(values);
    }

    // When: going back to Count
    await openChartSettings(page);
    await selectAggregation(page, 'Count');
    await closeChartSettings(page);

    // Then: the row counts are back
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['2', '1', '0']);
  });
});
