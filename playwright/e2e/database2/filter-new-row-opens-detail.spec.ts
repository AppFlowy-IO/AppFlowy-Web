/**
 * When filters are active, clicking "+ New row" should open the row detail
 * modal so the user can complete the row (its primary cell is empty and may
 * need to be filled to satisfy the filter or just to be useful).
 */
import { test, expect } from '@playwright/test';

import { addRows } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  generateRandomEmail,
  loginAndCreateGrid,
  setupFilterTest,
} from '../../support/filter-test-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';

test.describe('New row opens detail when filter is active', () => {
  test('clicking new row with filter opens row detail modal', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    // Add a Name filter (works without typing content — empty filter still counts).
    await addFilterByFieldName(page, 'Name');

    // Dismiss the filter chip popover by clicking the grid area (avoid Escape — it
    // closes the chip popover but can also dispatch to other listeners).
    await page.locator('main').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(500);

    // Verify the filter persists.
    await expect(page.getByTestId('database-filter-condition')).toHaveCount(1);

    // Click "+ New row".
    await DatabaseGridSelectors.newRowButton(page).click();

    // The row detail modal should appear (MUI Dialog renders [role="dialog"]).
    await expect(page.locator('[role="dialog"]').last()).toBeVisible({ timeout: 8000 });
  });

  test('clicking new row without filter does NOT open detail modal', async ({ page, request }) => {
    setupFilterTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const dialogsBefore = await page.locator('[role="dialog"]').count();
    await addRows(page, 1);
    await page.waitForTimeout(1500);
    const dialogsAfter = await page.locator('[role="dialog"]').count();

    expect(dialogsAfter).toBe(dialogsBefore);
  });
});
