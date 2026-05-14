import { test, expect } from '@playwright/test';
import { setupPageErrorHandling } from '../../../support/test-config';
import { signInWithPasswordViaUi } from '../../../support/auth-flow-helpers';
import {
  databaseBlocks,
  deletePageByExactText,
  duplicateCurrentPageViaHeader,
  editFirstGridCell,
  editorForView,
  expandPageByExactText,
  expectDirectChildPageCount,
  expectNoActiveFilters,
  firstGridCellText,
  openCopiedPage,
  openPageByExactText,
  pageNamesByCopyText,
} from '../../../support/duplicate-test-helpers';
import { currentViewIdFromUrl } from '../../../support/page-utils';

const DUPLICATE_USER_EMAIL = 'duplicate@appflowy.io';
const DUPLICATE_USER_PASSWORD = 'AppFlowy!@123';
const DOCUMENT_NAME = 'Document with linked database';
const INLINE_GRID_TEXT = 'This is inline Grid';

async function expectFirstGridCellToContain(
  gridBlock: ReturnType<typeof databaseBlocks>,
  text: string,
  timeout = 30000
): Promise<void> {
  await expect
    .poll(async () => firstGridCellText(gridBlock), {
      timeout,
      message: `Expected first grid cell to contain "${text}"`,
    })
    .toContain(text);
}

test.describe('Cloud Duplicate Document With Linked And Inline Database', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicating a cloud document with inline DB and linked DB views creates correct structure', async ({ page }) => {
    await signInWithPasswordViaUi(page, DUPLICATE_USER_EMAIL, DUPLICATE_USER_PASSWORD, 5000);

    // Clean up leftover copies from previous runs
    while ((await pageNamesByCopyText(page, DOCUMENT_NAME).count()) > 0) {
      const existingCopies = pageNamesByCopyText(page, DOCUMENT_NAME);
      const copyName = (await existingCopies.last().innerText()).trim();
      await openPageByExactText(page, DOCUMENT_NAME);
      await deletePageByExactText(page, copyName);
    }

    // Also clean up any orphaned "Duplicate Block" entries from previous failed runs
    while (true) {
      const orphans = page.locator('[data-testid="page-name"]:visible').filter({ hasText: /^Duplicate Block/ });
      const orphanCount = await orphans.count();

      if (orphanCount === 0) break;
      const orphanName = (await orphans.first().innerText()).trim();
      await deletePageByExactText(page, orphanName);
      await page.waitForTimeout(1000);
    }

    await openPageByExactText(page, DOCUMENT_NAME);
    await expandPageByExactText(page, DOCUMENT_NAME);
    const originalChildPageCount = await page
      .locator(
        '[data-testid="page-item"]:visible:has(> div:first-child [data-testid="page-name"]:text-is("Document with linked database"))'
      )
      .first()
      .locator(':scope > div:nth-child(2) > [data-testid="page-item"]:visible')
      .count();
    expect(originalChildPageCount).toBeGreaterThanOrEqual(3);

    const editor = editorForView(page, currentViewIdFromUrl(page));
    const originalBlocks = databaseBlocks(editor);
    const originalBlockCount = await originalBlocks.count();
    expect(originalBlockCount).toBeGreaterThanOrEqual(3);

    // Restore the expected cell content in case a previous test run corrupted it
    const currentCellText = await firstGridCellText(originalBlocks.nth(0));

    if (!currentCellText.includes(INLINE_GRID_TEXT)) {
      await editFirstGridCell(page, originalBlocks.nth(0), INLINE_GRID_TEXT);
    }

    await expectFirstGridCellToContain(originalBlocks.nth(0), INLINE_GRID_TEXT);

    const previousCopyCount = await pageNamesByCopyText(page, DOCUMENT_NAME).count();
    await duplicateCurrentPageViaHeader(page);
    const copyName = await openCopiedPage(page, DOCUMENT_NAME, previousCopyCount);
    await expandPageByExactText(page, copyName, true);
    await expectDirectChildPageCount(page, copyName, originalChildPageCount);

    const copiedEditor = editorForView(page, currentViewIdFromUrl(page));
    const copiedBlocks = databaseBlocks(copiedEditor);
    await expect(copiedBlocks).toHaveCount(originalBlockCount, { timeout: 30000 });
    await expectNoActiveFilters(copiedBlocks.nth(0));
    await expectFirstGridCellToContain(copiedBlocks.nth(0), INLINE_GRID_TEXT, 60000);

    await editFirstGridCell(page, copiedBlocks.nth(0), 'edited in copy');
    await openPageByExactText(page, DOCUMENT_NAME);
    await expectFirstGridCellToContain(
      databaseBlocks(editorForView(page, currentViewIdFromUrl(page))).nth(0),
      INLINE_GRID_TEXT
    );

    await openPageByExactText(page, copyName);
    await editFirstGridCell(
      page,
      databaseBlocks(editorForView(page, currentViewIdFromUrl(page))).nth(0),
      INLINE_GRID_TEXT
    );

    await openPageByExactText(page, DOCUMENT_NAME);
    await deletePageByExactText(page, copyName);
  });
});
