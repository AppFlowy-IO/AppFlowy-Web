/**
 * Single Select Column Tests
 *
 * Tests basic SingleSelect cell interactions.
 * Migrated from: cypress/e2e/database/single-select-column.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseGridSelectors,
  SingleSelectSelectors,
  FieldType,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, waitForGridReady, addPropertyColumn } from '../../support/database-ui-helpers';

test.describe('Single Select Column Type', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should create SingleSelect column and add options', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);

    // When: adding a new SingleSelect column
    await addPropertyColumn(page, FieldType.SingleSelect);

    // Then: select option cells should be available for interaction
    const selectCellCount = await SingleSelectSelectors.allSelectOptionCells(page).count();
    expect(selectCellCount).toBeGreaterThan(0);

    // When: scrolling the new column into view and clicking the first cell
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="select-option-cell-"]');
      if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="select-option-cell-"]');
      if (el) (el as HTMLElement).click();
    });
    await page.waitForTimeout(500);

    // And: typing "Option A" and pressing Enter
    await page.keyboard.type('Option A');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // When: adding Option B to the second cell if it exists
    if (selectCellCount > 1) {
      await page.evaluate(() => {
        const els = document.querySelectorAll('[data-testid^="select-option-cell-"]');
        if (els[1]) (els[1] as HTMLElement).click();
      });
      await page.waitForTimeout(500);
      await page.keyboard.type('Option B');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    }

    // Then: clicking a select cell should open the option dropdown
    const selectCellCountAfter = await SingleSelectSelectors.allSelectOptionCells(page).count();
    expect(selectCellCountAfter).toBeGreaterThan(0);

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="select-option-cell-"]');
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        (el as HTMLElement).click();
      }
    });
    await page.waitForTimeout(500);

    await expect(SingleSelectSelectors.selectOptionMenu(page)).toBeVisible({ timeout: 5000 });
  });
});
