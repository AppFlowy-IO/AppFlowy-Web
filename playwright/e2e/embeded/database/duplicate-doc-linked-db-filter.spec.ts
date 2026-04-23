import { test, expect } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../../support/auth-flow-helpers';
import {
  addNameIsNotEmptyFilterToBlock,
  createNamedDocumentPage,
  createNamedGridPage,
  databaseBlocks,
  duplicateCurrentPageViaHeader,
  editFirstGridCell,
  editorForView,
  expandPageByExactText,
  expectDirectChildPageCount,
  expectNoActiveFilters,
  insertLinkedGridViaSlash,
  openCopiedPage,
  openPageByExactText,
  pageNamesByCopyText,
} from '../../../support/duplicate-test-helpers';
import { currentViewIdFromUrl, ensurePageExpandedByViewId } from '../../../support/page-utils';

test.describe('Duplicate Document Linked Database Filter', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("Filters added on a duplicated document's linked databases do not affect the original", async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const sourceDbName = `DatabaseB-${Date.now()}`;
    const docName = `DocA-${Date.now()}`;

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createNamedGridPage(page, sourceDbName);
    await editFirstGridCell(page, page.getByTestId('database-grid').first(), 'linked row');
    await page.waitForTimeout(500);

    const docViewId = await createNamedDocumentPage(page, docName);
    const editor = editorForView(page, docViewId);
    // The linked database picker lists databases by the container name.
    // `createNamedGridPage` renames the container itself, so search by sourceDbName.
    await insertLinkedGridViaSlash(page, docViewId, sourceDbName, 0);
    // Wait for the first linked grid to fully render and for any background
    // IndexedDB sync activity to settle before opening the slash menu again.
    await page.waitForTimeout(3000);
    await insertLinkedGridViaSlash(page, docViewId, sourceDbName, 1);

    await expect(databaseBlocks(editor)).toHaveCount(2, { timeout: 30000 });
    await expectNoActiveFilters(databaseBlocks(editor).nth(0));

    const previousCopyCount = await pageNamesByCopyText(page, docName).count();
    await duplicateCurrentPageViaHeader(page);
    const copyName = await openCopiedPage(page, docName, previousCopyCount);

    const copiedEditor = editorForView(page, currentViewIdFromUrl(page));
    await expect(copiedEditor).toBeVisible({ timeout: 15000 });
    const copiedBlocks = databaseBlocks(copiedEditor);
    await expect(copiedBlocks).toHaveCount(2, { timeout: 30000 });

    await addNameIsNotEmptyFilterToBlock(page, copiedBlocks.nth(0));
    await expect(copiedBlocks.nth(0).getByTestId('database-filter-condition')).toHaveCount(1);

    // Verify the original document's linked views are unaffected
    await openPageByExactText(page, docName);
    await expectNoActiveFilters(databaseBlocks(editorForView(page, currentViewIdFromUrl(page))).nth(0));
  });
});
