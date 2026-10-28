/**
 * Chart settings — chart type switching.
 *
 * Verifies the chart type grid in
 * `src/components/database/components/settings/chart/ChartTypeGrid.tsx`
 * (desktop's `ChartTypeGrid`: four icon buttons, Bar / Horizontal Bar / Line /
 * Donut) and that each type renders its widget:
 *
 *  - Bar            → Recharts `.recharts-bar-rectangle` per category
 *  - Horizontal Bar → plain `horizontal-bar-chart-row` elements (no Recharts)
 *  - Line           → Recharts `.recharts-line`, drawn without point markers
 *  - Donut          → `donut-chart-section`s with leader labels, the total in
 *                     the hole and a clickable legend
 *
 * Horizontal Bar, Line and Donut are Pro chart types on official hosting: on
 * a confirmed Free plan they carry a crown and open the upgrade prompt
 * instead, and while the plan is still unknown they are inert without a
 * crown, so a Pro user never sees one flash.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import {
  addChartViewTab,
  closeChartSettings,
  collectUnexpectedPageErrors,
  expectNoUnexpectedPageErrors,
  mockFreeSubscription,
  mockProSubscription,
  openChartSettings,
  selectChartType,
  setSelectOptionOnRow,
  waitForChartReady,
  waitForDrilldownOpen,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { ChartDrilldownSelectors, ChartSelectors, ChartSettingsSelectors, ChartTypeName } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const PREMIUM_CHART_TYPES: ChartTypeName[] = ['Horizontal Bar', 'Line', 'Donut'];
/** The two reads behind one workspace plan lookup. */
const BILLING_ROUTES = ['**/billing/api/v1/active-subscription/**', '**/billing/api/v1/subscriptions'];

let pageErrors: Error[] = [];

async function setupChartWithData(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await signInAndCreateDatabaseView(page, request, email, 'Grid');
  // Two distinct categories plus the empty third row, so every chart type
  // draws three categories of one row each: Option A, Option B, No Type.
  await setSelectOptionOnRow(page, 0, 'Option A');
  await setSelectOptionOnRow(page, 1, 'Option B');
  await addChartViewTab(page);
  await waitForChartReady(page);
}

