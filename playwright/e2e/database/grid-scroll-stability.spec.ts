/**
 * Grid Scroll Stability E2E Tests
 *
 * Verifies that grid scrolling and navigation-away-while-scrolling
 * does not cause React errors (e.g., setState on unmounted component).
 *
 * Regression test for: GridVirtualizer missing clearTimeout cleanup
 * in scroll listener useEffect, which could fire setIsScrolling(false)
 * after the component unmounts.
 *
 * Migrated from: cypress/e2e/database/grid-scroll-stability.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';

test.describe('Grid Scroll Stability', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes("Can't perform a React state update on an unmounted component") ||
        err.message.includes("Can't perform a React state update on a component that's been unmounted")
      ) {
        // Let it fail - this is the bug we are testing for
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

  test('should handle grid scrolling without errors when navigating away', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);

    // When: rapidly scrolling the grid container
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-custom-scroller');
      if (el) {
        for (let i = 0; i < 5; i++) {
          el.scrollTop = i * 20;
        }
      }
    });

    await page.waitForTimeout(200);

    // And: navigating away immediately while the debounced setIsScrolling(false) timeout is pending
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"]').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Then: waiting for the scroll timeout to fire (1000ms) should not cause errors
    await page.waitForTimeout(2000);

    // And: the page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle rapid scroll start/stop cycles', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);

    // When: rapidly scrolling in multiple cycles to trigger timeout resets
    await page.evaluate(() => {
      const el = document.querySelector('.appflowy-custom-scroller');
      if (el) {
        for (let cycle = 0; cycle < 3; cycle++) {
          for (let i = 0; i < 5; i++) {
            el.scrollTop = cycle * 100 + i * 20;
          }
        }
      }
    });

    // Then: waiting for the debounce timeout to settle should not cause errors
    await page.waitForTimeout(2000);

    // And: the grid should still be functional
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
    await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible();
  });
});
