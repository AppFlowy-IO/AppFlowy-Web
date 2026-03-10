import { Page, expect } from '@playwright/test';
import { PageSelectors, ViewActionSelectors, ModalSelectors } from '../selectors';

/**
 * Page actions utility functions for Playwright E2E tests
 * Migrated from: cypress/support/page/page-actions.ts
 */

export async function openViewActionsPopoverForPage(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);
  await expect(pageItem).toBeVisible();

  // Hover to reveal the more actions button
  await pageItem.hover({ force: true });
  await page.waitForTimeout(1000);

  // Click more actions button
  const moreBtn = pageItem.getByTestId('page-more-actions');
  await expect(moreBtn).toBeVisible({ timeout: 5000 });
  await moreBtn.click({ force: true });
  await page.waitForTimeout(1000);

  // Verify dropdown appeared
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toBeVisible({ timeout: 5000 });
}

export async function deletePageByName(page: Page, pageName: string): Promise<void> {
  // Hover over page item
  const pageItem = PageSelectors.itemByName(page, pageName);
  await pageItem.hover({ force: true });
  await page.waitForTimeout(1000);

  // Click more actions button
  await PageSelectors.moreActionsButton(page, pageName).click({ force: true });
  await page.waitForTimeout(1000);

  // Verify popover and click delete
  await expect(ViewActionSelectors.popover(page)).toBeVisible();
  await ViewActionSelectors.deleteButton(page).click();
  await page.waitForTimeout(500);

  // Handle confirmation if needed
  const confirmModal = page.getByTestId('delete-page-confirm-modal');
  if ((await confirmModal.count()) > 0) {
    await ModalSelectors.confirmDeleteButton(page).click();
  }

  await page.waitForTimeout(1000);
}
