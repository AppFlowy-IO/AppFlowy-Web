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
  PageSelectors,
  SpaceSelectors,
  ModalSelectors,
  SlashCommandSelectors,
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
  await page.locator('[role="menuitem"]').first().click({ force: true });
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
  const pageEl = page.getByTestId(`page-${viewId}`).first().locator('xpath=ancestor::*[@data-testid="page-item"]').first();
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
  await page.locator('[role="menuitem"]').first().click({ force: true });
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
export async function insertLinkedDatabaseViaSlash(
  page: Page,
  docViewId: string,
  dbName: string
): Promise<void> {
  const editor = page.locator(`#editor-${docViewId}`);
  await expect(editor).toBeVisible();
  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await editor.pressSequentially('/', { delay: 50 });
  await page.waitForTimeout(500);

  // Click linked grid from slash menu
  const slashPanel = SlashCommandSelectors.slashPanel(page);
  await expect(slashPanel).toBeVisible();
  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('linkedGrid')).first().click({ force: true });
  await page.waitForTimeout(1000);

  // Select database from picker
  await expect(page.getByText('Link to an existing database')).toBeVisible({ timeout: 10000 });

  // Wait for loading to complete
  const loadingText = page.getByText('Loading...');
  if ((await loadingText.count()) > 0) {
    await expect(loadingText).not.toBeVisible({ timeout: 15000 });
  }

  // Search for and select the database
  const popover = page.locator('.MuiPopover-paper').last();
  await expect(popover).toBeVisible();
  const searchInput = popover.locator('input[placeholder*="Search"]');
  if ((await searchInput.count()) > 0) {
    await searchInput.clear();
    await searchInput.fill(dbName);
    await page.waitForTimeout(2000);
  }

  await popover.getByText(dbName, { exact: false }).first().click({ force: true });
  await page.waitForTimeout(2000);
}

/**
 * Creates a new page, opens it, and inserts an image block.
 * Returns after the image block is visible.
 */
export async function createPageAndInsertImage(page: Page, pngBuffer: Buffer): Promise<void> {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]').first().click({ force: true });
  await page.waitForTimeout(1000);

  // Close the ViewModal dialog
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.locator('[role="dialog"]').last().locator('button').filter({ hasText: /./  }).last().click({ force: true });
  await page.waitForTimeout(1000);

  // Focus editor and insert image via slash command
  const editor = page.locator('[data-slate-editor="true"]').first();
  await expect(editor).toBeVisible();
  await editor.click({ force: true });
  await page.waitForTimeout(500);

  await page.keyboard.type('/image', { delay: 100 });
  await page.waitForTimeout(1000);

  const slashPanel = page.getByTestId('slash-panel');
  if (await slashPanel.isVisible()) {
    await page.locator('[data-testid^="slash-menu-"]').filter({ hasText: /^Image$/ }).click({ force: true });
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(1000);

  // Upload image
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  await page.waitForTimeout(3000);

  // Verify image block exists
  await expect(page.locator('[data-block-type="image"]').first()).toBeVisible({ timeout: 10000 });
}
