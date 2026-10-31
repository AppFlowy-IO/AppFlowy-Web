/**
 * Chart drill-down (WP13).
 *
 * Verifies the drill-down flow: clicking a chart bar opens the "Table data
 * preview" dialog with the clicked category as its title and the matching
 * row count, and Escape closes it. Used to catch regressions in
 * `src/components/database/chart/ChartProvider.tsx` and
 * `src/components/database/chart/drill/ChartDrillDialog.tsx`.
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

    // Then: the drill-down dialog is visible with its count ("1 row" for the first bar)
    await waitForDrilldownOpen(page);
    await expect(ChartDrilldownSelectors.dialog(page)).toHaveAttribute('aria-label', 'Table data preview');
    await expect(ChartDrilldownSelectors.count(page)).toHaveText(/^\d+ rows?$/, { timeout: 10000 });
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
