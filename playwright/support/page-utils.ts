/**
 * Page utility functions for Playwright E2E tests
 * Migrated from: cypress/support/page-utils.ts and cypress/support/page/flows.ts
 *
 * Contains high-level helpers for sidebar navigation, space expansion,
 * URL utilities, and page management.
 */
import { Page, expect } from '@playwright/test';
import {
  AddPageSelectors,
  BlockSelectors,
  PageSelectors,
  SpaceSelectors,
  ModalSelectors,
  SlashCommandSelectors,
  ViewActionSelectors,
} from './selectors';
import { getSlashMenuItemName } from './i18n-constants';

/**
 * Expands a space in the sidebar by its name (e.g. 'General').
 * If the space is already expanded, this is a no-op.
 */
export async function expandSpaceByName(page: Page, spaceName: string): Promise<void> {
  const spaceItem = SpaceSelectors.itemByName(page, spaceName);
  await expect(spaceItem).toBeVisible({ timeout: 30000 });

  const expandedIndicator = spaceItem.locator('[data-testid="space-expanded"]');
  const isExpanded = await expandedIndicator.getAttribute('data-expanded');

  if (isExpanded !== 'true') {
    await spaceItem.locator('[data-testid="space-name"]').click({ force: true });
    await page.waitForTimeout(1000);
  }
}

/**
 * Expands a page item in the sidebar by clicking its expand toggle.
 */
export async function expandPageByName(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);
  await pageItem.locator('[data-testid="outline-toggle-expand"]').first().click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Expands a database container in the sidebar by clicking its expand toggle.
 */
export async function expandDatabaseInSidebar(page: Page, dbName: string = 'New Database'): Promise<void> {
  const dbItem = PageSelectors.itemByName(page, dbName);
  await expect(dbItem).toBeVisible({ timeout: 10000 });

  const expandToggle = dbItem.locator('[data-testid="outline-toggle-expand"]');
  const count = await expandToggle.count();
  if (count > 0) {
    await expandToggle.first().click({ force: true });
    await page.waitForTimeout(500);
  }
}

/**
 * Renames a sidebar page item and waits until the outline reflects the new name.
 */
