import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  openRowDetail,
  closeRowDetailWithEscape,
  duplicateRowFromDetail,
  getVisibleDataRowIds,
  openRowDetailByRowId,
} from '../../support/row-detail-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import {
  DatabaseGridSelectors,
} from '../../support/selectors';

/**
 * Count data rows in the main grid.
 */
async function getGridRowCount(page: import('@playwright/test').Page): Promise<number> {
  return DatabaseGridSelectors.dataRows(page).count();
}

test.describe('Duplicate row with inline database', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicated row preserves text content and inline grid block', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await page.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });

    // Sign up and create a grid database
    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createDatabaseView(page, 'Grid', 6000);
    await waitForGridReady(page);

    // Open first row and expand to full page mode
    await openRowDetail(page, 0);
    const dialogTitle = page.locator('.MuiDialogTitle-root');
    await dialogTitle.locator('button').first().click({ force: true });
    await page.waitForTimeout(2000);

    // Now we're on a full page — find the visible editor
    const editor = page.locator('[id^="editor-"]').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    const editorId = await editor.getAttribute('id');
    const viewId = editorId?.replace('editor-', '') || '';

    // Type content in the document
    await editor.click({ force: true });
    await page.waitForTimeout(300);
    await page.keyboard.type('source row content', { delay: 30 });
    await page.waitForTimeout(500);

    // Insert inline grid via slash menu
    const { insertInlineGridViaSlash, databaseBlocks } = await import(
      '../../support/duplicate-test-helpers'
    );
    await insertInlineGridViaSlash(page, viewId);

    // Verify inline grid appeared in the source document
    const gridBlock = databaseBlocks(editor).first();
    await expect(gridBlock).toBeVisible({ timeout: 15000 });

    // Navigate back to the grid view
    await page.goBack();
    await waitForGridReady(page);
    await page.waitForTimeout(1000);

    // Duplicate the row from row detail
    const rowIdsBeforeDuplicate = await getVisibleDataRowIds(page);

    await openRowDetail(page, 0);
    await duplicateRowFromDetail(page);
    await closeRowDetailWithEscape(page);

    // Navigate back to grid if needed
    const gridVisible = await DatabaseGridSelectors.grid(page).isVisible().catch(() => false);
    if (!gridVisible) {
      const dbLink = page.locator('[data-testid="page-name"]').filter({ hasText: 'New Database' }).first();
      await dbLink.click();
      await waitForGridReady(page);
    }

    await page.waitForTimeout(2000);

    // Verify the grid now has 4 rows (3 default + 1 duplicate)
    expect(await getGridRowCount(page)).toBe(rowIdsBeforeDuplicate.length + 1);

    const rowIdsAfterDuplicate = await getVisibleDataRowIds(page);
    const duplicatedRowId = rowIdsAfterDuplicate.find((rowId) => !rowIdsBeforeDuplicate.includes(rowId));
    expect(duplicatedRowId).toBeTruthy();

    // Open the duplicated row in full page mode to verify
    await openRowDetailByRowId(page, duplicatedRowId!);
    const dialogTitle2 = page.locator('.MuiDialogTitle-root');
    await dialogTitle2.locator('button').first().click({ force: true });
    await page.waitForTimeout(2000);

    // Wait for the server worker to duplicate the document and sync back.
    let foundContent = false;
    const dupEditor = page.locator('[id^="editor-"]').first();
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await dupEditor.isVisible().catch(() => false)) {
        const text = await dupEditor.innerText().catch(() => '');
        if (text.includes('source row content')) {
          foundContent = true;
          break;
        }
      }
      // Go back, wait, and re-open to pick up the synced document
      await page.goBack();
      await page.waitForTimeout(3000);
      await waitForGridReady(page);
      await openRowDetailByRowId(page, duplicatedRowId!);
      const dt = page.locator('.MuiDialogTitle-root');
      await dt.locator('button').first().click({ force: true });
      await page.waitForTimeout(2000);
    }
    expect(foundContent).toBe(true);

    // Verify the inline grid block also appears in the duplicated document
    const { databaseBlocks: dbBlocks, editFirstGridCell: editCell, firstGridCellText: cellText } =
      await import('../../support/duplicate-test-helpers');
    const dupGridBlock = dbBlocks(dupEditor).first();
    await expect(dupGridBlock).toBeVisible({ timeout: 30000 });

    // Edit the duplicated row's inline grid cell
    await editCell(page, dupGridBlock, 'modified in duplicate');
    await page.waitForTimeout(1000);

    // Verify the edit took effect
    expect(await cellText(dupGridBlock)).toBe('modified in duplicate');

    // Navigate back to the grid
    await page.goBack();
    await waitForGridReady(page);
    await page.waitForTimeout(1000);

    // Open the original row (index 0) in full page mode
    await openRowDetail(page, 0);
    const dialogTitle3 = page.locator('.MuiDialogTitle-root');
    await dialogTitle3.locator('button').first().click({ force: true });
    await page.waitForTimeout(2000);

    const origEditor = page.locator('[id^="editor-"]').first();
    await expect(origEditor).toBeVisible({ timeout: 15000 });

    // Verify the original row's inline grid is unchanged
    const origGridBlock = dbBlocks(origEditor).first();
    await expect(origGridBlock).toBeVisible({ timeout: 15000 });
    expect(await cellText(origGridBlock)).not.toBe('modified in duplicate');
  });
});
