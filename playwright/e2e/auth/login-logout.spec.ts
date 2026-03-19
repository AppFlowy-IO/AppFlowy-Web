import { test, expect } from '@playwright/test';
import { generateRandomEmail } from '../../support/test-config';
import {
  WorkspaceSelectors,
  AuthSelectors,
} from '../../support/selectors';
import {
  assertLoginPageReady,
  signInAndWaitForApp,
  visitLoginPage,
} from '../../support/auth-flow-helpers';

/**
 * Login and Logout Flow Tests
 * Migrated from: cypress/e2e/auth/login-logout.cy.ts
 */
test.describe('Login and Logout Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Ignore known transient errors
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Test Case 1: Complete Login and Logout Flow', () => {
    test('should login and successfully logout with detailed verification', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();

      // Step 1-2: Navigate to login page and verify elements
      await visitLoginPage(page);
      await assertLoginPageReady(page);

      // Step 3-4: Authenticate
      await signInAndWaitForApp(page, request, testEmail);

      // Step 5: Verify workspace is loaded
      await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible();

      // Step 6: Open workspace dropdown
      await WorkspaceSelectors.dropdownTrigger(page).click();

      // Step 7: Verify dropdown content and user email
      await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible();
      await expect(page.getByText(testEmail)).toBeVisible();

      // Step 8: Click logout menu item
      await expect(AuthSelectors.logoutMenuItem(page)).toBeVisible();
      await AuthSelectors.logoutMenuItem(page).click();
      await page.waitForTimeout(1000);

      // Step 9: Verify logout confirmation dialog
      await expect(AuthSelectors.logoutConfirmButton(page)).toBeVisible();

      // Step 10: Confirm logout
      await AuthSelectors.logoutConfirmButton(page).click();
      await page.waitForTimeout(2000);

      // Step 11-12: Verify redirect to login page
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
      await assertLoginPageReady(page);
    });
  });

  test.describe('Test Case 2: Quick Login and Logout using Test URL', () => {
    test('should login with test URL and successfully logout', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();

      // Sign in
      await signInAndWaitForApp(page, request, testEmail);

      // Verify user is logged in
      await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible();

      // Open workspace dropdown
      await WorkspaceSelectors.dropdownTrigger(page).click();

      // Verify dropdown
      await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible();
      await expect(page.getByText(testEmail)).toBeVisible();

      // Click logout
      await expect(AuthSelectors.logoutMenuItem(page)).toBeVisible();
      await AuthSelectors.logoutMenuItem(page).click();
      await page.waitForTimeout(1000);

      // Confirm logout
      await expect(AuthSelectors.logoutConfirmButton(page)).toBeVisible();
      await AuthSelectors.logoutConfirmButton(page).click();
      await page.waitForTimeout(2000);

      // Verify redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
      await assertLoginPageReady(page);
    });
  });

  test.describe('Test Case 3: Cancel Logout Confirmation', () => {
    test('should cancel logout when clicking cancel button', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();

      // Sign in
      await signInAndWaitForApp(page, request, testEmail);

      // Open workspace dropdown
      await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible();
      await WorkspaceSelectors.dropdownTrigger(page).click();

      // Verify dropdown is open
      await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible();

      // Click logout menu item
      await expect(AuthSelectors.logoutMenuItem(page)).toBeVisible();
      await AuthSelectors.logoutMenuItem(page).click();
      await page.waitForTimeout(1000);

      // Click Cancel button
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(1000);

      // Verify user remains logged in
      await expect(page).toHaveURL(/\/app/);
      await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible();

      // Open dropdown again to verify user is still logged in
      await WorkspaceSelectors.dropdownTrigger(page).click();
      await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible();
      await expect(page.getByText(testEmail)).toBeVisible();

      // Close dropdown
      await page.mouse.click(0, 0);
      await page.waitForTimeout(500);
    });
  });
});
