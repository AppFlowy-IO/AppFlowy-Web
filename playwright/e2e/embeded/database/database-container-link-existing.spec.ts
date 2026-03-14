/**
 * Database Container - Link Existing Database in Document Tests
 *
 * Tests linking existing database in a document page.
 * Migrated from: cypress/e2e/embeded/database/database-container-link-existing.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  ModalSelectors,
  PageSelectors,
  ViewActionSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import {
  expandSpaceByName,
  ensurePageExpandedByViewId,
  createDocumentPageAndNavigate,
  insertLinkedDatabaseViaSlash,
} from '../../../support/page-utils';

test.describe('Database Container - Link Existing Database in Document', () => {
  const dbName = 'New Database';
  const spaceName = 'General';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('creates a linked view under the document (no new container)', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const sourceName = `SourceDB_${Date.now()}`;

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1) Create a standalone database (container exists in the sidebar)
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Rename container to a unique name
    await expandSpaceByName(page, spaceName);
    await expect(PageSelectors.itemByName(page, dbName)).toBeVisible();

    // Right-click to rename
    const moreButton = PageSelectors.moreActionsButton(page, dbName);
    await moreButton.click({ force: true });
    await ViewActionSelectors.renameButton(page).click({ force: true });
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill(sourceName);
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(3000);

    // 2) Create a document page
    const docViewId = await createDocumentPageAndNavigate(page);

    // 3) Insert linked grid via slash menu (should NOT create a new container)
    await insertLinkedDatabaseViaSlash(page, docViewId, sourceName);
    await page.waitForTimeout(1000);

    // 4) Verify sidebar: document has a "View of <db>" child, and no container child
    await expandSpaceByName(page, spaceName);
    const referencedName = `View of ${sourceName}`;

    await ensurePageExpandedByViewId(page, docViewId);

    const docPageItem = page
      .locator(`[data-testid="page-item"]:has(> [data-testid="page-${docViewId}"])`)
      .first();

    // Get all child page names under the document
    const childNames = await docPageItem.getByTestId('page-name').allInnerTexts();
    const trimmedNames = childNames.map((n) => n.trim());

    expect(trimmedNames).toContain(referencedName);
    expect(trimmedNames).not.toContain(sourceName);
  });
});
