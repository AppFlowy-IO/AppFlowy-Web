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
import { testLog } from '../../support/test-helpers';
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

    testLog.testStart('Move to disabled for linked database view under document');
    testLog.info(`Test email: ${testEmail}`);

    // Given: a signed-in user with a standalone database in the sidebar
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1) Create a standalone database (container exists in the sidebar)
    testLog.step(1, 'Create standalone Grid database');
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // And: the database is renamed to a unique name
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
    testLog.step(2, 'Create document page');
    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);

    // 3) Insert linked grid via slash menu
    testLog.step(3, 'Insert linked grid via slash menu');
    await insertLinkedDatabaseViaSlash(page, docViewId, sourceName);
    await page.waitForTimeout(1000);

    // 4) Expand the document to see linked view in sidebar
    testLog.step(4, 'Expand document and find linked view');
    await expandSpaceByName(page, spaceName);
    const referencedName = `View of ${sourceName}`;

    await ensurePageExpandedByViewId(page, docViewId);
    await page.waitForTimeout(1000);

    // Find the document's page-item using CSS :has() (more reliable than xpath=ancestor)
    const docItem = page
      .locator(`[data-testid="page-item"]:has(> [data-testid="page-${docViewId}"])`)
      .first();

    // Find the linked view's page-item by filtering child page-items by name
    const linkedViewItem = docItem
      .locator('[data-testid="page-item"]')
      .filter({ has: page.locator('[data-testid="page-name"]', { hasText: referencedName }) })
      .first();

    // 5) Open More Actions for the linked database view
    testLog.step(5, 'Open More Actions for linked database view');
    await linkedViewItem.hover({ force: true });
    await page.waitForTimeout(500);

    await linkedViewItem.getByTestId('page-more-actions').first().click({ force: true });
    await page.waitForTimeout(500);

    // 6) Verify Move to is disabled
    testLog.step(6, 'Verify Move to is disabled');
    // Then: "Move to" menu item is disabled
    // Radix UI sets data-disabled="" (empty string) when disabled.
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToMenuItem = page.locator('[role="menuitem"]').filter({ hasText: 'Move to' });
    await expect(moveToMenuItem).toBeVisible();
    // Use programmatic getAttribute to avoid regex matching issues with empty string
    await expect(async () => {
      const disabledValue = await moveToMenuItem.getAttribute('data-disabled');
      expect(disabledValue).not.toBeNull();
    }).toPass({ timeout: 15000 });

    testLog.testEnd('Move to disabled for linked database view under document');
  });

  test('should enable Move to for regular document pages', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Move to enabled for regular document pages');
    testLog.info(`Test email: ${testEmail}`);

    // Given: a signed-in user with the General space expanded
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    await expandSpaceByName(page, spaceName);
    await page.waitForTimeout(2000);

    // When: opening more actions for the Getting started page
    await PageSelectors.itemByName(page, 'Getting started').hover({ force: true });
    await page.waitForTimeout(500);

    await PageSelectors.moreActionsButton(page, 'Getting started').click({ force: true });
    await page.waitForTimeout(500);

    // Then: "Move to" menu item is enabled
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToItem2 = page.locator('[role="menuitem"]').filter({ hasText: 'Move to' });
    await expect(moveToItem2).toBeVisible();
    const hasDisabled = await moveToItem2.getAttribute('data-disabled');
    expect(hasDisabled).toBeNull();

    testLog.testEnd('Move to enabled for regular document pages');
  });

  test('should enable Move to for database containers under document', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    testLog.testStart('Move to enabled for database containers');
    testLog.info(`Test email: ${testEmail}`);

    // Given: a signed-in user with a document containing an embedded grid
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // 1) Create a document page first
    testLog.step(1, 'Create document page');
    const docViewId = await createDocumentPageAndNavigate(page);
    await page.waitForTimeout(1000);

    // 2) Insert NEW grid via slash menu (creates container)
    testLog.step(2, 'Insert new grid via slash menu');
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
    // After inserting a grid, the sidebar may take time to create the container child.
    // Retry expansion until children appear (the expand toggle won't exist until children load).
    testLog.step(3, 'Expand document and find database container');
    await expandSpaceByName(page, spaceName);

    const docItem = page
      .locator(`[data-testid="page-item"]:has(> [data-testid="page-${docViewId}"])`)
      .first();
    const childPageItems = docItem.locator('[data-testid="page-item"]');

    for (let attempt = 0; attempt < 20; attempt++) {
      await ensurePageExpandedByViewId(page, docViewId);
      if ((await childPageItems.count()) > 0) break;
      await page.waitForTimeout(1500);
    }

    await expect(childPageItems.first()).toBeVisible({ timeout: 10000 });

    // 4) Find the database container and open More Actions
    testLog.step(4, 'Open More Actions for database container');
    const dbContainerItem = childPageItems.first();
    await dbContainerItem.hover({ force: true });
    await page.waitForTimeout(500);

    await dbContainerItem.getByTestId('page-more-actions').first().click({ force: true });
    await page.waitForTimeout(500);

    // 5) Verify Move to is NOT disabled for database containers
    testLog.step(5, 'Verify Move to is enabled for database container');
    // Then: "Move to" menu item is enabled for database containers
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const moveToItem3 = page.locator('[role="menuitem"]').filter({ hasText: 'Move to' });
    await expect(moveToItem3).toBeVisible();
    const hasDisabled = await moveToItem3.getAttribute('data-disabled');
    expect(hasDisabled).toBeNull();

    testLog.testEnd('Move to enabled for database containers');
  });
});
