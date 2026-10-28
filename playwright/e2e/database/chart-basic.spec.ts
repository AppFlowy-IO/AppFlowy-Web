/**
 * Chart database view — basic tests.
 *
 * Migrated from: cypress/e2e/database/chart-basic.cy.ts (chart_view branch)
 *
 * Covers: create chart from sidebar, create chart view from grid, render with
 * data (desktop's label order and its always-present "No {field}" bucket for
 * select fields), the empty-category fallback, view-tab switching, and the
 * layout of the revamped settings popover (desktop PR #1461).
 */
import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  addChartViewTab,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  openChartSettings,
  selectAggregation,
  setSelectOptionOnRow,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { getActiveRowIds } from '../../support/gallery-test-helpers';
import { setSelectCellDirect } from '../../support/side-peek-helpers';
import {
  AddPageSelectors,
  ChartSelectors,
  ChartSettingsSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { expectViewCreationAvailable } from '../../support/view-creation-availability';

test.describe('Database Chart View Basic', () => {
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectUnexpectedPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.afterEach(() => {
    expectNoUnexpectedPageErrors(pageErrors);
  });

  test('should create a chart database from the sidebar', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // When: clicking "+" then "Chart" in the sidebar
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await expectViewCreationAvailable(AddPageSelectors.addChartButton(page));
    await AddPageSelectors.addChartButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Then: a Bar chart is rendered with desktop's aggregation title, which
    // always reads "<aggregation>(Type)" whatever the X-Axis field is called
    await waitForChartReady(page);
    await expect(ChartSelectors.barWidget(page)).toBeVisible();
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
  });

  test('should create a chart view from an existing grid database', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');

    // When: adding a Chart view tab
    await addChartViewTab(page);

    // Then: the Chart view is rendered as a bar chart
    await expect(ChartSelectors.chart(page)).toBeVisible({ timeout: 15000 });
    await expect(ChartSelectors.barWidget(page)).toBeVisible({ timeout: 15000 });
  });

  test('should display chart with data when rows have select option values', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with two rows tagged with different SingleSelect options
    // (the third row keeps an empty Type)
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');

    // When: opening a Chart view on top of that grid
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Then: one bar per category, labels sorted with the empty bucket last,
    // each counting one row
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1']);
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
  });

  test('should show empty category when rows have no select option value', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with no values entered into the Type field
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');

    // When: switching to Chart view
    await addChartViewTab(page);

    // Then: the chart has a single "No Type" bar holding all three rows
    await waitForChartReady(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['3']);
  });

  test('should switch between Grid and Chart views', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with a Chart view tab
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await expect(ChartSelectors.chart(page)).toBeVisible({ timeout: 15000 });

    // When: clicking back on the first (Grid) tab
    const tabs = DatabaseViewSelectors.viewTab(page);

    await tabs.first().click({ force: true });
    await page.waitForTimeout(1000);

    // Then: the grid is the active view
    await expect(tabs.first()).toHaveAttribute('data-state', 'active');
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();

    // When: clicking the second (Chart) tab again
    await tabs.nth(1).click({ force: true });
    await page.waitForTimeout(1000);

    // Then: the chart is active again
    await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active');
    await expect(ChartSelectors.chart(page)).toBeVisible();
  });

  test('should open one settings popover with every chart section inline', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a chart view over the default grid (Name, Type, Done), in a
    // viewport tall enough for desktop's 550px cap, not the room under the
    // gear button, to bound the popover
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // When: opening the settings (gear) popover
    await openChartSettings(page);
    const panel = ChartSettingsSelectors.panel(page);

    // Then: there is no "Chart settings" submenu any more
    await expect(panel.getByRole('menuitem', { name: /chart settings/i })).toHaveCount(0);

    // And: the popover follows desktop's order: Properties and Layout, a
    // divider, then the chart type grid, the X-Axis fields (groupable fields
    // only, so not Name) with the Omit zero values toggle, and the seven
    // aggregations. Count needs no Y-Axis, so that section is absent.
    const outline = await panel
      .locator(
        [
          '[data-testid="database-properties-settings-trigger"]',
          '[data-testid="database-layout-settings-trigger"]',
          '[role="separator"]',
          '[data-chart-settings-section-header]',
          '[data-testid^="chart-type-button-"]',
          '[data-testid^="chart-x-axis-field-"]',
          '[data-testid="chart-omit-zero-values"]',
          '[data-testid^="chart-aggregation-"]',
        ].join(', ')
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const testId = element.getAttribute('data-testid') ?? '';

          if (element.hasAttribute('data-chart-settings-section-header')) return `# ${element.textContent?.trim()}`;
          if (element.getAttribute('role') === 'separator') return '---';
          if (testId.startsWith('chart-x-axis-field-')) return `x: ${element.textContent?.trim()}`;
          return testId;
        })
      );

    expect(outline).toEqual([
      'database-properties-settings-trigger',
      'database-layout-settings-trigger',
      '---',
      '# Chart type',
      'chart-type-button-bar',
      'chart-type-button-horizontal-bar',
      'chart-type-button-line',
      'chart-type-button-donut',
      '# X-Axis',
      'x: Type',
      'x: Done',
      'chart-omit-zero-values',
      '# Aggregation',
      'chart-aggregation-count',
      'chart-aggregation-count-values',
      'chart-aggregation-sum',
      'chart-aggregation-average',
      'chart-aggregation-min',
      'chart-aggregation-max',
      'chart-aggregation-median',
    ]);
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toHaveCount(0);

    // And: it is desktop's 240px wide popover (polled so the zoom-in
    // animation cannot skew the measurement)
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(240);

    // When: picking Sum, whose Y-Axis section pushes the content past 550px
    await selectAggregation(page, 'Sum');
    await expect(ChartSettingsSelectors.yAxisLabel(page)).toBeVisible();

    // Then: the popover stops at desktop's 550px and scrolls the rest
    await expect.poll(async () => (await panel.boundingBox())?.height).toBe(550);
    expect(
      await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollHeight > element.clientHeight && element.scrollTop > 0;
      })
    ).toBe(true);
  });
  test('lets tilted category labels paint past the chart surface like desktop', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a chart over a grid with tagged rows
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await addChartViewTab(page);
    await waitForChartReady(page);

    // Then: the Recharts SVG does not clip, so the ends of labels tilted in
    // narrow slots and wide value labels keep their first letters
    await expect(page.locator('[data-testid="bar-chart-plot"] .recharts-surface')).toHaveCSS('overflow', 'visible');
  });

  test('recomputes when a row changes while the chart is open', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: two tagged rows and one untagged row charted by Type
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');
    await addChartViewTab(page);
    await waitForChartReady(page);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1']);

    // When: a collaborator-style edit changes the untagged row's cell in place
    // (written straight into the row document, no view switch or reload)
    const rowIds = await getActiveRowIds(page);

    await setSelectCellDirect(page, rowIds[2], 'Type', 'Option C');

    // Then: the chart picks the change up without a remount
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'Option C', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1', '0']);
  });
});
