/**
 * Chart settings — Date X-axis bucketing.
 *
 * When the X-Axis is a date-typed field (DateTime / LastEditedTime /
 * CreatedTime) the chart-settings dropdown reveals a "Date grouping" section
 * with five options (Day / Week / Month / Year / Relative). Mirrors
 * `chart_layout_setting.dart`'s `ChartDateFieldPopoverItem` flow.
 *
 * The default Grid template doesn't ship with a Date column, so we add one
 * before testing.
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  closeDropdown,
  openChartSettings,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import {
  addPropertyColumn,
  signInAndCreateDatabaseView,
} from '../../support/database-ui-helpers';
import { FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Date X-axis', () => {
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

  test('selecting a date X-Axis field reveals the Date grouping section', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a DateTime column added. Default name comes from
    // `getFieldName(FieldType.DateTime)` → "Date".
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.DateTime);
    await addChartViewTab(page);
    await waitForChartReady(page);

    await openChartSettings(page);

    // Click the X-Axis row labelled "Date" — this closes the dropdown
    // (DropdownMenuItem closes despite preventDefault in this setup), then
    // re-open so the Date grouping section renders from persisted state.
    await page.getByRole('menuitem', { name: /^Date$/i }).click({ force: true });
    await closeDropdown(page);
    await openChartSettings(page);

    // Then: a "Date grouping" section is now visible with all five options
    await expect(page.getByText('Date grouping', { exact: true })).toBeVisible({
      timeout: 5000,
    });

    for (const label of ['Day', 'Week', 'Month', 'Year', 'Relative']) {
      await expect(
        page.getByRole('menuitem', { name: new RegExp(`^${label}$`, 'i') })
      ).toBeVisible();
    }

    // Default condition is Month → it carries the tick
    await expect(
      page
        .getByRole('menuitem', { name: /^Month$/i })
        .locator('[data-slot="dropdown-menu-tick"]')
    ).toBeVisible();

    await closeDropdown(page);
  });

  test('switching Date grouping to Week moves the tick', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.DateTime);
    await addChartViewTab(page);
    await waitForChartReady(page);

    await openChartSettings(page);

    // Activate the date X-Axis field (default name "Date")
    await page.getByRole('menuitem', { name: /^Date$/i }).click({ force: true });
    await closeDropdown(page);

    // Re-open and confirm the Date grouping section is now there
    await openChartSettings(page);
    await expect(page.getByText('Date grouping', { exact: true })).toBeVisible();

    // Click "Week"
    await page.getByRole('menuitem', { name: /^Week$/i }).click({ force: true });
    await closeDropdown(page);

    // Re-open and verify the tick moved
    await openChartSettings(page);

    await expect(
      page
        .getByRole('menuitem', { name: /^Week$/i })
        .locator('[data-slot="dropdown-menu-tick"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page
        .getByRole('menuitem', { name: /^Month$/i })
        .locator('[data-slot="dropdown-menu-tick"]')
    ).toHaveCount(0);
  });
});
