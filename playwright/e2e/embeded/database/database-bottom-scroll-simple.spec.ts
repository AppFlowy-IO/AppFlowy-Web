/**
 * Embedded Database - Bottom Scroll Preservation (Simplified)
 *
 * Tests scroll preservation when creating grid at bottom.
 * Migrated from: cypress/e2e/embeded/database/database-bottom-scroll-simple.cy.ts
 */
import { test, expect } from '@playwright/test';
import { EditorSelectors, SlashCommandSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { getSlashMenuItemName } from '../../../support/i18n-constants';

test.describe('Embedded Database - Bottom Scroll Preservation (Simplified)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('No range and node found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should preserve scroll position when creating grid at bottom', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(2000);

    // Clear existing content and add 30 lines
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Type 30 lines of content
    for (let i = 1; i <= 30; i++) {
      await page.keyboard.type(`Line ${i} content`, { delay: 1 });
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);

    // Scroll to bottom
    const scrollContainer = page.locator('.appflowy-scroll-container').first();
    const scrollBefore = await scrollContainer.evaluate((el) => {
      const targetScroll = el.scrollHeight - el.clientHeight;
      el.scrollTop = targetScroll;
      return targetScroll;
    });

    await page.waitForTimeout(1000);

    // Record final scroll position before creating database
    const actualScrollBefore = await scrollContainer.evaluate((el) => el.scrollTop);

    // Create database at bottom via slash menu
    await page.keyboard.type('/', { delay: 0 });
    await page.waitForTimeout(500);

    const slashPanel = SlashCommandSelectors.slashPanel(page);
    await expect(slashPanel).toBeVisible();
    await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('grid')).first().click();
    await page.waitForTimeout(2000);

    // Check modal opened
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });

    // CRITICAL: Verify scroll position is preserved (didn't jump to top)
    const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop);
    const scrollDelta = Math.abs(scrollAfter - actualScrollBefore);

    // Should NOT scroll to top (scrollAfter should be > 200)
    expect(scrollAfter).toBeGreaterThan(200);

    // Verify scroll stayed close to original position (within 100px tolerance)
    expect(scrollDelta).toBeLessThan(100);
  });
});
