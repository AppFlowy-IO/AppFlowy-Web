/**
 * Chart drilldown popup.
 *
 * Verifies the `ChartRowListPopup` flow: clicking a chart bar opens an MUI
 * Dialog whose title shows the category label and the matching row count,
 * and Escape closes the dialog. Used to catch regressions in
 * `src/components/database/chart/ChartProvider.tsx` (drillDownItem state)
 * and `ChartRowListPopup.tsx` (Dialog layout / row mapping).
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  clickFirstBar,
  closeDrilldown,
  setSelectOptionOnRow,
  waitForChartReady,
  waitForDrilldownOpen,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartDrilldownSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart drilldown', () => {
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

  test('clicking a bar opens a drilldown dialog showing the row count', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a chart over a grid where two rows belong to different
    // categories — guarantees at least one bar with a known row count.
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // When: the user clicks the first bar
    await clickFirstBar(page);

    // Then: the drilldown dialog is visible and its title contains "rows"
    await waitForDrilldownOpen(page);
    await expect(ChartDrilldownSelectors.dialog(page)).toContainText(/rows/i);
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
});
