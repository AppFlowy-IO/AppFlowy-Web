import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  openRowDetail,
  closeRowDetailWithEscape,
  typeInRowDocument,
  assertDocumentContains,
} from '../../support/row-detail-helpers';
import {
  duplicatePageByExactText,
  openPageByExactText,
  openCopiedPage,
  pageNamesByCopyText,
  renamePageByExactText,
} from '../../support/duplicate-test-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';

async function expectRowDocumentTextEventually(page: import('@playwright/test').Page, text: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    await openRowDetail(page, 0);

    try {
      await assertDocumentContains(page, text);
      await closeRowDetailWithEscape(page);
      return;
    } catch (error) {
      lastError = error;
      await closeRowDetailWithEscape(page);
      await page.waitForTimeout(2000);
    }
  }

  throw lastError;
}

test.describe('Duplicate Database Row Document', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicating a database preserves row document content in the copy', async ({ page, request }) => {
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

    await openRowDetail(page, 0);
    await typeInRowDocument(page, rowDocText);
    await assertDocumentContains(page, rowDocText);
    await closeRowDetailWithEscape(page);
    await openPageByExactText(page, baseName);
    await waitForGridReady(page);
    await openRowDetail(page, 0);
    await assertDocumentContains(page, rowDocText);
    await closeRowDetailWithEscape(page);
    await openPageByExactText(page, baseName);
    await waitForGridReady(page);

    const beforeCount = await pageNamesByCopyText(page, baseName).count();
    await duplicatePageByExactText(page, baseName);
    await openCopiedPage(page, baseName, beforeCount);
    await waitForGridReady(page);
    await expectRowDocumentTextEventually(page, rowDocText);
  });
});
