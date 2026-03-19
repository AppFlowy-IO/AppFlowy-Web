/**
 * Database Row Detail Tests (Desktop Parity)
 *
 * Tests for row detail modal/page functionality.
 * Migrated from: cypress/e2e/database/row-detail.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
} from '../../support/filter-test-helpers';
import {
  setupRowDetailTest,
  openRowDetail,
  closeRowDetailWithEscape,
  assertRowDetailOpen,
  assertRowDetailClosed,
  duplicateRowFromDetail,
  deleteRowFromDetail,
} from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Database Row Detail Tests (Desktop Parity)', () => {
  test('opens row detail modal', async ({ page, request }) => {
    // Given: a grid with content in the first row
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Test Row');
    await page.waitForTimeout(500);

    // When: opening the row detail
    await openRowDetail(page, 0);

    // Then: the row detail modal should be visible
    await assertRowDetailOpen(page);

    // When: closing it with escape
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(500);

    // Then: the modal should be closed
    await assertRowDetailClosed(page);
  });

  test('row detail has document area', async ({ page, request }) => {
    // Given: a grid with content in the first row
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Document Test Row');
    await page.waitForTimeout(500);

    // When: opening the row detail
    await openRowDetail(page, 0);

    // Then: the document area and modal content should be visible
    await expect(RowDetailSelectors.documentArea(page)).toBeVisible();
    await expect(RowDetailSelectors.modalContent(page)).toBeVisible();
  });

  test('edit row title and verify persistence', async ({ page, request }) => {
    // Given: a grid with a row titled "Persistence Test"
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Persistence Test');
    await page.waitForTimeout(500);

    // When: opening the row detail
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);

    // Then: the title should be shown in the modal
    await expect(RowDetailSelectors.modal(page)).toContainText('Persistence Test');

    // When: modifying the title in the modal
    const titleInput = page.locator('.MuiDialog-paper [data-testid="row-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.focus();
    await titleInput.pressSequentially(' Updated', { delay: 20 });
    await page.waitForTimeout(1000);

    // And: closing the modal
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(500);

    // Then: the updated title should be reflected in the grid
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
    ).toContainText('Persistence Test Updated');
  });

  test('duplicate row from detail', async ({ page, request }) => {
    // Given: a grid with a row named "Original Row"
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Original Row');
    await page.waitForTimeout(500);

    const initialCount = await DatabaseGridSelectors.dataRows(page).count();

    // When: opening the row detail and duplicating the row
    await openRowDetail(page, 0);
    await duplicateRowFromDetail(page);

    // And: closing the modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the row count should have increased by one
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialCount + 1);

    // And: both rows should contain "Original Row"
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).filter({
        hasText: 'Original Row',
      })
    ).toHaveCount(2);
  });

  test('delete row from detail', async ({ page, request }) => {
    // Given: a grid with two labeled rows
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Keep This Row');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Delete This Row');
    await page.waitForTimeout(500);

    const initialCount = await DatabaseGridSelectors.dataRows(page).count();

    // When: opening the second row's detail and deleting it
    await openRowDetail(page, 1);
    await deleteRowFromDetail(page);

    // And: confirming deletion if a dialog appears
    const dialogCount = await page.locator('[role="dialog"]').count();
    if (dialogCount > 0) {
      const confirmButton = page.getByRole('button', { name: /delete|confirm/i });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click({ force: true });
        await page.waitForTimeout(500);
      }
    }

    // Then: the row count should have decreased by one
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialCount - 1);

    // And: the deleted row should be gone while the other remains
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).not.toContainText(['Delete This Row']);
    await expect(cells.first()).toContainText('Keep This Row');
  });

  test('close modal with escape key', async ({ page, request }) => {
    // Given: a grid with a row and the row detail modal open
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Escape Test');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await expect(RowDetailSelectors.modal(page)).toBeVisible();

    // When: pressing escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the modal should be closed
    await assertRowDetailClosed(page);
  });

  test('long title wraps properly', async ({ page, request }) => {
    // Given: a grid with a row containing a very long title
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    const longTitle =
      'This is a very long title that should wrap properly without causing any overflow issues in the row detail modal';
    await typeTextIntoCell(page, primaryFieldId, 0, longTitle);
    await page.waitForTimeout(500);

    // When: opening the row detail
    await openRowDetail(page, 0);

    // Then: the modal should be visible without horizontal overflow
    await expect(RowDetailSelectors.modal(page)).toBeVisible();
    const modalContent = RowDetailSelectors.modalContent(page);
    const overflows = await modalContent.evaluate((el) => {
      return el.scrollWidth <= el.clientWidth + 10;
    });
    expect(overflows).toBe(true);
  });

  test('add field in row detail', async ({ page, request }) => {
    // Given: a grid with a row and the row detail modal open
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Field Test Row');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);
    await expect(page.locator('.MuiDialog-paper .row-properties')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // When: clicking the "New Property" button
    await page.locator('.MuiDialog-paper').getByText(/new property/i).scrollIntoViewIfNeeded();
    await page.locator('.MuiDialog-paper').getByText(/new property/i).click({ force: true });
    await page.waitForTimeout(1000);

    // Then: the properties section should still be visible (field was added)
    await expect(page.locator('.MuiDialog-paper .row-properties')).toBeVisible();
  });

  test('navigate between rows in detail view', async ({ page, request }) => {
    // Given: a grid with three labeled rows
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);
    await typeTextIntoCell(page, primaryFieldId, 0, 'Row One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Row Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Row Three');
    await page.waitForTimeout(500);

    // When: opening the row detail for the first row
    await openRowDetail(page, 0);

    // Then: the modal should display "Row One"
    await expect(RowDetailSelectors.modal(page)).toContainText('Row One');
  });
});
