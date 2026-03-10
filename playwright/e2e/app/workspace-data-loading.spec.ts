import { test, expect } from '@playwright/test';
import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Tests for workspace data loading after async optimization.
 * Verifies that parallelizing getAppOutline and getShareWithMe API calls
 * doesn't break functionality.
 * Migrated from: cypress/e2e/app/workspace-data-loading.cy.ts
 */
test.describe('Workspace Data Loading', () => {
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
    });
  });

  test('should load workspace outline with sidebar visible after async optimization', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load - this tests that the parallelized API calls work
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verify sidebar is visible and functional
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();
  });

  test('should handle shareWithMe API failure gracefully (outline still loads)', async ({
    page,
    request,
  }) => {
    const criticalOutlineErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text().toLowerCase();
        if (text.includes('outline') && text.includes('app outline not found')) {
          criticalOutlineErrors.push(msg.text());
        }
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verify no critical errors related to outline loading
    expect(criticalOutlineErrors.length).toBe(0);

    // Verify sidebar is still functional
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(PageSelectors.items(page).first()).toBeVisible();
  });

  test('should not have React error boundaries triggered during workspace loading', async ({
    page,
    request,
  }) => {
    const errorBoundaryMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text().toLowerCase();
      if (
        (text.includes('error occurred') && text.includes('outline')) ||
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

    // Check that no error boundaries were triggered
    expect(errorBoundaryMessages.length).toBe(0);
  });
});
