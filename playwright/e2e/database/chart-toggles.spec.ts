/**
 * Chart settings — toggle rows.
 *
 * Verifies the two boolean toggles of the chart settings panel
 * (`src/components/database/chart/settings/ChartSettingsPanel.tsx`):
 *
 *  - "Show empty values" — default ON. Toggling it off removes the
 *    auto-generated empty category ("No <field>") from the chart.
 *  - "Cumulative" — default OFF. The visible toggle state changes after
 *    clicking; numeric reverification of running totals is left out because
 *    SVG label values are brittle to scrape from the DOM.
 */
import { expect, test } from '@playwright/test';

import { chooseChartYProperty } from '../../support/chart-settings-helpers';
import {
  addChartViewTab,
  mockProSubscription,
  openChartSettings,
  selectChartType,
  toggleCumulative,
  toggleShowEmptyValues,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Toggles', () => {
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

  test('Show empty values starts ON; toggling off removes the empty category', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a default Grid (no Type values entered) → chart shows
    // "No Type" empty bucket because Show empty values is on by default.
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.chart(page)).toContainText('No Type');

    // When: toggling Show empty values off
    await openChartSettings(page);
    await toggleShowEmptyValues(page);

    // Then: the "No Type" empty category is gone from the chart's category
    // labels. We give the Yjs roundtrip + chart recompute up to 5s.
    await expect.poll(
      async () => {
        const text = await ChartSelectors.chart(page).innerText();

        return text.includes('No Type');
      },
      { timeout: 5000, intervals: [200, 500, 1000] }
    ).toBe(false);

    // And: re-opening the panel, the switch row visibly indicates OFF (the row
    // is a `role="switch"` with `aria-checked`, its Switch carries `data-state`).
    await openChartSettings(page);
    const showEmptyRow = ChartSettingsSelectors.showEmptyToggle(page);

    await expect(showEmptyRow).toHaveAttribute('aria-checked', 'false');
    await expect(showEmptyRow.locator('button[role="switch"]')).toHaveAttribute('data-state', 'unchecked');
  });

  test('Cumulative toggle flips its switch state', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Default: Cumulative is OFF.
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(ChartSettingsSelectors.cumulativeToggle(page).locator('button[role="switch"]')).toHaveAttribute(
      'data-state',
      'unchecked'
    );

    // When: toggling Cumulative on
    await toggleCumulative(page);

    // Then: re-opening shows the switch is now checked
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(ChartSettingsSelectors.cumulativeToggle(page).locator('button[role="switch"]')).toHaveAttribute(
      'data-state',
      'checked'
    );
  });

  test('Cumulative is not offered for a donut or a percent calculation', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await mockProSubscription(page);
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // A bar chart counting rows offers it.
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toBeVisible();

    // A percent calculation (the checkbox default) has no running total.
    await chooseChartYProperty(page, 'Done');
    await expect(ChartSettingsSelectors.row(page, 'y_calculate')).toContainText('Percent checked');
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toHaveCount(0);

    // Neither has a donut, whatever it calculates.
    await chooseChartYProperty(page, null);
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toBeVisible();
    await selectChartType(page, 'Donut');
    await openChartSettings(page);
    await expect(ChartSettingsSelectors.cumulativeToggle(page)).toHaveCount(0);
  });
});
