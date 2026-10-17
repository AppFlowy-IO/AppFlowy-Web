/**
 * Chart test helpers for Playwright E2E tests.
 * Migrated from: cypress/support (chart_view branch)
 *
 * The chart settings are one popover off the database settings (gear) button,
 * like desktop's revamped panel (PR #1461): Properties and Layout, then the
 * chart sections inline. Choosing a chart type, field, aggregation or toggle
 * keeps the popover open, so the select helpers leave it open and tests close
 * it with `closeChartSettings` before looking at the chart.
 */
import { Locator, Page, expect } from '@playwright/test';

import {
  ChartAggregationName,
  ChartDateGroupingName,
  ChartDrilldownSelectors,
  ChartSelectors,
  ChartSettingsSelectors,
  ChartTypeName,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from './selectors';
import { mockServerInfo } from './server-info-helpers';
import { expectViewCreationAvailable } from './view-creation-availability';

export { mockProSubscription } from './subscription-test-helpers';

/**
 * Official hosting on the Free plan: billing reports no active subscription,
 * so Horizontal Bar, Line and Donut are locked behind the Pro crown.
 */
export async function mockFreeSubscription(page: Page): Promise<void> {
  await mockServerInfo(page, { self_hosted: false });
  for (const url of ['**/billing/api/v1/active-subscription/**', '**/billing/api/v1/subscriptions']) {
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [], message: '' }),
      })
    );
  }
}

/** Page errors the app raises in these flows that no chart test treats as a failure. */
const KNOWN_PAGE_ERRORS = [
  'Minified React error',
  'View not found',
  'No workspace or service found',
  'ResizeObserver loop',
];

/**
 * Record every page error outside `KNOWN_PAGE_ERRORS` from now on. Call it in
 * `beforeEach` and hand the list to `expectNoUnexpectedPageErrors` in
 * `afterEach`, so an exception in a settings write or a chart render fails
 * the test even when its DOM assertions still pass.
 */
export function collectUnexpectedPageErrors(page: Page): Error[] {
  const errors: Error[] = [];

  page.on('pageerror', (error) => {
    if (KNOWN_PAGE_ERRORS.some((known) => error.message.includes(known))) return;
    errors.push(error);
  });

  return errors;
}

/** Fail on the page errors `collectUnexpectedPageErrors` recorded. */
export function expectNoUnexpectedPageErrors(errors: Error[]): void {
  expect(
    errors.map((error) => error.message),
    'the page should raise no error outside the known list'
  ).toEqual([]);
}

/**
 * Move the pointer off the chart. A hovered bar hides its value label and a
 * hovered donut section is drawn last, so a pointer left over the chart (for
 * example where the settings popover was) changes what the chart shows.
 */
export async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
}

/**
 * Wait for the chart container and a rendered chart (a Recharts wrapper, or
 * the horizontal bar chart's rows), then park the pointer.
 */
export async function waitForChartReady(page: Page): Promise<void> {
  await expect(ChartSelectors.chart(page)).toBeVisible({ timeout: 15000 });
  await expect(ChartSelectors.anyChart(page)).toBeVisible({ timeout: 15000 });
  await parkMouse(page);
}

/**
 * Add a Chart view tab to an already-open database via the "+" tab button.
 */
export async function addChartViewTab(page: Page): Promise<void> {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });
  await page.waitForTimeout(1000);
  const chartOption = DatabaseViewSelectors.viewTypeOption(page, 'Chart');

  await expectViewCreationAvailable(chartOption);
  await chartOption.click({ force: true });
  await page.waitForTimeout(3000);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Set the Type (single select) cell of a row to an option: open the cell's
 * option menu, search the name and click the option, or the "Create <name>"
 * row when it does not exist yet. Every step waits for the state it needs
 * and the cell must show the option before this returns, so a setup problem
 * fails here and not as a chart label mismatch later.
 */
