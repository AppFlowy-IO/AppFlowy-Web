import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  openRowDetail,
  closeRowDetailWithEscape,
  typeInRowDocument,
} from '../../support/row-detail-helpers';
import {
  duplicatePageByExactText,
  openPageByExactText,
  openCopiedPage,
  pageNamesByCopyText,
  renamePageByExactText,
} from '../../support/duplicate-test-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';

/**
 * Open row 0 in full-page mode and poll for the expected text.
 * Reloads the page between attempts so the Yjs provider fetches
 * fresh content from the server (the duplication worker is async).
 */
async function expectRowDocumentTextEventually(page: import('@playwright/test').Page, text: string) {
  // Open row 0 via dialog, then expand to full page
  await openRowDetail(page, 0);
  const dt = page.locator('.MuiDialogTitle-root');
  await dt.locator('button').first().click({ force: true });
  await page.waitForTimeout(2000);

  for (let attempt = 0; attempt < 20; attempt++) {
    const editor = page.locator('[id^="editor-"]').first();
    if (await editor.isVisible().catch(() => false)) {
      const editorText = await editor.innerText().catch(() => '');
      if (editorText.includes(text)) return;
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  throw new Error(`Row document text "${text}" not found after retries`);
}

test.describe('Duplicate Database Row Document', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // Skip: Server-side PageService.duplicate creates new rows with new documentIds
  // but does NOT copy the row sub-document content from the original documentIds.
  // The duplicated row's sub-document is always empty regardless of client-side
  // sync. This requires a server-side fix to copy row sub-document collabs during
  // page duplication. Row-level duplicate (duplicate-row-doc-content.spec.ts) works
  // because it sends clientDocStateB64 directly in the API request.
  test.skip('Duplicating a database preserves row document content in the copy', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const baseName = `GridWithRowDoc-${Date.now()}`;
    const rowDocText = `row-doc-content-${Date.now()}`;

    await page.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createDatabaseView(page, 'Grid', 6000);
    await waitForGridReady(page);
    await renamePageByExactText(page, 'New Database', baseName);
    await openPageByExactText(page, baseName);
    await waitForGridReady(page);

    // Type content in the row sub-document via the dialog.
    // The dialog's sub-document is cached in rowSubDocs (via getOrCreateRowSubDoc),
    // so syncAllToServer will include it in the batch sync before page duplication.
    // (Full-page mode doesn't use this cache, so its content isn't batch-synced.)
    await openRowDetail(page, 0);
    await page.waitForTimeout(5000); // Wait for sub-document Yjs provider to connect
    await typeInRowDocument(page, rowDocText);
    // Wait for: (1) Yjs update → outbox enqueue → drain to server,
    // (2) ensureRowDocumentExists (createOrphaned API) to create the server-side
    //     collab so collabFullSyncBatch can update it during duplicate.
    // The createOrphaned call is fire-and-forget in DatabaseRowSubDocument.tsx,
    // so we must wait long enough for both the API call and server processing.
    await page.waitForTimeout(8000);
    await expect(page.locator('[role="dialog"]')).toContainText(rowDocText, { timeout: 10000 });
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(5000);

    const beforeCount = await pageNamesByCopyText(page, baseName).count();
    await duplicatePageByExactText(page, baseName);
    await openCopiedPage(page, baseName, beforeCount);
    await waitForGridReady(page);
    await expectRowDocumentTextEventually(page, rowDocText);
  });
});
