import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  openRowDetail,
  closeRowDetailWithEscape,
  typeInRowDocument,
  duplicateRowFromDetail,
} from '../../support/row-detail-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';

test.describe('Duplicate row preserves document content', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicated row has the same document content as the source', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const rowDocText = `test-content-${Date.now()}`;

    await page.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });

    // Sign up and create a grid
    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createDatabaseView(page, 'Grid', 6000);
    await waitForGridReady(page);

    // Open first row, type content in the document
    await openRowDetail(page, 0);
    await typeInRowDocument(page, rowDocText);
    await page.waitForTimeout(1000);

    // Verify text is visible in the modal
    await expect(page.getByText(rowDocText)).toBeVisible({ timeout: 10000 });

    // Close the modal — try Escape first, then close button
    await closeRowDetailWithEscape(page);

    // If we ended up on a full-page row view instead of the grid,
    // navigate back via the sidebar
    const gridVisible = await DatabaseGridSelectors.grid(page).isVisible().catch(() => false);
    if (!gridVisible) {
      // Click the database name in the sidebar to go back to grid view
      const dbLink = page.locator('[data-testid="page-name"]').filter({ hasText: 'New Database' }).first();
      await dbLink.click();
      await waitForGridReady(page);
    }

    // Wait for content to sync to server
    await page.waitForTimeout(5000);

    // Re-open and duplicate the row
    await openRowDetail(page, 0);
    await duplicateRowFromDetail(page);
    await closeRowDetailWithEscape(page);

    // Navigate back to grid if needed
    const gridVisible2 = await DatabaseGridSelectors.grid(page).isVisible().catch(() => false);
    if (!gridVisible2) {
      const dbLink = page.locator('[data-testid="page-name"]').filter({ hasText: 'New Database' }).first();
      await dbLink.click();
      await waitForGridReady(page);
    }

    await page.waitForTimeout(3000);

    // Verify 4 rows (3 default + 1 duplicate)
    const rowCount = await DatabaseGridSelectors.dataRows(page).count();
    expect(rowCount).toBe(4);

    // Open the duplicated row (index 1, inserted after source)
    // Retry because the server worker creates the document asynchronously
    let found = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await openRowDetail(page, 1);
      await page.waitForTimeout(2000);

      const hasText = await page.getByText(rowDocText).isVisible().catch(() => false);
      if (hasText) {
        found = true;
        await closeRowDetailWithEscape(page);
        break;
      }

      await closeRowDetailWithEscape(page);

      // Navigate back to grid if needed
      const gv = await DatabaseGridSelectors.grid(page).isVisible().catch(() => false);
      if (!gv) {
        const dbLink = page.locator('[data-testid="page-name"]').filter({ hasText: 'New Database' }).first();
        await dbLink.click();
        await waitForGridReady(page);
      }

      await page.waitForTimeout(3000);
    }

    expect(found).toBe(true);
  });
});
