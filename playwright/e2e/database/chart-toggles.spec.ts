/**
 * Chart settings — toggle rows.
 *
 * Verifies the two boolean toggles in
 * `src/components/database/components/settings/ChartLayoutSettings.tsx`:
 *
 *  - "Show empty values" — default ON. Toggling it off removes the
 *    auto-generated empty category ("No <field>") from the chart.
 *  - "Cumulative" — default OFF. The visible toggle state changes after
 *    clicking; numeric reverification of running totals is left out because
 *    SVG label values are brittle to scrape from the DOM.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  openChartSettings,
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

    // And: re-opening the menu, the toggle visibly indicates OFF (the inner
    // switch input is no longer "checked"). The Switch primitive carries
    // `data-state="checked" | "unchecked"`.
    await openChartSettings(page);
    const showEmptySwitch = ChartSettingsSelectors.showEmptyValuesItem(page).locator('button[role="switch"]');

    await expect(showEmptySwitch).toHaveAttribute('data-state', 'unchecked');
  });

  test('Cumulative toggle flips its switch state', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Default: Cumulative is OFF.
    await openChartSettings(page);
    let cumulativeSwitch = ChartSettingsSelectors.cumulativeItem(page).locator('button[role="switch"]');

    await expect(cumulativeSwitch).toHaveAttribute('data-state', 'unchecked');

    // When: toggling Cumulative on
    await toggleCumulative(page);

    // Then: re-opening shows the switch is now checked
    await openChartSettings(page);
    cumulativeSwitch = ChartSettingsSelectors.cumulativeItem(page).locator('button[role="switch"]');
    await expect(cumulativeSwitch).toHaveAttribute('data-state', 'checked');
  });
});
