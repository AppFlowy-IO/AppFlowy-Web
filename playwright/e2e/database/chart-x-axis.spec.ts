/**
 * Chart settings — X-Axis field selection.
 *
 * The X-Axis section of the revamped settings popover (desktop PR #1461)
 * lists the groupable fields (SingleSelect, MultiSelect, Checkbox and the
 * date types) in the view's field order, each with its field type icon and a
 * tick on the selected one. A Checkbox X-Axis buckets rows into Checked /
 * Unchecked and, unlike select fields, has no "No {field}" bucket.
 * (Date fields are covered by chart-date-axis.spec.ts.)
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
  selectXAxisField,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — X-Axis', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('lists the groupable fields and regroups the chart by the chosen one', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a chart over the default grid (Name text, Type select, Done checkbox)
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['No Type']);

    // When: opening the chart settings
    await openChartSettings(page);

    // Then: only the groupable fields are listed, in field order, and the
    // first one (Type) is the X-Axis field the chart is drawn with
    await expect(ChartSettingsSelectors.xAxisFields(page)).toHaveText(['Type', 'Done']);
    await expectOptionSelected(ChartSettingsSelectors.xAxisField(page, 'Type'));
    await expectOptionNotSelected(ChartSettingsSelectors.xAxisField(page, 'Done'));

    // When: choosing the Done checkbox
    await selectXAxisField(page, 'Done');

    // Then: the popover stays open with the tick moved to Done
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();
    await expectOptionSelected(ChartSettingsSelectors.xAxisField(page, 'Done'));
    await expectOptionNotSelected(ChartSettingsSelectors.xAxisField(page, 'Type'));

    // And: the unchecked rows form a single "Unchecked" bucket, with no
    // "No Done" bucket
    await closeChartSettings(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Unchecked']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);

    // When: reloading the page
    await page.reload();
    await waitForChartReady(page);

    // Then: the chart is still grouped by Done, which keeps the tick
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Unchecked']);
    await openChartSettings(page);
    await expectOptionSelected(ChartSettingsSelectors.xAxisField(page, 'Done'));
    await expectOptionNotSelected(ChartSettingsSelectors.xAxisField(page, 'Type'));
  });
});
