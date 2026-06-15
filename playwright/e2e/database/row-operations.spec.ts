/**
 * Database Row Operations Tests
 *
 * Tests for row operations via the grid context menu:
 * - Row insertion (above/below)
 * - Row duplication
 * - Row deletion
 *
 * Migrated from: cypress/e2e/database/row-operations.cy.ts
 */
import { test, expect, Page } from '@playwright/test';
import {
  DatabaseGridSelectors,
  RowControlsSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';

/**
 * Helper: Add content to a cell by index
 */
async function addContentToCell(page: Page, cellIndex: number, content: string) {
  await DatabaseGridSelectors.cells(page).nth(cellIndex).click({ force: true });
  await page.waitForTimeout(500);
  await page.keyboard.type(content);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
}

/**
 * Helper: Open the row context menu for a specific data row.
 *
 * Uses dataRows (excludes grid-row-undefined) to target actual rows.
 * HoverControls use opacity:0 + pointer-events:none when not hovered.
 * We use page.evaluate to dispatch mouseover on the row's parent (which has
 * the onMouseMove handler), then click the accessory button natively.
 */
async function openRowContextMenu(page: Page, rowIndex: number = 0) {
  // Dispatch mouseover on the data row's parent to trigger React's setHoverRowId.
  // The parent div has onMouseMove handler; the data-testid div is a child.
  await page.evaluate((idx) => {
    const rows = document.querySelectorAll('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
    const row = rows[idx];

    if (row && row.parentElement) {
      // Trigger mouseover on the parent container (which has onMouseMove)
      row.parentElement.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      row.parentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
  }, rowIndex);

  await page.waitForTimeout(1000);

  // Click the accessory button via native JS click to bypass pointer-events: none
  await page.evaluate((idx) => {
    const buttons = document.querySelectorAll('[data-testid="row-accessory-button"]');
    if (buttons[idx]) {
      (buttons[idx] as HTMLElement).click();
    }
  }, rowIndex);

  await page.waitForTimeout(1000);

  // Wait for the context menu to appear
  await expect(
    page.locator('[role="menu"], [data-slot="dropdown-menu-content"]').first()
  ).toBeVisible({ timeout: 5000 });
}

test.describe('Database Row Operations', () => {
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

  test.describe('Row Insertion', () => {
    test('should insert rows above and below existing row', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const originalContent = `Original Row ${Date.now()}`;
      const aboveContent = `Above Row ${Date.now()}`;
      const belowContent = `Below Row ${Date.now()}`;

      // Given: a signed-in user with a grid database
      await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
      await waitForGridReady(page);

      // When: adding content to the first cell
      await addContentToCell(page, 0, originalContent);

      // Then: the first cell should contain the original content
      await expect(DatabaseGridSelectors.cells(page).first()).toContainText(originalContent);

      // When: recording the initial data row count
      const initialRowCount = await DatabaseGridSelectors.dataRows(page).count();

      // And: opening the row context menu and inserting a row above
      await openRowContextMenu(page, 0);

      const insertAbove = RowControlsSelectors.rowMenuInsertAbove(page);
      const insertAboveCount = await insertAbove.count();

      if (insertAboveCount > 0) {
        await insertAbove.click({ force: true });
      } else {
        await page.locator('[role="menuitem"]').first().click({ force: true });
      }

      await page.waitForTimeout(2000);

      // Then: the data row count should have increased by 1
      await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialRowCount + 1);

      // When: adding content to the newly inserted row above (now the first row)
      await addContentToCell(page, 0, aboveContent);

      // And: opening the context menu on the original row (now second row) and inserting below
      await openRowContextMenu(page, 1);

      const insertBelow = RowControlsSelectors.rowMenuInsertBelow(page);
      const insertBelowCount = await insertBelow.count();

      if (insertBelowCount > 0) {
        await insertBelow.click({ force: true });
      } else {
        await page.locator('[role="menuitem"]').nth(1).click({ force: true });
      }

      await page.waitForTimeout(2000);

      // Then: the data row count should have increased by 2 total
      await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialRowCount + 2);

      // When: adding content to the newly inserted row below (third data row)
      const thirdRow = DatabaseGridSelectors.dataRows(page).nth(2);
      await thirdRow.locator('[data-testid^="grid-cell-"]').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(belowContent);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Then: all three content strings should be present in the grid
      const gridText = await DatabaseGridSelectors.grid(page).innerText();
      expect(gridText).toContain(aboveContent);
      expect(gridText).toContain(originalContent);
      expect(gridText).toContain(belowContent);
    });
  });

  test.describe('Row Duplication', () => {
    test('should duplicate a row with its content', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testContent = `Test Content ${Date.now()}`;

      // Given: a signed-in user with a grid database
      await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
      await waitForGridReady(page);

      // When: adding content to the first cell
      await addContentToCell(page, 0, testContent);

      // Then: the first cell should contain the test content
      await expect(DatabaseGridSelectors.cells(page).first()).toContainText(testContent);

      // When: opening the row context menu and clicking Duplicate
      await openRowContextMenu(page, 0);

      const duplicateButton = page.locator('[role="menuitem"]').filter({ hasText: /duplicate/i });
      const duplicateCount = await duplicateButton.count();

      if (duplicateCount > 0) {
        await duplicateButton.first().click({ force: true });
      } else {
        const rowMenuDuplicate = RowControlsSelectors.rowMenuDuplicate(page);
        const menuDupCount = await rowMenuDuplicate.count();

        if (menuDupCount > 0) {
          await rowMenuDuplicate.click({ force: true });
        } else {
          await page.locator('[role="menuitem"]').nth(2).click({ force: true });
        }
      }

      await page.waitForTimeout(2000);

      // Then: there should be at least 2 data rows
      const rowCount = await DatabaseGridSelectors.dataRows(page).count();
      expect(rowCount).toBeGreaterThanOrEqual(2);

      // And: the test content should appear in at least 2 cells (original + duplicate)
      const allCells = DatabaseGridSelectors.cells(page);
      const cellCount = await allCells.count();
      let contentCount = 0;

      for (let i = 0; i < cellCount; i++) {
        const text = await allCells.nth(i).innerText();
        if (text.includes(testContent)) {
          contentCount++;
        }
      }

      expect(contentCount).toBeGreaterThanOrEqual(2);
    });

    test('should duplicate a row independently (modifying duplicate does not affect original)', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const originalContent = `Original ${Date.now()}`;
      const modifiedContent = `Modified ${Date.now()}`;

      // Given: a signed-in user with a grid database
      await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
      await waitForGridReady(page);

      // When: adding content to the first row's first cell
      await addContentToCell(page, 0, originalContent);

      // Then: the first cell should contain the original content
      await expect(DatabaseGridSelectors.cells(page).first()).toContainText(originalContent);

      // When: counting columns per row for cell offset calculation
      const firstRow = DatabaseGridSelectors.dataRows(page).first();
      const firstRowTestId = await firstRow.getAttribute('data-testid');
      const firstRowId = firstRowTestId?.replace('grid-row-', '') || '';

      let columnsPerRow = 0;
      const allCells = DatabaseGridSelectors.cells(page);
      const totalCells = await allCells.count();

      for (let i = 0; i < totalCells; i++) {
        const cellTestId = await allCells.nth(i).getAttribute('data-testid');
        if (cellTestId?.includes(firstRowId)) {
          columnsPerRow++;
        }
      }

      if (columnsPerRow === 0) columnsPerRow = 3; // fallback

      // And: duplicating the row via context menu
      await openRowContextMenu(page, 0);

      const duplicateButton = page.locator('[role="menuitem"]').filter({ hasText: /duplicate/i });
      const duplicateCount = await duplicateButton.count();

      if (duplicateCount > 0) {
        await duplicateButton.first().click({ force: true });
      } else {
        const rowMenuDuplicate = RowControlsSelectors.rowMenuDuplicate(page);
        const menuDupCount = await rowMenuDuplicate.count();

        if (menuDupCount > 0) {
          await rowMenuDuplicate.click({ force: true });
        } else {
          await page.locator('[role="menuitem"]').nth(2).click({ force: true });
        }
      }

      await page.waitForTimeout(2000);

      // Then: there should be at least 2 data rows
      const rowCount = await DatabaseGridSelectors.dataRows(page).count();
      expect(rowCount).toBeGreaterThanOrEqual(2);

      // When: modifying the duplicate row's first cell (second row's first cell = index columnsPerRow)
      await DatabaseGridSelectors.cells(page).nth(columnsPerRow).click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(modifiedContent);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Then: the original row's first cell should still contain the original content
      await expect(DatabaseGridSelectors.cells(page).first()).toContainText(originalContent);

      // And: the duplicate row's first cell should contain the modified content
      await expect(DatabaseGridSelectors.cells(page).nth(columnsPerRow)).toContainText(modifiedContent);

      // And: the original row should NOT contain the modified content
      const originalText = await DatabaseGridSelectors.cells(page).first().innerText();
      expect(originalText).not.toContain(modifiedContent);
    });
  });

  test.describe('Row Deletion', () => {
    test('should delete a row from the grid', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testContent = `Test Row ${Date.now()}`;

      // Given: a signed-in user with a grid database
      await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
      await waitForGridReady(page);

      // When: adding content to the first cell
      await addContentToCell(page, 0, testContent);

      // Then: the first cell should contain the test content
      await expect(DatabaseGridSelectors.cells(page).first()).toContainText(testContent);

      // When: recording the initial data row count
      const initialRowCount = await DatabaseGridSelectors.dataRows(page).count();

      // And: opening the row context menu and clicking Delete
      await openRowContextMenu(page, 0);

      const deleteButton = RowControlsSelectors.rowMenuDelete(page);
      const deleteCount = await deleteButton.count();

      if (deleteCount > 0) {
        await deleteButton.click({ force: true });
      } else {
        await page.locator('[role="menuitem"]').filter({ hasText: /delete/i }).click({ force: true });
      }

      await page.waitForTimeout(1000);

      // And: handling the confirmation dialog
      const confirmButton = RowControlsSelectors.deleteRowConfirmButton(page);
      const confirmCount = await confirmButton.count();

      if (confirmCount > 0) {
        await confirmButton.click({ force: true });
      } else {
        const deleteConfirm = page.getByRole('button', { name: /delete/i });
        const deleteConfirmCount = await deleteConfirm.count();

        if (deleteConfirmCount > 0) {
          await deleteConfirm.first().click({ force: true });
        }
      }

      await page.waitForTimeout(2000);

      // Then: the data row count should have decreased by 1
      const finalRowCount = await DatabaseGridSelectors.dataRows(page).count();
      expect(finalRowCount).toBe(initialRowCount - 1);

      // And: the test content should no longer be in the grid
      const gridText = await DatabaseGridSelectors.grid(page).innerText();
      expect(gridText).not.toContain(testContent);
    });
  });
});