export async function renamePageByName(page: Page, currentName: string, newName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, currentName);
  await expect(pageItem).toBeVisible({ timeout: 30000 });

  for (let attempt = 0; attempt < 3; attempt++) {
    await pageItem.hover({ force: true });
    await page.waitForTimeout(500);
    await PageSelectors.moreActionsButton(page, currentName).click({ force: true });
    await expect(ViewActionSelectors.renameButton(page)).toBeVisible({ timeout: 10000 });
    await ViewActionSelectors.renameButton(page).click({ force: true });

    const renameInput = ModalSelectors.renameInput(page);
    await expect(renameInput).toBeVisible({ timeout: 10000 });
    await renameInput.clear();
    await renameInput.fill(newName);
    await expect(renameInput).toHaveValue(newName, { timeout: 5000 });
    await ModalSelectors.renameSaveButton(page).click({ force: true });

    if (
      await expect(PageSelectors.itemByName(page, newName))
        .toBeVisible({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  await expect(PageSelectors.itemByName(page, newName)).toBeVisible({ timeout: 30000 });
}

/**
 * Extracts the current view ID from the URL pathname.
 * The view ID is the last segment of the pathname.
 */
export function currentViewIdFromUrl(page: Page): string {
  const url = new URL(page.url());
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.pop() || '';
}

/**
 * Closes any open modal dialogs by pressing Escape.
 */
export async function closeModalsIfOpen(page: Page): Promise<void> {
  const dialogCount = await page.locator('[role="dialog"]').count();
  if (dialogCount > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

/**
 * Navigates away from the current page by creating a new document page.
 * Returns after navigation completes.
 */
export async function navigateAwayToNewPage(page: Page): Promise<void> {
  await closeModalsIfOpen(page);
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addDocumentButton(page).click({ force: true });
  await page.waitForTimeout(1000);

  // Handle new page modal if it appears
  const modalCount = await page.getByTestId('new-page-modal').count();
  if (modalCount > 0) {
    await expect(ModalSelectors.newPageModal(page)).toBeVisible();
    await ModalSelectors.spaceItemInModal(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await page.locator('button').filter({ hasText: 'Add' }).click({ force: true });
  }
  await page.waitForTimeout(2000);
}

/**
 * Expands a page in the sidebar by its view ID.
 */
export async function ensurePageExpandedByViewId(page: Page, viewId: string): Promise<void> {
  const pageEl = page.locator(`[data-testid="page-item"]:has(> [data-testid="page-${viewId}"])`).first();
  await expect(pageEl).toBeVisible({ timeout: 10000 });

  const collapseToggle = pageEl.locator('[data-testid="outline-toggle-collapse"]');
  const isExpanded = (await collapseToggle.count()) > 0;

  if (!isExpanded) {
    const expandToggle = pageEl.locator('[data-testid="outline-toggle-expand"]');
    if ((await expandToggle.count()) > 0) {
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Creates a document page via the inline add button, expands the ViewModal
 * to full-page view, and returns the document's view ID.
 */
export async function createDocumentPageAndNavigate(page: Page): Promise<string> {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addDocumentButton(page).click({ force: true });
  await page.waitForTimeout(1000);

  // Expand the ViewModal to full page view
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[role="dialog"]').last().locator('button').first().click({ force: true });
  await page.waitForTimeout(1000);

  const viewId = currentViewIdFromUrl(page);
  expect(viewId).not.toBe('');
  await expect(page.locator(`#editor-${viewId}`)).toBeVisible({ timeout: 15000 });
  return viewId;
}

/**
 * Inserts a linked database into the current document editor via the slash menu.
 */
export async function insertLinkedDatabaseViaSlash(page: Page, docViewId: string, dbName: string): Promise<void> {
  const editor = page.locator(`#editor-${docViewId}`);
  await expect(editor).toBeVisible({ timeout: 15000 });
  const initialBlockCount = await editor.locator(BlockSelectors.blockSelector('grid')).count();
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await editor.click({ position: { x: 200, y: 100 }, force: true });
      await editor.pressSequentially('/', { delay: 50 });
      await page.waitForTimeout(500);

      const slashPanel = SlashCommandSelectors.slashPanel(page);
      await expect(slashPanel).toBeVisible({ timeout: 10000 });
      await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
      await page.waitForTimeout(1000);

      await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });

      const loadingText = page.getByText('Loading...');
      if ((await loadingText.count()) > 0) {
        await expect(loadingText).not.toBeVisible({ timeout: 15000 });
      }

      const popover = page.locator('.MuiPopover-paper').last();
      await expect(popover).toBeVisible({ timeout: 10000 });
      const searchInput = popover.locator('input[placeholder*="Search"]');
      if ((await searchInput.count()) > 0) {
        await searchInput.clear();
        await searchInput.fill(dbName);
        await page.waitForTimeout(2000);
      }

      const databaseOption = popover.getByText(dbName, { exact: false }).first();
      if ((await databaseOption.count()) > 0) {
        await databaseOption.click({ force: true });
        await page.waitForTimeout(2000);
        return;
      }
    } catch (e) {
      lastError = e;
    }

    if ((await editor.locator(BlockSelectors.blockSelector('grid')).count()) > initialBlockCount) {
      return;
    }

    if (attempt === 2) {
      if (lastError) throw lastError;
      break;
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
    await page.keyboard.press('Home').catch(() => undefined);
    await page.keyboard.press('Shift+End').catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.waitForTimeout(3000);
  }

  throw new Error(`Database "${dbName}" not found in linked database picker after multiple retries`);
}

/**
 * Creates a new page, opens it, and inserts an image block.
 * Returns after the image block is visible.
 */
export async function createPageAndInsertImage(page: Page, pngBuffer: Buffer): Promise<void> {
  // Create a new page and expand to full-page view (same pattern as createDocumentPageAndNavigate)
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addDocumentButton(page).click({ force: true });
  await page.waitForTimeout(1000);

  // Expand ViewModal to full-page view
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[role="dialog"]').last().locator('button').first().click({ force: true });
  await page.waitForTimeout(1000);

  // Wait for editor to be visible
  const viewId = currentViewIdFromUrl(page);
  if (viewId) {
    await expect(page.locator(`#editor-${viewId}`)).toBeVisible({ timeout: 15000 });
  }

  // Focus editor and insert image via slash command
  const editor = page.locator('[data-slate-editor="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click({ force: true });
  await page.waitForTimeout(500);

  await page.keyboard.type('/', { delay: 50 });
  await page.waitForTimeout(1000);

  const slashPanel = page.getByTestId('slash-panel');
  await expect(slashPanel).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('image', { delay: 50 });
  await page.waitForTimeout(1000);

  await page
    .locator('[data-testid^="slash-menu-"]')
    .filter({ hasText: /^Image$/ })
    .click({ force: true });
  await page.waitForTimeout(1000);

  // Upload image
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  await fileInput.setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await page.waitForTimeout(3000);

  // Verify image block exists
  await expect(page.locator('[data-block-type="image"]').first()).toBeVisible({ timeout: 10000 });
}
