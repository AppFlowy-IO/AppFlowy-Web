/**
 * Filter test helpers for database E2E tests (Playwright)
 * Migrated from: cypress/support/filter-test-helpers.ts
 *
 * Provides utilities for creating, managing, and verifying filters
 */
import { Page, APIRequestContext, expect, Locator } from '@playwright/test';
import { AddPageSelectors, DatabaseFilterSelectors, DatabaseGridSelectors } from './selectors';
import { generateRandomEmail, setupPageErrorHandling } from './test-config';
import { signInAndWaitForApp } from './auth-flow-helpers';
import { waitForGridReady, createDatabaseView } from './database-ui-helpers';

// Re-export for convenience
export { generateRandomEmail, setupPageErrorHandling };

/**
 * Text filter condition enum values (matching TextFilterCondition)
 */
export enum TextFilterCondition {
  TextIs = 0,
  TextIsNot = 1,
  TextContains = 2,
  TextDoesNotContain = 3,
  TextStartsWith = 4,
  TextEndsWith = 5,
  TextIsEmpty = 6,
  TextIsNotEmpty = 7,
}

/**
 * Number filter condition enum values (matching NumberFilterCondition)
 */
export enum NumberFilterCondition {
  Equal = 0,
  NotEqual = 1,
  GreaterThan = 2,
  LessThan = 3,
  GreaterThanOrEqualTo = 4,
  LessThanOrEqualTo = 5,
  NumberIsEmpty = 6,
  NumberIsNotEmpty = 7,
}

/**
 * Checkbox filter condition enum values (matching CheckboxFilterCondition)
 */
export enum CheckboxFilterCondition {
  IsChecked = 0,
  IsUnchecked = 1,
}

/**
 * Select filter condition enum values (matching SelectOptionFilterCondition)
 */
export enum SelectFilterCondition {
  OptionIs = 0,
  OptionIsNot = 1,
  OptionContains = 2,
  OptionDoesNotContain = 3,
  OptionIsEmpty = 4,
  OptionIsNotEmpty = 5,
}

/**
 * Common beforeEach setup for filter tests.
 * @deprecated Use `setupPageErrorHandling(page)` from `test-config` instead.
 */
export function setupFilterTest(page: Page): void {
  setupPageErrorHandling(page);
}

/**
 * Login and create a new grid for filter testing
 */
export async function loginAndCreateGrid(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await signInAndWaitForApp(page, request, email);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(2000);

  // Create a new grid
  await createDatabaseView(page, 'Grid', 7000);
  await waitForGridReady(page);
}

/**
 * Type text into a cell at the specified index
 * NOTE: Uses Enter to save the value, not Escape.
 * This is important because NumberCell only saves on Enter/blur, not on Escape.
 */
export async function typeTextIntoCell(page: Page, fieldId: string, cellIndex: number, text: string): Promise<void> {
  // Click to enter edit mode (double-click)
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(cellIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await cell.click(); // Double click to enter edit mode

  // Wait for textarea and type
  const textarea = page.locator('textarea:visible').first();
  await expect(textarea).toBeVisible({ timeout: 8000 });
  await textarea.clear();

  // Replace newlines with Shift+Enter to insert actual newlines
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.press('Shift+Enter');
    }
    await textarea.pressSequentially(lines[i], { delay: 30 });
  }

  // Press Enter to save the value and close the cell
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/**
 * Open the filter menu by clicking the filter button
 */
export async function openFilterMenu(page: Page): Promise<void> {
  const filterBtn = DatabaseFilterSelectors.filterButton(page);
  await filterBtn.waitFor({ state: 'attached', timeout: 10000 });
  await filterBtn.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(500);
}

/**
 * Add a filter on a field by name
 */
