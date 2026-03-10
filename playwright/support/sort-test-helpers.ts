/**
 * Sort test helpers for database E2E tests (Playwright)
 * Migrated from: cypress/support/sort-test-helpers.ts
 *
 * Provides utilities for creating, managing, and verifying sorts
 */
import { Page, expect } from '@playwright/test';
import { DatabaseFilterSelectors, DatabaseGridSelectors, SortSelectors } from './selectors';

/**
 * Sort direction enum
 */
export enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

/**
 * Common beforeEach setup for sort tests
 */
export function setupSortTest(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return;
    }
  });
}

/**
 * Click the sort button to open the sort menu or add first sort
 */
export async function clickSortButton(page: Page): Promise<void> {
  await SortSelectors.sortButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Add a sort on a field by name
 */
export async function addSortByFieldName(page: Page, fieldName: string): Promise<void> {
  const hasSorts = (await SortSelectors.sortCondition(page).count()) > 0;

  if (hasSorts) {
    // Click the existing sort condition to open menu
    await SortSelectors.sortCondition(page).first().click({ force: true });
    await page.waitForTimeout(500);

    // Click add sort button
    await SortSelectors.addSortButton(page).click({ force: true });
    await page.waitForTimeout(500);
  } else {
    // Click sort button to open field selection
    await SortSelectors.sortButton(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  // Find and click the field by name
  await DatabaseFilterSelectors.propertyItemByName(page, fieldName).click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Open the sort menu by clicking on the sort condition chip
 */
export async function openSortMenu(page: Page): Promise<void> {
  await SortSelectors.sortCondition(page).first().click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Toggle sort direction (ascending/descending)
 * @param sortIndex - Index of the sort to toggle (0-based)
 */
export async function toggleSortDirection(page: Page, sortIndex: number = 0): Promise<void> {
  const sortItems = page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .locator('[data-testid="sort-condition"]')
    .nth(sortIndex)
    .locator('button');

  const buttonCount = await sortItems.count();
  for (let i = 0; i < buttonCount; i++) {
    const text = (await sortItems.nth(i).textContent())?.toLowerCase() || '';
    if (text.includes('ascending') || text.includes('descending')) {
      const currentText = text;
      await sortItems.nth(i).click({ force: true });
      await page.waitForTimeout(500);

      // Select the OPPOSITE direction
      const targetText = currentText.includes('ascending') ? 'descending' : 'ascending';
      await page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('[role="menuitem"]')
        .filter({ hasText: new RegExp(targetText, 'i') })
        .first()
        .click({ force: true });
      await page.waitForTimeout(500);
      break;
    }
  }
}

/**
 * Change sort direction for a specific sort
 */
export async function changeSortDirection(
  page: Page,
  sortIndex: number,
  direction: SortDirection
): Promise<void> {
  const sortItems = page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .locator('[data-testid="sort-condition"]')
    .nth(sortIndex)
    .locator('button');

  const buttonCount = await sortItems.count();
  for (let i = 0; i < buttonCount; i++) {
    const text = (await sortItems.nth(i).textContent())?.toLowerCase() || '';
    if (text.includes('ascending') || text.includes('descending')) {
      await sortItems.nth(i).click({ force: true });
      await page.waitForTimeout(500);
      break;
    }
  }

  const targetText = direction === SortDirection.Ascending ? 'ascending' : 'descending';
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .locator('[role="menuitem"]')
    .filter({ hasText: new RegExp(targetText, 'i') })
    .first()
    .click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Delete a specific sort by index
 */
export async function deleteSort(page: Page, sortIndex: number = 0): Promise<void> {
  // Find the sort item and click its delete button (last button in the sort row)
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .locator('[data-testid="sort-condition"]')
    .nth(sortIndex)
    .locator('button')
    .last()
    .click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Delete all sorts
 */
export async function deleteAllSorts(page: Page): Promise<void> {
  await SortSelectors.deleteAllSortsButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Assert the row order based on cell text content in primary field
 */
export async function assertRowOrder(
  page: Page,
  primaryFieldId: string,
  expectedOrder: string[]
): Promise<void> {
  const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
  for (let i = 0; i < expectedOrder.length; i++) {
    await expect(cells.nth(i)).toContainText(expectedOrder[i]);
  }
}

/**
 * Get all cell values from a column in order
 */
export async function getCellValuesInOrder(page: Page, fieldId: string): Promise<string[]> {
  const cells = DatabaseGridSelectors.dataRowCellsForField(page, fieldId);
  const count = await cells.count();
  const values: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await cells.nth(i).textContent();
    values.push((text || '').trim());
  }
  return values;
}

/**
 * Assert that a specific number of sorts are applied
 */
export async function assertSortCount(page: Page, count: number): Promise<void> {
  if (count === 0) {
    await expect(SortSelectors.sortCondition(page)).toHaveCount(0);
  } else {
    await openSortMenu(page);
    await expect(
      page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('[data-testid="sort-condition"]')
    ).toHaveCount(count);
  }
}

/**
 * Close the sort menu by pressing Escape
 */
export async function closeSortMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