test.beforeEach(async ({ page }) => {
  pageErrors = collectUnexpectedPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(() => {
  expectNoUnexpectedPageErrors(pageErrors);
});

test.describe('Chart settings — Chart type', () => {
  test.beforeEach(async ({ page }) => {
    await mockProSubscription(page);
  });

  test('shows the four chart types as icon buttons with Bar selected', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);

    // Then: no crown, right away: the plan is read while the chart view is
    // mounted, and a plan still loading leaves the premium types plain
    // rather than crowned
    expect(await ChartSettingsSelectors.panel(page).locator('[data-chart-type-pro-badge]').count()).toBe(0);

    // And: four buttons in desktop's order, named by their type
    const buttons = ChartSettingsSelectors.chartTypeButtons(page);

    await expect(buttons).toHaveCount(4);
    expect(await buttons.evaluateAll((elements) => elements.map((el) => el.getAttribute('aria-label')))).toEqual([
      'Bar',
      'Horizontal Bar',
      'Line',
      'Donut',
    ]);

    // And: Bar is the pressed one by default
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-pressed', 'true');
    for (const type of PREMIUM_CHART_TYPES) {
      await expect(ChartSettingsSelectors.chartTypeButton(page, type)).toHaveAttribute('aria-pressed', 'false');
    }

    // And: with a Pro plan every type can switch the chart, still without a crown
    for (const type of PREMIUM_CHART_TYPES) {
      await expect(ChartSettingsSelectors.unlockedChartTypeButton(page, type)).toBeVisible({ timeout: 15000 });
    }

    await expect(ChartSettingsSelectors.panel(page).locator('[data-chart-type-pro-badge]')).toHaveCount(0);

    // And: hovering an icon button names it in a tooltip
    await ChartSettingsSelectors.chartTypeButton(page, 'Line').hover();
    await expect(page.getByRole('tooltip', { name: 'Line', exact: true })).toBeVisible();
  });

  test('keeps the premium chart types plain and inert until the plan is known', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);

    // Given: billing reads held back until released. Registered after the
    // instant Pro mock, so they take precedence and fall back to it once
    // released; the reload drops the plan the chart view read when it first
    // mounted.
    let releaseBilling: () => void = () => undefined;
    const billingReleased = new Promise<void>((resolve) => {
      releaseBilling = resolve;
    });

    for (const url of BILLING_ROUTES) {
      await page.route(url, async (route) => {
        await billingReleased;
        await route.fallback().catch(() => undefined);
      });
    }

    try {
      await page.reload();
      await waitForChartReady(page);
      await openChartSettings(page);
      const panel = ChartSettingsSelectors.panel(page);

      // Then: while the plan is unknown nothing is crowned or locked; Bar is
      // usable and the premium types are inert, under their plain names
      expect(await panel.locator('[data-chart-type-pro-badge]').count()).toBe(0);
      await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).not.toHaveAttribute('aria-disabled', 'true');
      for (const type of PREMIUM_CHART_TYPES) {
        const button = ChartSettingsSelectors.chartTypeButton(page, type);

        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(button).not.toHaveAttribute('data-locked', 'true');
        await expect(button).toHaveAccessibleName(type);
      }

      // When: clicking Line anyway (forced: Playwright's own click waits for
      // an aria-disabled button to be enabled)
      await ChartSettingsSelectors.chartTypeButton(page, 'Line').click({ force: true });

      // Then: neither a switch nor the upgrade flow, and the popover stays open
      await expect(panel).toBeVisible();
      await expect(ChartSettingsSelectors.chartTypeButton(page, 'Line')).toHaveAttribute('aria-pressed', 'false');
      await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-pressed', 'true');
      await expect(page).not.toHaveURL(/[?&]action=change_plan/);
      expect(await panel.locator('[data-chart-type-pro-badge]').count()).toBe(0);

      // When: the Pro plan arrives
      releaseBilling();

      // Then: the premium types unlock without ever showing a crown, and Line
      // switches the chart
      await selectChartType(page, 'Line');
      await expect(panel.locator('[data-chart-type-pro-badge]')).toHaveCount(0);
      await closeChartSettings(page);
      await expect(ChartSelectors.lineWidget(page)).toBeVisible({ timeout: 10000 });
    } finally {
      releaseBilling();
    }
  });

  test('switching to Line keeps the popover open and draws a point per category', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Line');

    // Then: like desktop, the popover stays open and only Line is pressed
    await expect(ChartSettingsSelectors.panel(page)).toBeVisible();
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).toHaveAttribute('aria-pressed', 'false');

    // And: the bar chart is replaced by a line; like desktop #1519 it draws no
    // point markers, only a value label per category
    await closeChartSettings(page);
    await expect(ChartSelectors.lineWidget(page)).toBeVisible({ timeout: 10000 });
    await expect(ChartSelectors.barWidget(page)).toHaveCount(0);
    await expect(ChartSelectors.lineChart(page)).toBeVisible();
    await expect(ChartSelectors.dots(page)).toHaveCount(0);
    await expect(ChartSelectors.categoryLabels(page)).toHaveText(['Option A', 'Option B', 'No Type']);
    await expect(ChartSelectors.valueLabels(page)).toHaveText(['1', '1', '1']);
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
  });

  test('switching to Horizontal Bar draws one labelled row per category', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Horizontal Bar');
    await closeChartSettings(page);

    // Then: plain rows of label, bar and value replace the Recharts bars
    await expect(ChartSelectors.horizontalBarWidget(page)).toBeVisible({ timeout: 10000 });
    await expect(ChartSelectors.bars(page)).toHaveCount(0);
    await expect(ChartSelectors.horizontalBarLabels(page)).toHaveText(['Option A', 'Option B', 'No Type']);
    await expect(ChartSelectors.horizontalBarValues(page)).toHaveText(['1', '1', '1']);
    await expect(ChartSelectors.title(page)).toHaveText('Count(Type)');
  });

  test('switching to Donut draws the ring, leader labels, total and legend', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);
    await selectChartType(page, 'Donut');
    await closeChartSettings(page);

    // Then: one ring section per category with a "<value> (<share>%)" leader
    await expect(ChartSelectors.donutWidget(page)).toBeVisible({ timeout: 10000 });
    await expect(ChartSelectors.donutSections(page)).toHaveCount(3);
    await expect(ChartSelectors.donutLeaderValues(page)).toHaveText(['1 (33.3%)', '1 (33.3%)', '1 (33.3%)']);

    // And: the hole shows the total under desktop's aggregation title
    await expect(ChartSelectors.donutCenter(page)).toContainText('3');
    await expect(ChartSelectors.donutCenter(page)).toContainText('Total');
    await expect(ChartSelectors.donutCenter(page).getByTestId('chart-title')).toHaveText('Count(Type)');

    // And: the legend lists the categories in chart order
    await expect(ChartSelectors.donutLegendItems(page)).toHaveText(['Option A', 'Option B', 'No Type']);

    // When: clicking a legend item
    await ChartSelectors.donutLegendItems(page).filter({ hasText: 'Option B' }).click();

    // Then: it drills into that category's rows
    await waitForDrilldownOpen(page);
    await expect(ChartDrilldownSelectors.title(page)).toContainText('Option B');
    await expect(ChartDrilldownSelectors.rows(page)).toHaveCount(1);
  });
});

test.describe('Chart settings — Chart type on the Free plan', () => {
  test.beforeEach(async ({ page }) => {
    await mockFreeSubscription(page);
  });

  test('premium chart types carry a Pro crown and open the upgrade prompt', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await setupChartWithData(page, request, testEmail);
    await openChartSettings(page);

    // Then: Bar stays free while the three premium types are crowned. A
    // crown (and `data-locked`) only renders once billing confirmed the Free
    // plan; until then the types are inert instead.
    await expect(ChartSettingsSelectors.chartTypeButton(page, 'Bar')).not.toHaveAttribute('data-locked', 'true');
    await expect(ChartSettingsSelectors.chartTypeProBadge(page, 'Bar')).toHaveCount(0);
    for (const type of PREMIUM_CHART_TYPES) {
      const button = ChartSettingsSelectors.chartTypeButton(page, type);

      await expect(button).toHaveAttribute('data-locked', 'true', { timeout: 15000 });
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAccessibleName(`${type} (Upgrade Required)`);
      await expect(ChartSettingsSelectors.chartTypeProBadge(page, type)).toBeVisible();
    }

    // When: clicking the crowned Line type, as the workspace owner
    await ChartSettingsSelectors.chartTypeButton(page, 'Line').click();

    // Then: the popover closes for the plan comparison instead of switching
    await expect(ChartSettingsSelectors.panel(page)).toBeHidden();
    await expect(page).toHaveURL(/[?&]action=change_plan/);
    await expect(ChartSelectors.barWidget(page)).toBeVisible();
    await expect(ChartSelectors.lineWidget(page)).toHaveCount(0);
  });
});
