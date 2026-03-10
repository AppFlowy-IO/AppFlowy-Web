/**
 * Move Page Restrictions Tests
 * Migrated from: cypress/e2e/page/move-page-restrictions.cy.ts
 *
 * These tests verify that the "Move to" action is disabled for views that should
 * not be movable:
 * - Case 3: Linked database views under documents
 * - Regular document pages should allow Move to
 * - Database containers under documents should allow Move to
 *
 * Mirrors Desktop/Flutter implementation in view_ext.dart canBeDragged().
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  PageSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  ViewActionSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  expandSpaceByName,
  ensurePageExpandedByViewId,
  createDocumentPageAndNavigate,
  insertLinkedDatabaseViaSlash,
} from '../../support/page-utils';
import { getSlashMenuItemName } from '../../support/i18n-constants';

test.describe('Move Page Restrictions', () => {
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

  test('should disable Move to for linked database view under document (Case 3)', async ({
    page,
    request,
  }) => {
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
    await expect(PageSelectors.itemByName(page, 'New Database')).toBeVisible({ timeout: 10000 });
    await PageSelectors.moreActionsButton(page, 'New Database').click({ force: true });
    await page.waitForTimeout(500);
    await ViewActionSelectors.renameButton(page).click({ force: true });
    await page.waitForTimeout(500);
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill(sourceName);
    await ModalSelectors.renameSaveButton(page).click({ force: true });
    await page.waitForTimeout(2000);

    // Collapse and re-expand space to refresh
    await SpaceSelectors.itemByName(page, spaceName)
      .locator('[data-testid="space-name"]')
      .click({ force: true });
    await page.waitForTimeout(500);
    await SpaceSelectors.itemByName(page, spaceName)
      .locator('[data-testid="space-name"]')
      .click({ force: true });
    await page.waitForTimeout(1000);

    await expect(PageSelectors.itemByName(page, sourceName)).toBeVisible({ timeout: 10000 });

    // 2) Create a document page
    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);

    // 3) Insert linked grid via slash menu
    await insertLinkedDatabaseViaSlash(page, docViewId, sourceName);
    await page.waitForTimeout(1000);

    // 4) Expand the document to see linked view in sidebar
    await expandSpaceByName(page, spaceName);
    const referencedName = `View of ${sourceName}`;

    await ensurePageExpandedByViewId(page, docViewId);
    await page.waitForTimeout(1000);

    // 5) Open More Actions for the linked database view
    const docItem = page
      .getByTestId(`page-${docViewId}`)
      .first()
      .locator('xpath=ancestor::*[@data-testid="page-item"]')
      .first();

    const linkedViewItem = docItem
      .getByTestId('page-name')
      .filter({ hasText: referencedName })
      .first()
      .locator('xpath=ancestor::*[@data-testid="page-item"]')
      .first();

    await linkedViewItem.hover({ force: true });
    await page.waitForTimeout(500);

    await linkedViewItem.getByTestId('page-more-actions').first().click({ force: true });
    await page.waitForTimeout(500);

    // 6) Verify Move to is disabled
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToItem = ViewActionSelectors.moveToButton(page);
    await expect(moveToItem).toBeVisible();
    await expect(moveToItem).toHaveAttribute('data-disabled', /.*/);
  });

  test('should enable Move to for regular document pages', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Wait for sidebar and find Getting started page
    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(2000);

    // Hover over Getting started page
    await PageSelectors.itemByName(page, 'Getting started').hover({ force: true });
    await page.waitForTimeout(500);

    // Click more actions
    await PageSelectors.moreActionsButton(page, 'Getting started').click({ force: true });
    await page.waitForTimeout(500);

    // Verify Move to is NOT disabled for regular pages
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToItem2 = ViewActionSelectors.moveToButton(page);
    await expect(moveToItem2).toBeVisible();
    const hasDisabled = await moveToItem2.getAttribute('data-disabled');
    expect(hasDisabled).toBeNull();
  });

  test('should enable Move to for database containers under document', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1) Create a document page
    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);

    // 2) Insert NEW grid via slash menu (creates container, not linked view)
    const editor = page.locator(`#editor-${docViewId}`);
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click({ force: true });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid'))
      .first()
      .click({ force: true });
    await page.waitForTimeout(3000);

    // 3) Expand the document to see the database container in sidebar
    await expandSpaceByName(page, spaceName);

    await ensurePageExpandedByViewId(page, docViewId);
    await page.waitForTimeout(1000);

    // 4) Find the database container (child of the document)
    const docItem = page
      .getByTestId(`page-${docViewId}`)
      .first()
      .locator('xpath=ancestor::*[@data-testid="page-item"]')
      .first();

    const dbContainerItem = docItem.getByTestId('page-item').first();
    await dbContainerItem.hover({ force: true });
    await page.waitForTimeout(500);

    await dbContainerItem.getByTestId('page-more-actions').first().click({ force: true });
    await page.waitForTimeout(500);

    // 5) Verify Move to is NOT disabled for database containers
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToItem3 = ViewActionSelectors.moveToButton(page);
    await expect(moveToItem3).toBeVisible();
    const hasDisabled = await moveToItem3.getAttribute('data-disabled');
    expect(hasDisabled).toBeNull();
  });
});
