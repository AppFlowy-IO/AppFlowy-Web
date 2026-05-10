/**
 * Chart settings — chart type switching.
 *
 * Verifies the "Chart type" sub-submenu in
 * `src/components/database/components/settings/ChartLayoutSettings.tsx`
 * actually swaps the rendered Recharts widget when each of the four chart
 * types is selected.
 *
 * Recharts class hooks used:
 *  - Bar              → `.recharts-bar-rectangle`
 *  - Horizontal Bar   → `.recharts-bar-rectangle` (oriented sideways) +
 *                       a layout="vertical" CartesianGrid
 *  - Line             → `.recharts-line`
 *  - Donut            → `.recharts-pie-sector`
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import {
  addChartViewTab,
  openChartSettings,
  selectChartType,
  setSelectOptionOnRow,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

async function setupChartWithData(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await signInAndCreateDatabaseView(page, request, email, 'Grid');
  // Two distinct categories so every chart type has something to draw.
  await setSelectOptionOnRow(page, 0, 'Option A');
  await setSelectOptionOnRow(page, 1, 'Option B');
  await addChartViewTab(page);
  await waitForChartReady(page);
}

test.describe('Chart settings — Chart type', () => {
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

  test('defaults to Bar with the tick on Bar', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);

    // Scroll the chart-type items into view (they're at the bottom of the
    // scrollable chart settings dropdown).
    const barItem = ChartSettingsSelectors.chartTypeItem(page, 'Bar');

    await barItem.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);

    // Bar carries the right-aligned tick by default
    await expect(barItem.locator('svg').last()).toBeVisible();
  });

  test('switching to Line renders a Recharts line series', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Line');

    // The line chart container exists, and `.recharts-line` is present.
    await expect(ChartSelectors.chart(page)).toBeVisible();
    await expect(page.locator('.recharts-line')).toBeVisible({ timeout: 10000 });
  });

  test('switching to Donut renders pie sectors', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Donut');

    await expect(ChartSelectors.chart(page)).toBeVisible();
    await expect(ChartSelectors.slices(page).first()).toBeVisible({ timeout: 10000 });
  });

  test('switching to Horizontal Bar still draws bar rectangles', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Horizontal Bar');

    await expect(ChartSelectors.chart(page)).toBeVisible();
    await expect(ChartSelectors.bars(page).first()).toBeVisible({ timeout: 10000 });
  });
});
