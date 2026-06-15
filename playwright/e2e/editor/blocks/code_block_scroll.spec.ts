import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Code Block Scroll Stability Tests
 * Regression test for: https://github.com/AppFlowy-IO/AppFlowy-Web/issues/300
 *
 * When editing a code block further down on a page, pressing Enter should NOT
 * cause the page to scroll back to the top.
 */
test.describe('Code Block Scroll Stability', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: sign in and create a blank document page with the editor focused.
   */
  async function setupEditor(
    page: Page,
    request: import('@playwright/test').APIRequestContext
  ) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(1000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  /**
   * Helper: fill the editor with enough paragraph blocks to force vertical
   * scrolling, then append a code block at the bottom.
   */
  async function fillPageAndInsertCodeBlock(page: Page) {
    // Type many lines of filler text to push content below the fold
    for (let i = 0; i < 25; i++) {
      await page.keyboard.type(`Filler paragraph line ${i + 1}`, { delay: 10 });
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(300);

    // Insert a code block via the slash menu
    await page.keyboard.type('/', { delay: 50 });
    await page.waitForTimeout(1000);

    const slashPanel = page.getByTestId('slash-panel');
    await expect(slashPanel).toBeVisible({ timeout: 10000 });

    // Search for "code" and click the Code option
    await page.keyboard.type('code', { delay: 50 });
    await page.waitForTimeout(500);

    await page.getByTestId('slash-menu-code').click({ force: true });
    await page.waitForTimeout(1000);

    // Verify the code block was created
    await expect(page.locator('[data-block-type="code"]')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Helper: returns the current vertical scroll position of the main scroll container.
   */
  async function getScrollTop(page: Page): Promise<number> {
    return page.evaluate(() => {
      const el = document.querySelector('.appflowy-scroll-container');

      return el ? el.scrollTop : 0;
    });
  }

  test('pressing Enter in a code block below the fold should not scroll to top', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);
    await fillPageAndInsertCodeBlock(page);

    // Scroll to the bottom so the code block is visible
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-scroll-container');

      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);

    // Click inside the code block to focus it
    const codeBlock = page.locator('[data-block-type="code"]');
    await codeBlock.click({ force: true });
    await page.waitForTimeout(300);

    // Type some initial text so we have content to press Enter in
    await page.keyboard.type('function hello() {', { delay: 20 });
    await page.waitForTimeout(200);

    // Record scroll position before pressing Enter
    const scrollBefore = await getScrollTop(page);

    // The scroll should be > 0 since the code block is below the fold
    expect(scrollBefore).toBeGreaterThan(50);

    // Press Enter multiple times inside the code block
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
    }

    // Allow any async scroll effects to settle
    await page.waitForTimeout(500);

    // Verify: scroll should NOT have jumped to the top
    const scrollAfter = await getScrollTop(page);

    // Allow a small tolerance for natural scroll adjustments (e.g. code block
    // growing taller may shift the viewport slightly), but the scroll position
    // must not have dropped to near zero.
    expect(scrollAfter).toBeGreaterThan(scrollBefore * 0.5);
  });

  test('typing in a code block below the fold should maintain scroll position', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);
    await fillPageAndInsertCodeBlock(page);

    // Scroll to bottom
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-scroll-container');

      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);

    // Focus the code block
    const codeBlock = page.locator('[data-block-type="code"]');
    await codeBlock.click({ force: true });
    await page.waitForTimeout(300);

    const scrollBefore = await getScrollTop(page);
    expect(scrollBefore).toBeGreaterThan(50);

    // Type several lines of code with Enter presses
    await page.keyboard.type('const x = 1;', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('const y = 2;', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('const z = x + y;', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('console.log(z);', { delay: 20 });
    await page.waitForTimeout(500);

    const scrollAfter = await getScrollTop(page);

    // Scroll must not have jumped to the top
    expect(scrollAfter).toBeGreaterThan(scrollBefore * 0.5);
  });
});
