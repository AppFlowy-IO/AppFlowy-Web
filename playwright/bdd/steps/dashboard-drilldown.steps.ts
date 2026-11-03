/**
 * Steps of `dashboard-drilldown.feature` (WP13 §8): the chart drill-down as a
 * live table (title, count, columns, chips, search, drill-local filters, the
 * `···` menu with Save as view and Open database) and records opened in a
 * side peek ("Open pages in"). The desktop feature
 * `usecases/drilldown.feature` has the same words. The Background, opening
 * the dashboard, chart clicks, "the drill-down lists", the row page, Escape,
 * Edit mode and saved-filter steps are the shared use-case and dashboard steps.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { clickSegment } from '../../support/chart-series-helpers';
import { DashboardSelectors, splitList, widgetLocator } from '../../support/dashboard-test-helpers';
import { closeSidePeek, drillDown, sidePeek } from '../../support/dashboard-usecase-helpers';
import {
  addDrillSelectFilter,
  chooseDrillMenuItem,
  clearDrillSearch,
  clickSidePeekButton,
  closeDrillDown,
  DRILL_TIMEOUT,
  drillChipTexts,
  drillColumnNames,
  drillGlobalChip,
  expectCenterPeekFor,
  expectDatabasePageOpen,
  expectDrillCount,
  expectDrillTitle,
  expectFullRowPage,
  expectOpenTableTitles,
  expectSavedViewOpen,
  expectSidePeekDefaultWidth,
  expectSidePeekFor,
  expectViewIsTab,
  groupUseCaseChartBy,
  saveDrillViewAs,
  saveViewNameField,
  searchDrill,
  setWidgetOpenPagesIn,
  viewOpenPagesIn,
} from '../../support/drilldown-helpers';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Setup (WP12)
// ---------------------------------------------------------------------------

Given('the {string} chart is grouped by {string}', async ({ page, request }, view: string, property: string) => {
  await groupUseCaseChartBy(page, request, view, property);
});

// ---------------------------------------------------------------------------
// Opening a drill-down
// ---------------------------------------------------------------------------

When('I click the number of the {string} widget', async ({ page }, view: string) => {
  const value = widgetLocator(page, view).getByTestId('number-chart-value');

  await expect(value).toBeVisible(DRILL_TIMEOUT);
  await value.click();
  await expect(drillDown(page)).toBeVisible(DRILL_TIMEOUT);
});

When(
  'I click the {string} part of the {string} bar in the {string} chart',
  async ({ page }, series: string, category: string, view: string) => {
    await clickSegment(page, view, category, series);
  }
);

// ---------------------------------------------------------------------------
// What the drill-down shows
// ---------------------------------------------------------------------------

Then('the drill-down is titled {string}', async ({ page }, title: string) => {
  await expectDrillTitle(page, title);
});

Then('the drill-down shows the row count {string}', async ({ page }, text: string) => {
  await expectDrillCount(page, text);
});

Then('the drill-down shows the columns {string}', async ({ page }, columns: string) => {
  await expect.poll(() => drillColumnNames(page), DRILL_TIMEOUT).toEqual(splitList(columns));
});

Then('the drill-down shows the category chip {string}', async ({ page }, text: string) => {
  await expect.poll(() => drillChipTexts(page, 'category'), DRILL_TIMEOUT).toEqual([text]);
});

Then('the drill-down shows the category chips {string}', async ({ page }, texts: string) => {
  await expect
    .poll(
      async () => [...(await drillChipTexts(page, 'category')), ...(await drillChipTexts(page, 'subgroup'))],
      DRILL_TIMEOUT
    )
    .toEqual(splitList(texts));
});

Then('the drill-down shows no category chip', async ({ page }) => {
  await expect(drillDown(page)).toBeVisible(DRILL_TIMEOUT);
  for (const kind of ['category', 'subgroup', 'rows'] as const) {
    await expect.poll(() => drillChipTexts(page, kind)).toEqual([]);
  }
});

Then('the drill-down shows an editable filter chip for {string}', async ({ page }, property: string) => {
  const chip = drillDown(page)
    .locator('[data-testid="drill-chip"][data-chip-kind="filter"]')
    .filter({ hasText: property });

  await expect(chip.first()).toBeVisible(DRILL_TIMEOUT);
  // The pill chip opens the filter editor: a button with a chevron.
  const button = chip.first().getByTestId('database-filter-condition');

  await expect(button).toHaveAttribute('data-variant', 'pill');
  await expect(button).toHaveAttribute('aria-readonly', 'false');
  await expect(button.getByTestId('filter-chip-chevron')).toBeVisible();
});

Then('the drill-down shows the dashboard filter chip {string}', async ({ page }, text: string) => {
  await expect(drillGlobalChip(page, text)).toHaveCount(1, DRILL_TIMEOUT);
});

Then('the dashboard filter chip {string} in the drill-down cannot be edited', async ({ page }, text: string) => {
  const chip = drillGlobalChip(page, text);

  await expect(chip).toHaveCount(1, DRILL_TIMEOUT);
  await expect(chip).toHaveAttribute('aria-readonly', 'true');
  // Not a control: no button, no chevron, and a press opens nothing.
  await expect(chip.locator('button, [data-testid="filter-chip-chevron"]')).toHaveCount(0);
  expect(await chip.evaluate((element) => element.tagName)).not.toBe('BUTTON');
  await chip.hover();
  await expect(page.getByText('From dashboard filter').first()).toBeVisible(DRILL_TIMEOUT);
  await chip.click();
  await expect(page.locator('[data-radix-popper-content-wrapper] [data-testid="filter-condition-trigger"]')).toHaveCount(
    0
  );
  await expect(drillDown(page)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Search and drill-local filters
// ---------------------------------------------------------------------------

When('I search the drill-down for {string}', async ({ page }, query: string) => {
  await searchDrill(page, query);
});

When('I clear the drill-down search', async ({ page }) => {
  await clearDrillSearch(page);
});

When('I add a {string} is {string} filter in the drill-down', async ({ page }, property: string, option: string) => {
  await addDrillSelectFilter(page, property, option);
});

When('I close the drill-down', async ({ page }) => {
  await closeDrillDown(page);
});

// ---------------------------------------------------------------------------
// The ··· menu: Save as view, Open database
// ---------------------------------------------------------------------------

When('I choose {string} in the drill-down menu', async ({ page }, label: string) => {
  await chooseDrillMenuItem(page, label);
});

Then('the view name field shows {string}', async ({ page }, name: string) => {
  await expect(saveViewNameField(page)).toHaveValue(name, DRILL_TIMEOUT);
});

When('I save the view as {string}', async ({ page }, name: string) => {
  await saveDrillViewAs(page, name);
});

Then('the {string} view of {string} is open', async ({ page }, name: string, database: string) => {
  await expectSavedViewOpen(page, name, database);
});

Then('the {string} view is a table listing {string}', async ({ page }, name: string, titles: string) => {
  await expectOpenTableTitles(page, name, splitList(titles));
});

Then('the {string} view is shown as a tab of {string}', async ({ page }, name: string, database: string) => {
  await expectViewIsTab(page, name, database);
});

Then('the {string} database page is open', async ({ page }, database: string) => {
  await expectDatabasePageOpen(page, database);
});

// ---------------------------------------------------------------------------
// The side peek and "Open pages in"
// ---------------------------------------------------------------------------

Then('{string} opens in a side peek', async ({ page }, title: string) => {
  await expectSidePeekFor(page, title);
});

Then('{string} opens in a center peek', async ({ page }, title: string) => {
  await expectCenterPeekFor(page, title);
});

When('I close the side peek', async ({ page }) => {
  await closeSidePeek(page);
});

Then('the side peek has its default width', async ({ page }) => {
  await expectSidePeekDefaultWidth(page);
});

Then('no side peek is open', async ({ page }) => {
  await expect(sidePeek(page)).toHaveCount(0, DRILL_TIMEOUT);
});

Then('the dashboard is still open', async ({ page }) => {
  await expect(DashboardSelectors.view(page)).toBeVisible(DRILL_TIMEOUT);
});

When('I click {string} in the side peek', async ({ page }, label: string) => {
  await clickSidePeekButton(page, label);
});

Then('the row page for {string} is open as a full page', async ({ page }, title: string) => {
  await expectFullRowPage(page, title);
});

When(
  'I set {string} to {string} for the {string} widget',
  async ({ page }, setting: string, value: string, view: string) => {
    if (setting !== 'Open pages in') throw new Error(`Unknown widget setting "${setting}"`);
    await setWidgetOpenPagesIn(page, view, value);
  }
);

Then('the {string} view opens pages in {string}', async ({ page }, view: string, value: string) => {
  await expect.poll(() => viewOpenPagesIn(page, view), DRILL_TIMEOUT).toBe(value);
});
