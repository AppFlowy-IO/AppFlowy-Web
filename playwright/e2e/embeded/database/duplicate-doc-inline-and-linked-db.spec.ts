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

test.describe('Duplicate Document Inline And Linked Database', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Filters on duplicated linked view do not leak when inline DB and linked view share the same database', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const sourceDbName = `InlineDB-${Date.now()}`;
    const docName = `DocWithBoth-${Date.now()}`;

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createNamedGridPage(page, sourceDbName);
    await editFirstGridCell(page, page.getByTestId('database-grid').first(), 'linked row');

    const docViewId = await createNamedDocumentPage(page, docName);
    const editor = editorForView(page, docViewId);
    // The linked database picker lists databases by the container name.
    // `createNamedGridPage` renames the container itself, so search by sourceDbName.
    await insertLinkedGridViaSlash(page, docViewId, sourceDbName, 0);

    await expect(databaseBlocks(editor)).toHaveCount(1, { timeout: 30000 });
    await expectNoActiveFilters(databaseBlocks(editor).nth(0));

    const previousCopyCount = await pageNamesByCopyText(page, docName).count();
    await duplicateCurrentPageViaHeader(page);
    const copyName = await openCopiedPage(page, docName, previousCopyCount);

    const copiedEditor = editorForView(page, currentViewIdFromUrl(page));
    const copiedBlocks = databaseBlocks(copiedEditor);
    await expect(copiedBlocks).toHaveCount(1, { timeout: 30000 });
    await addNameIsNotEmptyFilterToBlock(page, copiedBlocks.nth(0));
    await expect(copiedBlocks.nth(0).getByTestId('database-filter-condition')).toHaveCount(1);

    // Verify the original document's linked view is unaffected by the copy's filter
    await openPageByExactText(page, docName);
    await expectNoActiveFilters(databaseBlocks(editorForView(page, currentViewIdFromUrl(page))).nth(0));
  });
});
