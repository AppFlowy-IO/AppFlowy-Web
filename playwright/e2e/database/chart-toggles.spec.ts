/**
 * Chart settings — the "Omit zero values" toggle.
 *
 * The revamped panel (desktop PR #1461) dropped the web-only "Show empty
 * values" and "Cumulative" toggles. Its only toggle is desktop mobile's
 * "Omit zero values", placed after the X-Axis fields and bound to
 * `omitEmptyValues`: OFF by default; ON drops the "No {field}" bucket.
 *
 * Select fields always get that bucket while the toggle is off, even when no
 * row falls into it (desktop's `ChartBloc`), so a fully tagged grid still
 * shows an empty "No Type" bar until zero values are omitted.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  closeChartSettings,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  openChartSettings,
  setSelectOptionOnRow,
  toggleOmitZeroValues,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Omit zero values', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('starts off; turning it on hides the "No Type" bucket and survives a reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: one tagged row; the other two rows have no Type
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '2']);

    // Then: the toggle starts off
    await openChartSettings(page);
    const toggle = ChartSettingsSelectors.omitZeroValues(page);

    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(ChartSettingsSelectors.omitZeroValuesSwitch(page)).toHaveAttribute('data-state', 'unchecked');

    // When: turning it on (the popover stays open)
    await toggleOmitZeroValues(page);
    await expect(ChartSettingsSelectors.omitZeroValuesSwitch(page)).toHaveAttribute('data-state', 'checked');
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();

    // Then: the "No Type" bucket is gone from the chart
    await closeChartSettings(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1']);

    // When: reloading the page
    await page.reload();
    await waitForChartReady(page);

    // Then: the setting persisted
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A']);
    await openChartSettings(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // When: turning it off again
    await toggleOmitZeroValues(page);
    await closeChartSettings(page);

    // Then: the "No Type" bucket is back
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'No Type']);
  });

  test('a fully tagged select field keeps an empty "No Type" bucket until zero values are omitted', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: every row has a Type
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await setSelectOptionOnRow(page, 2, 'Option C');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Then: "No Type" is still charted, with a zero value
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'Option C', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1', '0']);

    // When: omitting zero values
    await openChartSettings(page);
    await toggleOmitZeroValues(page);
    await closeChartSettings(page);

    // Then: only the options with rows remain
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'Option C']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1']);
  });
});
