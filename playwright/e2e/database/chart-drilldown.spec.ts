/**
 * Chart drilldown popup.
 *
 * Verifies the hover tooltip and the `ChartRowListPopup` flow: hovering a bar
 * shows desktop's tooltip (category, value, "Click to view data"); clicking it
 * opens a dialog titled with the category label, the category as an X-Axis
 * filter chip, and the category's rows in a grid; Escape closes the dialog.
 * Like desktop's `_showRowListPopup`, a category without rows (the
 * always-present "No {field}" bucket of a fully tagged select field) opens
 * nothing. Guards `src/components/database/chart/ChartProvider.tsx`
 * (drillDownItem state) and `ChartRowListPopup.tsx` (layout / rows).
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  clickBarColumn,
  clickFirstBar,
  closeDrilldown,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  hoverBarColumn,
  setSelectOptionOnRow,
  waitForChartReady,
  waitForDrilldownOpen,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { getPrimaryFieldId, typeTextIntoCell } from '../../support/filter-test-helpers';
import { ChartDrilldownSelectors, ChartSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart drilldown', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('hovering a bar shows its tooltip and clicking it lists the rows of that category', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: two named rows in different categories
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Alpha');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Beta');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // When: hovering the first bar (Option A)
    await ChartSelectors.bars(page).first().hover();

    // Then: the tooltip names the category and invites a click
    await expect(ChartSelectors.tooltip(page)).toBeVisible();
    await expect(ChartSelectors.tooltip(page)).toContainText('Option A');
    await expect(ChartSelectors.tooltip(page)).toContainText('Click to view data');

    // When: the user clicks that bar
    await clickFirstBar(page);

    // Then: the drilldown dialog shows the category, the X-Axis field's
    // filter chip for it and the category's only row
    await waitForDrilldownOpen(page);
    await expect(ChartDrilldownSelectors.title(page)).toHaveText('Option A');
    await expect(ChartDrilldownSelectors.filterChips(page)).toHaveCount(1);
    await expect(ChartDrilldownSelectors.filterChips(page)).toContainText('Type');
    await expect(ChartDrilldownSelectors.filterChips(page)).toContainText('Option A');
    await expect(ChartDrilldownSelectors.rowTitles(page)).toHaveText(['Alpha']);
  });

  test('Escape closes the drilldown dialog', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await addChartViewTab(page);
    await waitForChartReady(page);

    await clickFirstBar(page);
    await waitForDrilldownOpen(page);

    await closeDrilldown(page);

    await expect(ChartDrilldownSelectors.dialog(page)).toHaveCount(0);
  });

  test('a category without rows opens no drilldown', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: every row has a Type, so "No Type" is an empty (zero-height) bar
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await setSelectOptionOnRow(page, 2, 'Option C');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1', '0']);

    // When: hovering the "No Type" column
    await hoverBarColumn(page, 'No Type');

    // Then: it still reacts to the pointer like any other column
    await expect(ChartSelectors.tooltip(page)).toContainText('No Type');

    // When: clicking it
    await clickBarColumn(page, 'No Type');

    // Then: nothing opens
    await page.waitForTimeout(500);
    await expect(ChartDrilldownSelectors.dialog(page)).toHaveCount(0);

    // When: clicking a column that has rows
    await clickBarColumn(page, 'Option A');

    // Then: its drilldown opens
    await waitForDrilldownOpen(page);
    await expect(ChartDrilldownSelectors.title(page)).toContainText('Option A');
  });
});
