import { expect, test } from '@playwright/test';

import { openChartPanelRow } from '../../support/chart-settings-helpers';
import { addChartViewTab, closeDropdown, openChartSettings, waitForChartReady } from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test('changing the X-axis to a checkbox persists across reloads', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid');
  await addChartViewTab(page);
  await waitForChartReady(page);
  await expect(ChartSelectors.dataTable(page).locator('th')).toHaveText(['No Type']);

  await openChartSettings(page);
  await openChartPanelRow(page, 'x_what');
  await expect(ChartSettingsSelectors.fieldItemByName(page, 'Type')).toHaveAttribute('aria-checked', 'true');
  await expect(ChartSettingsSelectors.fieldItemByName(page, 'Done')).toHaveAttribute('aria-checked', 'false');
  await ChartSettingsSelectors.fieldItemByName(page, 'Done').click();
  await closeDropdown(page);
  await expect(ChartSelectors.dataTable(page).locator('th')).toHaveText(['Unchecked']);
  await expect(ChartSelectors.dataTable(page).locator('tr')).toHaveAttribute('data-value', '3');

  await page.reload();
  await waitForChartReady(page);
  await expect(ChartSelectors.dataTable(page).locator('th')).toHaveText(['Unchecked']);
  await openChartSettings(page);
  await openChartPanelRow(page, 'x_what');
  await expect(ChartSettingsSelectors.fieldItemByName(page, 'Done')).toHaveAttribute('aria-checked', 'true');
});
