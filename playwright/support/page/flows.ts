import { Page, expect } from '@playwright/test';
import {
  AddPageSelectors,
  PageSelectors,
  SpaceSelectors,
  ModalSelectors,
  SidebarSelectors,
  SlashCommandSelectors,
} from '../selectors';

/**
 * Flow utility functions for Playwright E2E tests
 * Migrated from: cypress/support/page/flows.ts
 */

export async function waitForPageLoad(page: Page, waitTime: number = 3000): Promise<void> {
  await page.waitForTimeout(waitTime);
}

export async function waitForSidebarReady(page: Page, timeout: number = 10000): Promise<void> {
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout });
}

export async function expandSpace(page: Page, spaceIndex: number = 0): Promise<void> {
  const spaceItem = SpaceSelectors.items(page).nth(spaceIndex);
  const expanded = spaceItem.locator('[data-testid="space-expanded"]');
  const isExpanded = await expanded.getAttribute('data-expanded');

  if (isExpanded !== 'true') {
    await spaceItem.getByTestId('space-name').first().click();
  }
  await page.waitForTimeout(500);
}

export async function expandSpaceByName(page: Page, spaceName: string): Promise<void> {
  const spaceItem = SpaceSelectors.itemByName(page, spaceName);
  await expect(spaceItem).toBeVisible({ timeout: 30000 });

  const expanded = spaceItem.locator('[data-testid="space-expanded"]');
  const isExpanded = await expanded.getAttribute('data-expanded');

  if (isExpanded !== 'true') {
    await spaceItem.getByTestId('space-name').click({ force: true });
    await page.waitForTimeout(1000);
  }
}

export async function expandPageByName(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);
  await pageItem.locator('[data-testid="outline-toggle-expand"]').first().click({ force: true });
  await page.waitForTimeout(1000);
}

export async function openPageFromSidebar(page: Page, pageName: string): Promise<void> {
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible();

  const pageLink = PageSelectors.nameContaining(page, pageName).first();
  await pageLink.scrollIntoViewIfNeeded();
  await expect(pageLink).toBeVisible();
  await pageLink.click();
  await page.waitForTimeout(2000);
}

export async function currentViewIdFromUrl(page: Page): Promise<string> {
  const pathname = new URL(page.url()).pathname;
  return pathname.split('/').filter(Boolean).pop() || '';
}

export async function ensurePageExpandedByViewId(page: Page, viewId: string): Promise<void> {
  const pageEl = page.getByTestId(`page-${viewId}`).first();
  const pageItem = pageEl.locator('xpath=ancestor::*[@data-testid="page-item"]').first();
  await expect(pageItem).toBeVisible();

  const isExpanded = await pageItem.locator('[data-testid="outline-toggle-collapse"]').count();
  if (isExpanded === 0) {
    await pageItem.locator('[data-testid="outline-toggle-expand"]').first().click({ force: true });
    await page.waitForTimeout(500);
  }
}

export async function createDocumentPageAndNavigate(page: Page): Promise<string> {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('[role="menuitem"]').first().click({ force: true });
  await page.waitForTimeout(1000);

  // Expand the ViewModal to full page view
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.last().locator('button').first().click({ force: true });
  await page.waitForTimeout(1000);

  const viewId = await currentViewIdFromUrl(page);
  expect(viewId).not.toBe('');
  await expect(page.locator(`#editor-${viewId}`)).toBeVisible({ timeout: 15000 });
  return viewId;
}

export async function createPageAndAddContent(
  page: Page,
  pageName: string,
  content: string[]
): Promise<void> {
  // Click new page button
  await PageSelectors.newPageButton(page).click();
  await page.waitForTimeout(1000);

  // Handle new page modal
  const modal = ModalSelectors.newPageModal(page);
  await expect(modal).toBeVisible();
  await ModalSelectors.spaceItemInModal(page).first().click();
  await page.waitForTimeout(500);
  await ModalSelectors.addButton(page).click();
  await page.waitForTimeout(3000);

  // Close any remaining modals
  if ((await page.locator('[role="dialog"]').count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // Set the page title
  const titleInput = PageSelectors.titleInput(page).first();
  await expect(titleInput).toBeVisible();
  await titleInput.click({ force: true });
  await page.keyboard.press('Control+A');
  await titleInput.pressSequentially(pageName, { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Type content in editor
  const editors = page.locator('[contenteditable="true"]');
  await expect(editors.first()).toBeVisible({ timeout: 10000 });

  // Find the main editor (not the title)
  const editorCount = await editors.count();
  let targetEditor = editors.last();
  for (let i = 0; i < editorCount; i++) {
    const testId = await editors.nth(i).getAttribute('data-testid');
    if (!testId?.includes('title')) {
      targetEditor = editors.nth(i);
      break;
    }
  }

  await targetEditor.click({ force: true });
  await targetEditor.fill(content.join('\n'));
  await page.waitForTimeout(1000);
}