export async function addFilterByFieldName(page: Page, fieldName: string): Promise<void> {
  // Close any open popovers/menus from previous operations.
  // Press Escape multiple times to close nested popovers/menus.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Wait for any open menus (portaled Radix menus) to close.
  // If a field header menu is open, it renders as [role="menu"] in a portal.
  try {
    await page.locator('[role="menu"]').waitFor({ state: 'hidden', timeout: 2000 });
  } catch {
    // If menu is still visible, click on an empty area to dismiss it
    await page.mouse.click(1, 1);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Click add filter button if visible, otherwise the filter button opens a popover
  const addFilterButton = DatabaseFilterSelectors.addFilterButton(page);
  if (await addFilterButton.isVisible().catch(() => false)) {
    await addFilterButton.evaluate((el) => (el as HTMLElement).click());
  } else {
    // Use JS click to match Cypress force:true behavior.
    // Playwright's force:true dispatches a pointer event at coordinates which may
    // miss the React handler if the element is partially hidden. JS click fires
    // the event directly on the element like Cypress does.
    const filterBtn = DatabaseFilterSelectors.filterButton(page);
    await filterBtn.waitFor({ state: 'attached', timeout: 10000 });
    await filterBtn.evaluate((el) => (el as HTMLElement).click());
  }

  // Wait for the property list popover to appear with [data-item-id] elements.
  // A condition update can close and immediately rebuild the conditions row;
  // retry the user action once if the first click landed on the stale button.
  const propertyItems = page.locator('[data-item-id]:visible');
  const propertyListOpened = await propertyItems
    .first()
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  if (!propertyListOpened) {
    const currentAddFilterButton = DatabaseFilterSelectors.addFilterButton(page);

    if (await currentAddFilterButton.isVisible().catch(() => false)) {
      await currentAddFilterButton.click({ force: true });
    } else {
      await DatabaseFilterSelectors.filterButton(page).click({ force: true });
    }
  }
  await expect(propertyItems.first()).toBeVisible({ timeout: 10000 });

  // Search for the field and click it using JS click
  await DatabaseFilterSelectors.propertyItemByName(page, fieldName).evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(1000);

  // Wait for the filter panel to be visible
  await expect(page.locator('.database-conditions')).toHaveCSS('visibility', 'visible', {
    timeout: 10000,
  });
}

/**
 * Click on the active filter chip to open its menu
 */
export async function clickFilterChip(page: Page): Promise<void> {
  await DatabaseFilterSelectors.filterCondition(page).first().click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Change the filter condition by selecting from the dropdown
 */
export async function changeFilterCondition(page: Page, conditionValue: number): Promise<void> {
  let expectedLabel = '';

  // A condition update rebuilds the filter row. Under parallel browser load,
  // the first forced click can land on the detached menu item while the old
  // default condition remains selected. Verify the trigger label and retry
  // once so subsequent assertions exercise the requested condition.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const trigger = page.locator('[data-testid="filter-condition-trigger"]:visible').last();

    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click({ force: true });

    const option = page.locator(`[data-testid="filter-condition-${conditionValue}"]:visible`).last();

    await expect(option).toBeVisible({ timeout: 10000 });
    expectedLabel = (await option.textContent())?.trim() ?? '';
    await option.click({ force: true });

    const updatedTrigger = page.locator('[data-testid="filter-condition-trigger"]:visible').last();
    const selected = await expect(updatedTrigger)
      .toContainText(expectedLabel, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    if (selected) return;
  }

  await expect(page.locator('[data-testid="filter-condition-trigger"]:visible').last()).toContainText(expectedLabel, {
    timeout: 10000,
  });
}

/**
 * Change the checkbox filter condition ("Checked" / "Unchecked")
 *
 * Desktop-parity checkbox editor: the popover body IS the value list — there is
 * no condition dropdown. Clicking a value applies it and closes the popover.
 */
export async function changeCheckboxFilterCondition(page: Page, condition: CheckboxFilterCondition): Promise<void> {
  const option = page.locator(`[data-testid="filter-condition-${condition}"]:visible`).last();

  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Enter text into the filter input
 */
export async function enterFilterText(page: Page, text: string): Promise<void> {
  const input = DatabaseFilterSelectors.filterInput(page);
  await input.clear();
  await input.pressSequentially(text, { delay: 30 });
  // The editor deliberately debounces Yjs updates. Wait for the visible chip
  // to reflect the persisted content before closing the popover; sleeping for
  // exactly the debounce interval races the callback on slower CI workers.
  await expect(DatabaseFilterSelectors.filterCondition(page).last()).toContainText(text, { timeout: 5000 });
}

/**
 * Delete the current filter
 * Handles both normal mode (filter chip menu) and advanced mode (filter panel)
 */
export async function deleteFilter(page: Page): Promise<void> {
  const hasAdvancedBadge = (await page.getByTestId('advanced-filters-badge').count()) > 0;
  const hasAdvancedPanel = (await page.getByTestId('advanced-filter-row').count()) > 0;

  if (hasAdvancedBadge || hasAdvancedPanel) {
    // Advanced mode
    if (!hasAdvancedPanel) {
      await page.getByTestId('advanced-filters-badge').click({ force: true });
      await page.waitForTimeout(500);
    }
    await page.getByTestId('delete-advanced-filter-button').first().click({ force: true });
    await page.waitForTimeout(500);
  } else {
    // Normal mode
    // Radix keeps popper wrappers for other toolbar controls mounted. Detect
    // the filter editor by its own controls so an open/hidden sort wrapper
    // cannot make this helper skip the filter chip.
    const hasFilterPopover =
      (await page
        .locator(
          '[data-testid="text-filter"]:visible, [data-testid="text-filter-input"]:visible, ' +
            '[data-testid="filter-more-options-button"]:visible, [data-testid="delete-filter-button"]:visible'
        )
        .count()) > 0;

    if (!hasFilterPopover) {
      await DatabaseFilterSelectors.filterCondition(page).first().click({ force: true });
      await page.waitForTimeout(500);
    }

    const hasDirectDeleteButton =
      (await page.getByTestId('delete-filter-button').count()) > 0 &&
      (await page
        .getByTestId('delete-filter-button')
        .isVisible()
        .catch(() => false));

    if (hasDirectDeleteButton) {
      await DatabaseFilterSelectors.deleteFilterButton(page).click({ force: true });
      await page.waitForTimeout(500);
    } else {
      await page.getByTestId('filter-more-options-button').click({ force: true });
      await page.waitForTimeout(300);
      await page.getByTestId('delete-filter-button').click({ force: true });
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Assert the number of visible data rows in the grid
 */
export async function assertRowCount(page: Page, expectedCount: number): Promise<void> {
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(expectedCount, { timeout: 10000 });
}

/**
 * Get the primary field ID (first column, Name field)
 */
export async function getPrimaryFieldId(page: Page): Promise<string> {
  const testId = await page.locator('[data-testid^="grid-field-header-"]').first().getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Get field ID by header name
 */
export async function getFieldIdByName(page: Page, fieldName: string): Promise<string> {
  const header = page.locator('[data-testid^="grid-field-header-"]').filter({ hasText: fieldName }).first();
  const testId = await header.getAttribute('data-testid');
  return testId?.replace('grid-field-header-', '') || '';
}

/**
 * Create a select option in the current cell/popover
 */
export async function createSelectOption(page: Page, optionName: string): Promise<void> {
  const menu = page.getByTestId('select-option-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });

  const input = menu.locator('input').first();
  await input.clear();
  await input.fill(optionName);

  const createOption = menu
    .locator('div')
    .filter({ hasText: new RegExp(`^\\s*Create\\s*${optionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
    .last();

  await expect(createOption).toBeVisible({ timeout: 5000 });
  await createOption.click({ force: true });
  await expect(menu.locator('[data-testid^="select-option-"]').filter({ hasText: optionName }).first()).toBeVisible({
    timeout: 5000,
  });
  await page.waitForTimeout(500);
}

/**
 * Click on a select cell to open the options popover
 */
export async function clickSelectCell(page: Page, fieldId: string, rowIndex: number): Promise<void> {
  // Use dispatchEvent to fire a full click event on the cell.
  // element.click() only fires 'click', but Radix Popover may need the full
  // pointer event chain. dispatchEvent with {bubbles: true} ensures React
  // synthetic event handlers fire properly.
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.dispatchEvent('click', { bubbles: true });
  // Wait for the select option popover to appear
  await expect(page.locator('[data-radix-popper-content-wrapper]').last()).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(300);
}

/**
 * Select an existing option from the dropdown
 */
export async function selectExistingOption(page: Page, optionName: string): Promise<void> {
  // Find the option by its visible text within the select-option-menu popover.
  // Options are rendered as div[data-testid^="select-option-"] with Tag labels.
  const menu = page.getByTestId('select-option-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  const option = menu.locator('[data-testid^="select-option-"]').filter({ hasText: optionName }).first();
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Select an option in the filter popover
 */
export async function selectFilterOption(page: Page, optionName: string): Promise<void> {
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .locator('[role="option"], [data-testid^="select-option-"]')
    .filter({ hasText: optionName })
    .first()
    .click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Change the select filter condition
 */
export async function changeSelectFilterCondition(page: Page, condition: SelectFilterCondition): Promise<void> {
  const trigger = page.locator('[data-testid="filter-condition-trigger"]:visible').last();

  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click({ force: true });
  await page.locator(`[data-testid="filter-condition-${condition}"]:visible`).last().click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Navigate away from the current page and then back to test persistence
 */
export async function navigateAwayAndBack(page: Page): Promise<void> {
  const currentUrl = page.url();

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await waitForGridReady(page);
}
