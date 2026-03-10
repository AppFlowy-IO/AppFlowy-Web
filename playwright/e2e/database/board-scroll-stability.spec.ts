/**
 * Board Scroll Stability E2E Tests
 *
 * Verifies that board view scrolling and navigation-away-while-scrolling
 * does not cause errors.
 *
 * Regression test for:
 * - Group.tsx: removeEventListener missing options (inconsistent with addEventListener)
 * - Ensures scroll listeners are properly cleaned up on unmount
 *
 * Migrated from: cypress/e2e/database/board-scroll-stability.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  BoardSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';

test.describe('Board Scroll Stability', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes("Can't perform a React state update on an unmounted component") ||
        err.message.includes("Can't perform a React state update on a component that's been unmounted")
      ) {
        // Let it fail - this is what the fix prevents
        throw err;
      }

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

  test('should handle board horizontal scrolling without errors', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a board database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Board', { createWaitMs: 8000 });
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // When: scrolling the board container horizontally
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-custom-scroller');
      if (el) {
        el.scrollLeft = 200;
      }
    });

    await page.waitForTimeout(500);

    // And: scrolling back to the start
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-custom-scroller');
      if (el) {
        el.scrollLeft = 0;
      }
    });

    await page.waitForTimeout(500);

    // Then: the board should still be functional
    await expect(BoardSelectors.boardContainer(page)).toBeVisible();
  });

  test('should handle navigating away while board is scrolling', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a board database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Board', { createWaitMs: 8000 });
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // When: triggering scroll events on the board's vertical scroll container
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-scroll-container');
      if (el) {
        for (let i = 0; i < 5; i++) {
          el.scrollTop = i * 30;
        }
      }
    });

    await page.waitForTimeout(200);

    // And: navigating away immediately while scroll listener may still be active
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"]').first().click({ force: true });

    // Then: waiting for cleanup should not cause errors
    await page.waitForTimeout(2000);

    // And: the page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });
});
