/**
 * Embedded Database - Bottom Scroll Preservation Tests
 *
 * Tests scroll preservation for grid/board/calendar at bottom.
 * Migrated from: cypress/e2e/embeded/database/database-bottom-scroll.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  SlashCommandSelectors,
} from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database - Bottom Scroll Preservation', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        err.message.includes('No range and node found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  async function runScrollPreservationTest(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    slashMenuKey: 'grid' | 'kanban' | 'calendar'
  ) {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Create a new document
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Handle the new page modal if it appears
    const newPageModal = page.getByTestId('new-page-modal');
    if ((await newPageModal.count()) > 0) {
      await ModalSelectors.spaceItemInModal(page).first().click({ force: true });
      await page.waitForTimeout(500);
      await page.locator('button').filter({ hasText: 'Add' }).click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(3000);
    }

    // Wait for editor to be available
    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click editor to focus
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);

    // Add 25 lines to exceed screen height
    for (let i = 1; i <= 25; i++) {
      await page.keyboard.type(`Line ${i} content`, { delay: 1 });
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);

    // Scroll to bottom
    const scrollContainer = page.locator('.appflowy-scroll-container').first();
    await scrollContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    await page.waitForTimeout(1000);

    // Record scroll position
    const scrollBefore = await scrollContainer.evaluate((el) => el.scrollTop);

    // Open slash menu and select database type
    await page.keyboard.type('/', { delay: 0 });
    await page.waitForTimeout(500);

    await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName(slashMenuKey)).first().click();
    await page.waitForTimeout(2000);

    // Check dialog/modal opened (for grid it opens a ViewModal)
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });

    // CRITICAL: Verify scroll position is preserved
    const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop);

    // Should NOT scroll to top
    expect(scrollAfter).toBeGreaterThan(200);

    // Verify scroll stayed close to original position (within 150px tolerance)
    const scrollDelta = Math.abs(scrollAfter - scrollBefore);
    expect(scrollDelta).toBeLessThan(150);
  }

  test('should preserve scroll position when creating grid at bottom', async ({ page, request }) => {
    await runScrollPreservationTest(page, request, 'grid');
  });

  test('should preserve scroll position when creating board at bottom', async ({ page, request }) => {
    await runScrollPreservationTest(page, request, 'kanban');
  });

  test('should preserve scroll position when creating calendar at bottom', async ({ page, request }) => {
    await runScrollPreservationTest(page, request, 'calendar');
  });
});
