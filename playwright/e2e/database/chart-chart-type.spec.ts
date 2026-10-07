/**
 * Chart settings — chart type switching.
 *
 * Verifies the chart type icon row of the settings panel
 * (`src/components/database/chart/settings/ChartTypeRow.tsx`) actually swaps
 * the rendered Recharts widget when each chart type is selected.
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
  mockProSubscription,
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
    await mockProSubscription(page);
  });

  test('defaults to Vertical bar, the selected icon button', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);

    // The five icon buttons, Vertical bar selected (pressed) by default.
    const buttons = page.getByTestId('chart-type-row').locator('button');

    await expect(buttons).toHaveCount(5);
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-pressed', 'true');
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-label', 'Vertical bar');
    for (const label of ['Horizontal Bar', 'Line', 'Donut', 'Number']) {
      await expect(ChartSettingsSelectors.chartTypeButton(page, label)).toHaveAttribute('aria-pressed', 'false');
    }
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
