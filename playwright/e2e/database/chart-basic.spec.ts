/**
 * Chart database view — basic tests.
 *
 * Migrated from: cypress/e2e/database/chart-basic.cy.ts (chart_view branch)
 *
 * Covers: create chart from sidebar, create chart view from grid, render with
 * data, empty-category fallback, and view-tab switching.
 */
import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  addChartViewTab,
  setSelectOptionOnRow,
  waitForChartReady,
} from '../../support/chart-test-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  AddPageSelectors,
  ChartSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Database Chart View Basic', () => {
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

    await page.setViewportSize({ width: 1280, height: 720 });
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
    await AddPageSelectors.addChartButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Then: a Chart view is rendered
    await waitForChartReady(page);
  });

  test('should create a chart view from an existing grid database', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');

    // When: adding a Chart view tab
    await addChartViewTab(page);

    // Then: the Chart view is rendered
    await expect(ChartSelectors.chart(page)).toBeVisible({ timeout: 15000 });
  });

  test('should display chart with data when rows have select option values', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with two rows tagged with different SingleSelect options
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');
    await setSelectOptionOnRow(page, 0, 'Option A');
    await setSelectOptionOnRow(page, 1, 'Option B');

    // When: opening a Chart view on top of that grid
    await addChartViewTab(page);

    // Then: the Recharts wrapper is mounted (chart actually rendered)
    await waitForChartReady(page);
  });

  test('should show empty category when rows have no select option value', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a grid with no values entered into the Type field
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid');

    // When: switching to Chart view
    await addChartViewTab(page);

    // Then: chart renders and includes the "No Type" empty category label
    await waitForChartReady(page);
    await expect(ChartSelectors.chart(page)).toContainText('No Type');
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
});