export async function setSelectOptionOnRow(page: Page, rowIndex: number, optionName: string): Promise<void> {
  const cell = DatabaseGridSelectors.dataRows(page).nth(rowIndex).locator('.grid-row-cell').nth(1);
  const menu = page.getByTestId('select-option-menu');
  const name = escapeRegExp(optionName);

  // Until the row document has loaded, the cell is a blank placeholder: a
  // click still makes it the active cell, but its menu opens later and would
  // catch the next call's input.
  await expect(cell.locator('.select-option-cell'), `row ${rowIndex} should load its Type cell`).toHaveCount(1, {
    timeout: 15000,
  });
  // Dispatched on the cell itself, so nothing drawn over it can take the click.
  await cell.dispatchEvent('click');
  await expect(menu).toBeVisible();
  await menu.locator('input').first().fill(optionName);

  // Click the row rather than press Enter: the menu acts on the option it
  // highlighted a render earlier, which is the first partial match of the
  // search, so an immediate Enter can pick an existing option instead.
  const existingOption = menu
    .locator('[data-testid^="select-option-"]')
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });
  const createOption = menu
    .locator('div')
    .filter({ hasText: new RegExp(`^\\s*Create\\s*${name}\\s*$`) })
    .last();

  await expect(existingOption.or(createOption).first()).toBeVisible();
  await ((await createOption.isVisible()) ? createOption : existingOption.first()).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(cell, `row ${rowIndex} should show the option "${optionName}"`).toHaveText(optionName);
}

/**
 * Open the chart settings popover (gear button) unless it is already open,
 * and wait for the inline chart sections.
 */
export async function openChartSettings(page: Page): Promise<void> {
  const panel = ChartSettingsSelectors.panel(page);

  if (!(await panel.isVisible())) {
    await ChartSettingsSelectors.settingsButton(page).click();
  }

  await expect(panel).toBeVisible({ timeout: 5000 });
  await expect(ChartSettingsSelectors.chartSections(page)).toBeVisible();
}

/**
 * Close the chart settings popover, then park the pointer. An open tooltip
 * takes the first Escape; the date submenu closes the whole menu on Escape.
 */
export async function closeChartSettings(page: Page): Promise<void> {
  const panel = ChartSettingsSelectors.panel(page);

  for (let attempt = 0; attempt < 3 && (await panel.isVisible()); attempt += 1) {
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined);
  }

  await expect(panel).toBeHidden();
  await parkMouse(page);
}

/**
 * Click a chart type button in the open settings popover and wait until it is
 * pressed. Until the workspace plan is known a premium type is inert (no
 * crown, `aria-disabled`) and a click on it does nothing, so wait for the
 * switchable state first.
 */
export async function selectChartType(page: Page, type: ChartTypeName): Promise<void> {
  const button = ChartSettingsSelectors.unlockedChartTypeButton(page, type);

  await expect(button, `${type} should unlock once the plan is known`).toBeVisible({ timeout: 15000 });
  await button.click();
  await expect(ChartSettingsSelectors.chartTypeButton(page, type)).toHaveAttribute('aria-pressed', 'true');
}

/** Click a non-date X-Axis field row in the open settings popover. */
export async function selectXAxisField(page: Page, fieldName: string): Promise<void> {
  const row = ChartSettingsSelectors.xAxisField(page, fieldName);

  await row.click();
  await expect(row).toHaveAttribute('data-selected', 'true');
}

/** Click an aggregation row in the open settings popover. */
export async function selectAggregation(page: Page, aggregation: ChartAggregationName): Promise<void> {
  const item = ChartSettingsSelectors.aggregationItem(page, aggregation);

  await item.click();
  await expect(item).toHaveAttribute('data-selected', 'true');
}

/** Click a Y-Axis field row in the open settings popover (aggregation other than Count). */
export async function selectYAxisField(page: Page, fieldName: string): Promise<void> {
  const row = ChartSettingsSelectors.yAxisField(page, fieldName);

  await row.click();
  await expect(row).toHaveAttribute('data-selected', 'true');
}

