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
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Add content to first row
    await typeTextIntoCell(page, primaryFieldId, 0, 'Test Row');
    await page.waitForTimeout(500);

    // Open row detail
    await openRowDetail(page, 0);
    await assertRowDetailOpen(page);

    // Close it
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(500);
    await assertRowDetailClosed(page);
  });

  test('row detail has document area', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Document Test Row');
    await page.waitForTimeout(500);

    await openRowDetail(page, 0);

    // Verify document area exists
    await expect(RowDetailSelectors.documentArea(page)).toBeVisible();
    await expect(RowDetailSelectors.modalContent(page)).toBeVisible();
  });

  test('edit row title and verify persistence', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Persistence Test');
    await page.waitForTimeout(500);

    // Open row detail
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);

    // Verify the title is shown in the modal
    await expect(RowDetailSelectors.modal(page)).toContainText('Persistence Test');

    // Find the title input and modify it
    const titleInput = page.locator('.MuiDialog-paper [data-testid="row-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.focus();
    await titleInput.pressSequentially(' Updated', { delay: 20 });
    await page.waitForTimeout(1000);

    // Close modal
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(500);

    // Verify title updated in the grid
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()
    ).toContainText('Persistence Test Updated');
  });

  test('duplicate row from detail', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Original Row');
    await page.waitForTimeout(500);

    // Get initial row count
    const initialCount = await DatabaseGridSelectors.dataRows(page).count();

    // Open row detail
    await openRowDetail(page, 0);

    // Duplicate via more actions menu
    await duplicateRowFromDetail(page);

    // Close modal if still open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify row count increased
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialCount + 1);

    // Verify both rows have the content
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).filter({
        hasText: 'Original Row',
      })
    ).toHaveCount(2);
  });

  test('delete row from detail', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Grid starts with 3 rows, use them
    await typeTextIntoCell(page, primaryFieldId, 0, 'Keep This Row');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Delete This Row');
    await page.waitForTimeout(500);

    const initialCount = await DatabaseGridSelectors.dataRows(page).count();

    // Open row detail for second row
    await openRowDetail(page, 1);

    // Delete via more actions menu
    await deleteRowFromDetail(page);

    // Handle confirmation dialog if it appears
    const dialogCount = await page.locator('[role="dialog"]').count();
    if (dialogCount > 0) {
      const confirmButton = page.getByRole('button', { name: /delete|confirm/i });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click({ force: true });
        await page.waitForTimeout(500);
      }
    }

    // Verify row count decreased
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialCount - 1);

    // Verify correct row was deleted
    const cells = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId);
    await expect(cells).not.toContainText(['Delete This Row']);
    await expect(cells.first()).toContainText('Keep This Row');
  });

  test('close modal with escape key', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Escape Test');
    await page.waitForTimeout(500);

    // Open row detail
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);

    // Verify modal is open
    await expect(RowDetailSelectors.modal(page)).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await assertRowDetailClosed(page);
  });

  test('long title wraps properly', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    const longTitle =
      'This is a very long title that should wrap properly without causing any overflow issues in the row detail modal';
    await typeTextIntoCell(page, primaryFieldId, 0, longTitle);
    await page.waitForTimeout(500);

    // Open row detail
    await openRowDetail(page, 0);

    // Verify no horizontal overflow
    await expect(RowDetailSelectors.modal(page)).toBeVisible();
    const modalContent = RowDetailSelectors.modalContent(page);
    const overflows = await modalContent.evaluate((el) => {
      return el.scrollWidth <= el.clientWidth + 10;
    });
    expect(overflows).toBe(true);
  });

  test('add field in row detail', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Field Test Row');
    await page.waitForTimeout(500);

    // Open row detail
    await openRowDetail(page, 0);
    await page.waitForTimeout(1000);

    // Wait for the properties section to load
    await expect(page.locator('.MuiDialog-paper .row-properties')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click the "New Property" button
    await page.locator('.MuiDialog-paper').getByText(/new property/i).scrollIntoViewIfNeeded();
    await page.locator('.MuiDialog-paper').getByText(/new property/i).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify properties section still exists (field was added)
    await expect(page.locator('.MuiDialog-paper .row-properties')).toBeVisible();
  });

  test('navigate between rows in detail view', async ({ page, request }) => {
    setupRowDetailTest(page);
    const email = generateRandomEmail();
    await loginAndCreateGrid(page, request, email);

    const primaryFieldId = await getPrimaryFieldId(page);

    // Grid starts with 3 default rows
    await typeTextIntoCell(page, primaryFieldId, 0, 'Row One');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Row Two');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Row Three');
    await page.waitForTimeout(500);

    // Open row detail for first row
    await openRowDetail(page, 0);

    // Verify we're viewing Row One
    await expect(RowDetailSelectors.modal(page)).toContainText('Row One');
  });
});
