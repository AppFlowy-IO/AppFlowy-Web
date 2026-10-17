/**
 * Chart settings — Date X-axis bucketing.
 *
 * Date-typed X-Axis rows (DateTime / LastEditedTime / CreatedTime) carry a
 * chevron instead of a tick and open a grouping submenu (Relative / Day /
 * Week / Month / Year) on hover or click, like desktop's
 * `ChartDateFieldPopoverItem`. Clicking the row selects the field; picking a
 * grouping selects the field too and closes only the submenu.
 *
 * The default Grid template doesn't ship with a date column, so we add one
 * before testing: a DateTime column ("Date", empty on every row) or a
 * CreatedTime column ("Created at", set on every row).
 */
import { expect, test } from '@playwright/test';

import {
  addChartViewTab,
  closeChartSettings,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  expectOptionNotSelected,
  expectOptionSelected,
  openChartSettings,
  openDateGroupingMenu,
  selectDateGrouping,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { addPropertyColumn, signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartSelectors, ChartSettingsSelectors, FieldType } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Chart settings — Date X-axis', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('a date field row opens the grouping submenu on hover and is selected by a click', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a DateTime column added. Default name comes from
    // `getFieldName(FieldType.DateTime)` → "Date".
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.DateTime);
    await addChartViewTab(page);
    await waitForChartReady(page);

    await openChartSettings(page);
    const dateRow = ChartSettingsSelectors.xAxisField(page, 'Date');
    const typeRow = ChartSettingsSelectors.xAxisField(page, 'Type');

    // Then: the Date row is a submenu trigger without a tick; Type is selected
    await expect(dateRow).toHaveAttribute('aria-haspopup', 'menu');
    await expect(ChartSettingsSelectors.selectedTick(dateRow)).toHaveCount(0);
    await expectOptionSelected(typeRow);

    // When: hovering the Date row
    await openDateGroupingMenu(page, 'Date');

    // Then: the five groupings are listed in desktop order with Month ticked
    await expect(ChartSettingsSelectors.dateGroupingItems(page)).toHaveText([
      'Relative',
      'Day',
      'Week',
      'Month',
      'Year',
    ]);
    await expectOptionSelected(ChartSettingsSelectors.dateGroupingItem(page, 'Month'));

    // And: it opens on the left, like desktop's `leftWithTopAligned` popover:
    // the rows end 176px from the viewport edge here, less than the 172px
    // submenu plus its 8px gap (headless Chromium reserves no scrollbar space)
    await expect(ChartSettingsSelectors.dateGroupingMenu(page)).toHaveAttribute('data-side', 'left');

    // And: hovering alone does not change the X-Axis field
    await expect(dateRow).not.toHaveAttribute('data-selected', 'true');
    await expectOptionSelected(typeRow);

    // When: hovering a plain row
    await typeRow.hover();

    // Then: the submenu closes while the popover stays open
    await expect(ChartSettingsSelectors.dateGroupingMenu(page)).toBeHidden();
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();

    // When: clicking the Date row itself
    await dateRow.click();

    // Then: Date becomes the X-Axis field (no tick, like desktop) and the
    // submenu opens again
    await expect(dateRow).toHaveAttribute('data-selected', 'true');
    await expect(ChartSettingsSelectors.selectedTick(dateRow)).toHaveCount(0);
    await expectOptionNotSelected(typeRow);
    await expect(ChartSettingsSelectors.dateGroupingMenu(page)).toBeVisible();

    // And: with no dates entered, every row lands in the "No Date" bucket
    await closeChartSettings(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['No Date']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);
  });

  test('picking a grouping selects the date field, regroups the chart and survives a reload', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a CreatedTime column ("Created at"): every row was
    // created moments ago, so every row has a date
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addPropertyColumn(page, FieldType.CreatedTime);
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['No Type']);

    // When: picking Relative from the Created at row's submenu
    await openChartSettings(page);
    await selectDateGrouping(page, 'Created at', 'Relative');

    // Then: only the submenu closed, and Created at is now the X-Axis field
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();
    await expect(ChartSettingsSelectors.xAxisField(page, 'Created at')).toHaveAttribute('data-selected', 'true');
    await expectOptionNotSelected(ChartSettingsSelectors.xAxisField(page, 'Type'));

    // And: all three rows fall into "Today"; no row lacks a date, so there is
    // no "No Created at" bucket
    await closeChartSettings(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Today']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);

    // When: reloading the page
    await page.reload();
    await waitForChartReady(page);

    // Then: the chart is still grouped by relative date
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Today']);

    // And: the submenu still ticks Relative
    await openChartSettings(page);
    await openDateGroupingMenu(page, 'Created at');
    await expectOptionSelected(ChartSettingsSelectors.dateGroupingItem(page, 'Relative'));
    await expectOptionNotSelected(ChartSettingsSelectors.dateGroupingItem(page, 'Month'));

    // When: switching to Year
    await selectDateGrouping(page, 'Created at', 'Year');
    await closeChartSettings(page);

    // Then: the rows are bucketed by the current year
    await expect(ChartSelectors.categoryLabels(page)).toHaveText([String(new Date().getFullYear())]);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);
  });
});
