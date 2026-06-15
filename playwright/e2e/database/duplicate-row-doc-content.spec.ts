import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  openRowDetail,
  duplicateRowFromDetail,
  getVisibleDataRowIds,
  openRowDetailByRowId,
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

    // Open first row in full page mode to type content.
    // Full-page editors have a more stable Yjs connection than the dialog's
    // lazy sub-document, so content persists more reliably.
    await openRowDetail(page, 0);
    const dialogTitle = page.locator('.MuiDialogTitle-root');
    await dialogTitle.locator('button').first().click({ force: true }); // expand to full page
    await page.waitForTimeout(3000);

    // Type content into the full-page editor
    const editor = page.locator('[id^="editor-"]').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click({ force: true });
    await page.waitForTimeout(300);
    await page.keyboard.type(rowDocText, { delay: 30 });
    // Wait for: (1) Yjs update → outbox enqueue → drain to server,
    // (2) ensureRowDocumentExists (createOrphaned API) which fires on first edit
    //     and must complete so the server-side collab exists before duplicate.
    await page.waitForTimeout(8000);

    // Verify text appeared
    await expect(editor).toContainText(rowDocText, { timeout: 10000 });

    // Navigate back to the grid
    await page.goBack();
    await waitForGridReady(page);
    await page.waitForTimeout(3000);

    // Duplicate the row from row detail
    const rowIdsBeforeDuplicate = await getVisibleDataRowIds(page);

    await openRowDetail(page, 0);
    await duplicateRowFromDetail(page);
    // duplicateRowFromDetail auto-closes the dialog; ensure it's closed
    await expect(page.locator('.MuiDialog-paper')).toHaveCount(0, { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Verify 4 rows (3 default + 1 duplicate)
    const rowCount = await DatabaseGridSelectors.dataRows(page).count();
    expect(rowCount).toBe(rowIdsBeforeDuplicate.length + 1);

    const rowIdsAfterDuplicate = await getVisibleDataRowIds(page);
    const duplicatedRowId = rowIdsAfterDuplicate.find((rowId) => !rowIdsBeforeDuplicate.includes(rowId));
    expect(duplicatedRowId).toBeTruthy();

    // Open the duplicated row in full-page mode so the Yjs
    // provider creates a fresh connection on each attempt.  The dialog's
    // lazy sub-document loading can miss updates; full-page mode is reliable.
    await openRowDetailByRowId(page, duplicatedRowId!);
    const dialogTitle2 = page.locator('.MuiDialogTitle-root');
    await dialogTitle2.locator('button').first().click({ force: true });
    await page.waitForTimeout(2000);

    // Poll for the duplicated document content.  Reload the full-page view
    // each iteration — this is faster than navigating back to the grid and
    // re-entering the row, and forces a fresh Yjs sync from the server.
    let found = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const dupEditor = page.locator('[id^="editor-"]').first();
      if (await dupEditor.isVisible().catch(() => false)) {
        const text = await dupEditor.innerText().catch(() => '');
        if (text.includes(rowDocText)) {
          found = true;
          break;
        }
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    expect(found).toBe(true);
  });
});
