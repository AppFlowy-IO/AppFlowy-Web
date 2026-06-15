/**
 * Database Sidebar Deletion Tests
 *
 * Verifies that when an embedded database page is deleted from the left sidebar,
 * the embedded database block in the document reacts correctly:
 * - Shows a "database is in the trash" placeholder instead of a broken grid
 * - Restores correctly when the database is recovered from Trash
 * - Does not false-positive during normal sidebar interactions
 * - Correctly isolates deletion when multiple databases are embedded
 */
import { test, expect, Page } from '@playwright/test';
import {
  PageSelectors,
  SlashCommandSelectors,
  TrashSelectors,
} from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import {
  createDocumentPageAndNavigate,
  expandSpaceByName,
  ensurePageExpandedByViewId,
} from '../../../support/page-utils';
import { deletePageByName } from '../../../support/page/page-actions';
import { expandSpace } from '../../../support/page/flows';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert an embedded grid database via the slash menu.
 * Closes the creation modal and waits for the grid to be visible in the document.
 */
async function insertEmbeddedGrid(page: Page, docViewId: string): Promise<void> {
  const editor = page.locator(`#editor-${docViewId}`);

  await expect(editor).toBeVisible();
  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await editor.pressSequentially('/', { delay: 50 });
  await page.waitForTimeout(500);

  const slashPanel = SlashCommandSelectors.slashPanel(page);

  await expect(slashPanel).toBeVisible();
  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });
  await page.waitForTimeout(3000);

  const modal = page.locator('.MuiDialog-paper');

  if (await modal.isVisible()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    if (await modal.isVisible()) {
      await page.mouse.click(10, 10);
      await page.waitForTimeout(2000);
    }

    await expect(modal).not.toBeVisible({ timeout: 10000 });
  }

  const embeddedDB = page.locator('[class*="appflowy-database"]').last();

  await expect(embeddedDB).toBeVisible({ timeout: 15000 });
  await expect(embeddedDB.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 10000 });
}

/**
 * Insert a second embedded grid by positioning the cursor below the first database
 * and invoking the slash menu again.
 * Returns true if insertion succeeded, false if the editor didn't allow it.
 */
async function insertSecondEmbeddedGrid(page: Page, docViewId: string): Promise<boolean> {
  const editor = page.locator(`#editor-${docViewId}`);
  const editorBox = await editor.boundingBox();

  if (editorBox) {
    await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height - 10);
  }

  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  await page.keyboard.type('/', { delay: 50 });
  await page.waitForTimeout(500);

  const slashPanel = SlashCommandSelectors.slashPanel(page);

  if (!(await slashPanel.isVisible())) return false;

  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click({ force: true });
  await page.waitForTimeout(3000);

  const modal = page.locator('.MuiDialog-paper');

  if (await modal.isVisible()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    if (await modal.isVisible()) {
      await page.mouse.click(10, 10);
      await page.waitForTimeout(2000);
    }
  }

  const gridCount = await page.locator('[class*="appflowy-database"]').count();

  return gridCount >= 2;
}

/** Assert that an embedded database block at the given index shows any deletion placeholder. */
async function expectDatabasePlaceholder(page: Page, index = 0): Promise<void> {
  const container = page.locator('.container-bg').nth(index);

  await expect(container).toBeVisible({ timeout: 10000 });
  await expect(container).toContainText(/in Trash|permanently deleted|Something went wrong/i, { timeout: 15000 });
}

/** Assert that an embedded database block shows the "in Trash" message. */
async function expectDatabaseInTrash(page: Page, index = 0): Promise<void> {
  const container = page.locator('.container-bg').nth(index);

  await expect(container).toBeVisible({ timeout: 10000 });
  await expect(container).toContainText(/in Trash/i, { timeout: 15000 });
}

