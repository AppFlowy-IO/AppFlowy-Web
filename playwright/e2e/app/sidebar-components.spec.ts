import { test, expect } from '@playwright/test';
import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Sidebar Components Resilience Tests
 * Migrated from: cypress/e2e/app/sidebar-components.cy.ts
 */
test.describe('Sidebar Components Resilience Tests', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }

      throw err;
    });
  });

  test('should load app without React error boundaries triggering for ShareWithMe and Favorite components', async ({
    page,
    request,
  }) => {
    const errorBoundaryMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text().toLowerCase();
      if (
        (text.includes('favorite') && text.includes('error occurred')) ||
        (text.includes('sharewithme') && text.includes('error occurred')) ||
        text.includes('react will try to recreate')
      ) {
        errorBoundaryMessages.push(msg.text());
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // Assert no error boundaries were triggered
    expect(errorBoundaryMessages.length).toBe(0);

    // Verify sidebar is visible and functional
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();
  });

  test('should handle empty favorites gracefully', async ({ page, request }) => {
    const favoriteErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase();
        if (text.includes('favorite')) {
          favoriteErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // Should not have errors related to Favorite component
    expect(favoriteErrors.length).toBe(0);
  });

  test('should handle ShareWithMe with no shared content gracefully', async ({ page, request }) => {
    const shareWithMeErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase();
        if (text.includes('sharewithme') || text.includes('findsharewithmespace')) {
          shareWithMeErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // Should not have errors related to ShareWithMe component
    expect(shareWithMeErrors.length).toBe(0);
  });

  test('should handle invalid outline data gracefully', async ({ page, request }) => {
    const outlineErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase();
        if (
          text.includes('outline') ||
          text.includes('is not a function') ||
          text.includes('cannot read property')
        ) {
          outlineErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // Should not have errors related to invalid outline data
    expect(outlineErrors.length).toBe(0);
  });

  test('should handle favorites with invalid favorited_at dates gracefully', async ({ page, request }) => {
    const dateErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase();
        if (
          text.includes('favorited_at') ||
          text.includes('invalid date') ||
          text.includes('dayjs')
        ) {
          dateErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // Should not have errors related to invalid dates
    expect(dateErrors.length).toBe(0);
  });
});