/** Flip the "Omit zero values" toggle in the open settings popover. */
export async function toggleOmitZeroValues(page: Page): Promise<void> {
  const row = ChartSettingsSelectors.omitZeroValues(page);
  const wasChecked = (await row.getAttribute('aria-checked')) === 'true';

  await row.click();
  await expect(row).toHaveAttribute('aria-checked', String(!wasChecked));
}

/** Hover a date X-Axis row so its grouping submenu opens; hovering does not select the field. */
export async function openDateGroupingMenu(page: Page, fieldName: string): Promise<void> {
  await ChartSettingsSelectors.xAxisField(page, fieldName).hover();
  await expect(ChartSettingsSelectors.dateGroupingMenu(page)).toBeVisible();
}

/**
 * The `data-side` values a submenu shows over the next animation frames: a
 * single value once its placement has settled.
 */
async function sampleSubmenuSides(menu: Locator, frames = 10): Promise<string[]> {
  return menu.evaluate(async (element, frameCount) => {
    const sides = new Set<string>();

    for (let frame = 0; frame < frameCount; frame += 1) {
      sides.add(element.getAttribute('data-side') ?? '');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    return Array.from(sides);
  }, frames);
}

/**
 * Pick a date grouping from a date X-Axis row's submenu with the pointer, as
 * a user does. That also selects the field, and closes only the submenu.
 */
export async function selectDateGrouping(page: Page, fieldName: string, grouping: ChartDateGroupingName): Promise<void> {
  await openDateGroupingMenu(page, fieldName);
  const menu = ChartSettingsSelectors.dateGroupingMenu(page);
  const item = ChartSettingsSelectors.dateGroupingItem(page, grouping);

  // Radix parks the submenu off screen until it is placed. A placement that
  // keeps flipping sides afterwards never gets stable enough to click, so
  // fail on that here rather than behind a click timeout.
  await expect(item).toBeInViewport();
  expect(await sampleSubmenuSides(menu), 'the date grouping submenu should settle on one side').toHaveLength(1);

  // Radix keeps a submenu open while the pointer leaves its row only if the
  // pointer is heading towards the submenu's side; a one-step jump closes it.
  const box = await item.boundingBox();

  if (!box) throw new Error(`The ${grouping} grouping has no box to move the pointer to`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await item.click();

  await expect(menu).toBeHidden();
  await expect(ChartSettingsSelectors.panel(page)).toBeVisible();
  await expect(ChartSettingsSelectors.xAxisField(page, fieldName)).toHaveAttribute('data-selected', 'true');
}

/** A selected field, aggregation or date grouping row: `data-selected` plus the tick. */
export async function expectOptionSelected(row: Locator): Promise<void> {
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(ChartSettingsSelectors.selectedTick(row)).toBeVisible();
}

export async function expectOptionNotSelected(row: Locator): Promise<void> {
  await expect(row).not.toHaveAttribute('data-selected', 'true');
  await expect(ChartSettingsSelectors.selectedTick(row)).toHaveCount(0);
}

/**
 * Hover the bar chart column of a category through its axis label. Like
 * desktop, a column reacts to the pointer's x anywhere over the plot, so this
 * also reaches a zero-height bar, which has no rectangle to aim at.
 */
export async function hoverBarColumn(page: Page, label: string): Promise<void> {
  await ChartSelectors.categoryLabel(page, label).hover({ force: true });
}

/** Click the bar chart column of a category through its axis label (see `hoverBarColumn`). */
export async function clickBarColumn(page: Page, label: string): Promise<void> {
  await ChartSelectors.categoryLabel(page, label).click({ force: true });
}

/**
 * Click the first rendered bar in a Bar chart to open the drilldown popup.
 */
export async function clickFirstBar(page: Page): Promise<void> {
  await ChartSelectors.bars(page).first().click();
}

/**
 * Wait for the drilldown popup dialog to be visible.
 */
export async function waitForDrilldownOpen(page: Page): Promise<void> {
  await expect(ChartDrilldownSelectors.dialog(page)).toBeVisible({ timeout: 10000 });
}

/**
 * Close the drilldown popup via Escape (more reliable than targeting the X
 * button when MUI renders multiple buttons inside Dialog).
 */
export async function closeDrilldown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
