import { test } from '@playwright/test';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  createChildDocumentUnder,
  createNamedDocumentPage,
  duplicateCurrentPageViaHeader,
  expectDirectChildPageCount,
  expandPageByExactText,
  openCopiedPage,
  openPageByExactText,
  pageNamesByCopyText,
} from '../../support/duplicate-test-helpers';

test.describe('Duplicate Document Subpage Rewrite', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicating a document with child documents preserves the child structure', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const parentName = `ParentDoc-${Date.now()}`;
    const childName = `ChildDoc-${Date.now()}`;

    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createNamedDocumentPage(page, parentName);
    await openPageByExactText(page, parentName);

    await createChildDocumentUnder(page, parentName, childName);
    await openPageByExactText(page, parentName);
    await expandPageByExactText(page, parentName);
    await expectDirectChildPageCount(page, parentName, 1);

    const previousCopyCount = await pageNamesByCopyText(page, parentName).count();
    await duplicateCurrentPageViaHeader(page);
    const copyName = await openCopiedPage(page, parentName, previousCopyCount);
    await expandPageByExactText(page, copyName);
    await expectDirectChildPageCount(page, copyName, 1);
  });
});