/** Assert that an embedded database block shows the "permanently deleted" message. */
async function expectDatabaseDeleted(page: Page, index = 0): Promise<void> {
  const container = page.locator('.container-bg').nth(index);

  await expect(container).toBeVisible({ timeout: 10000 });
  await expect(container).toContainText(/permanently deleted/i, { timeout: 15000 });
}

/** Assert that an embedded database block at the given index shows a working grid. */
async function expectDatabaseGrid(page: Page, index = 0): Promise<void> {
  const embeddedDB = page.locator('[class*="appflowy-database"]').nth(index);

  await expect(embeddedDB).toBeVisible({ timeout: 15000 });
  await expect(embeddedDB.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 10000 });
}

/** Sign in and create a document with one embedded grid. Returns the docViewId. */
async function givenDocumentWithEmbeddedGrid(page: Page, request: import('@playwright/test').APIRequestContext): Promise<string> {
  const testEmail = generateRandomEmail();

  await signInAndWaitForApp(page, request, testEmail);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const docViewId = await createDocumentPageAndNavigate(page);

  await insertEmbeddedGrid(page, docViewId);
  return docViewId;
}

/** Expand the sidebar and the document page so database children are visible. */
async function givenSidebarExpanded(page: Page, docViewId: string): Promise<void> {
  await expandSpaceByName(page, 'General');
  await page.waitForTimeout(1000);
  await ensurePageExpandedByViewId(page, docViewId);
  await page.waitForTimeout(1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Embedded Database Sidebar Deletion', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('Scenario 1: should show placeholder when database is deleted from sidebar', async ({
    page,
    request,
  }) => {
    // Given a document page with one embedded Grid database
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);

    // And the sidebar shows the database as a "New Database" child
    await givenSidebarExpanded(page, docViewId);
    await expect(PageSelectors.itemByName(page, 'New Database')).toBeVisible({ timeout: 10000 });

    // When the user deletes "New Database" from the sidebar
    await deletePageByName(page, 'New Database');
    await page.waitForTimeout(6000);

    // Then the embedded Grid is replaced with "This database is in the trash"
    await expectDatabaseInTrash(page);
  });

  test('Scenario 2: should preserve other databases when only one is deleted', async ({
    page,
    request,
  }) => {
    // Given a document page with two embedded Grid databases
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);
    const inserted = await insertSecondEmbeddedGrid(page, docViewId);

    if (!inserted) {
      test.skip(true, 'Could not insert second grid — editor did not create a trailing paragraph');
      return;
    }

    await expectDatabaseGrid(page, 0);
    await expectDatabaseGrid(page, 1);

    // And the sidebar shows both as "New Database" children
    await givenSidebarExpanded(page, docViewId);
    await expect(page.getByTestId('page-name').filter({ hasText: 'New Database' })).toHaveCount(2, { timeout: 5000 });

    // When the user deletes the first "New Database" from the sidebar
    await deletePageByName(page, 'New Database');
    await page.waitForTimeout(6000);

    // Then one embedded Grid shows the trash placeholder
    const containers = page.locator('.container-bg');
    const texts = await containers.allTextContents();
    const placeholderCount = texts.filter((t) => /in Trash|permanently deleted|Something went wrong/i.test(t)).length;
    const gridCount = texts.filter((t) => t.includes('Name') && t.includes('New row')).length;

    expect(placeholderCount).toBeGreaterThanOrEqual(1);

    // And the other embedded Grid continues to render correctly
    expect(gridCount).toBeGreaterThanOrEqual(1);
  });

  test('Scenario 3: should reconnect database after restoring from trash', async ({
    page,
    request,
  }) => {
    // Given a document page with an embedded Grid that has been deleted from the sidebar
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);

    await expectDatabaseGrid(page);
    await givenSidebarExpanded(page, docViewId);

    await deletePageByName(page, 'New Database');
    await page.waitForTimeout(6000);
    await expectDatabasePlaceholder(page);

    const docPageUrl = page.url();

    // When the user navigates to Trash
    await TrashSelectors.sidebarTrashButton(page).click();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/app\/trash/);
    await expect(TrashSelectors.table(page)).toBeVisible();

    // And restores the deleted database
    const rows = TrashSelectors.rows(page);

    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    await rows.first().getByTestId('trash-restore-button').click();
    await page.waitForTimeout(2000);

    // And navigates back to the document page
    await page.goto(docPageUrl);
    await page.waitForTimeout(5000);

    // Then the embedded Grid re-renders with its data
    await expectDatabaseGrid(page);
  });

  test('Scenario 4: should not break embedded databases during normal sidebar interactions', async ({
    page,
    request,
  }) => {
    // Given a document page with one embedded Grid database that is rendering correctly
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);

    await expectDatabaseGrid(page);

    // When the user expands the space and the document page in the sidebar
    await expandSpaceByName(page, 'General');
    await page.waitForTimeout(1000);
    await ensurePageExpandedByViewId(page, docViewId);
    await page.waitForTimeout(2000);

    // Then the embedded Grid remains visible
    await expectDatabaseGrid(page);

    // When the user collapses and re-expands the space
    const spaceItem = page.getByTestId('space-item').first();

    await spaceItem.locator('[data-testid="space-name"]').first().click({ force: true });
    await page.waitForTimeout(1000);
    await expandSpace(page);
    await page.waitForTimeout(1000);

    // Then the embedded Grid is still visible and no placeholder appears
    await expectDatabaseGrid(page);
  });

  test('Scenario 5: should show placeholder when navigating back to page after deletion', async ({
    page,
    request,
  }) => {
    // Given a document page with one embedded Grid database
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);

    await expectDatabaseGrid(page);

    const docPageUrl = page.url();

    await givenSidebarExpanded(page, docViewId);

    // And the user navigates to a different page
    const otherPage = PageSelectors.nameContaining(page, 'Getting started').first();

    await otherPage.scrollIntoViewIfNeeded();
    await otherPage.click({ force: true });
    await page.waitForTimeout(3000);

    // Re-expand the document page so "New Database" is visible for deletion
    await ensurePageExpandedByViewId(page, docViewId);
    await page.waitForTimeout(1000);

    // When the user deletes "New Database" from the sidebar while on the other page
    await deletePageByName(page, 'New Database');
    await page.waitForTimeout(6000);

    // And navigates back to the original document
    await page.goto(docPageUrl);
    await page.waitForTimeout(5000);

    // Then the embedded block shows the trash placeholder
    await expectDatabasePlaceholder(page);
  });

  test('Scenario 6: should show "was deleted" after permanent deletion from trash', async ({
    page,
    request,
  }) => {
    // Given a document page with an embedded Grid that has been moved to trash
    const docViewId = await givenDocumentWithEmbeddedGrid(page, request);

    await expectDatabaseGrid(page);
    await givenSidebarExpanded(page, docViewId);

    await deletePageByName(page, 'New Database');
    await page.waitForTimeout(6000);
    await expectDatabaseInTrash(page);

    const docPageUrl = page.url();

    // When the user navigates to Trash
    await TrashSelectors.sidebarTrashButton(page).click();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/app\/trash/);
    await expect(TrashSelectors.table(page)).toBeVisible();

    // And permanently deletes the database from trash
    const rows = TrashSelectors.rows(page);

    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    await rows.first().getByTestId('trash-delete-button').click();
    await page.waitForTimeout(1000);

    // Confirm permanent deletion if a dialog appears
    const confirmButton = page.getByTestId('confirm-delete-button');

    if ((await confirmButton.count()) > 0) {
      await confirmButton.click();
    }

    await page.waitForTimeout(3000);

    // And navigates back to the document page
    await page.goto(docPageUrl);
    await page.waitForTimeout(5000);

    // Then the embedded block shows "This database was deleted"
    await expectDatabaseDeleted(page);
  });
});
