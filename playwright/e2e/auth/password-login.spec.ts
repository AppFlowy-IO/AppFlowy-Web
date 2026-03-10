import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { AuthSelectors } from '../../support/selectors';
import {
  goToPasswordStep,
  visitAuthPath,
  visitLoginPage,
} from '../../support/auth-flow-helpers';

/**
 * Password Login Flow Tests
 * Migrated from: cypress/e2e/auth/password-login.cy.ts
 */
test.describe('Password Login Flow', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {}); // Ignore all page errors
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Basic Login Flow', () => {
    test('should display login page elements correctly', async ({ page }) => {
      await visitLoginPage(page, 3000);

      // Check for login page title
      await expect(page.getByText('Welcome to AppFlowy')).toBeVisible();

      // Check for email input by placeholder
      await expect(page.locator('input[placeholder*="email"]')).toBeVisible({ timeout: 10000 });
    });

    test('should allow entering email and navigating to password page', async ({
      page,
    }) => {
      const testEmail = generateRandomEmail();

      await visitLoginPage(page, 3000);

      // Find and fill email input
      const emailInput = page.locator('input[placeholder*="email" i]');
      await expect(emailInput).toBeVisible({ timeout: 10000 });
      await emailInput.fill(testEmail);
      await expect(emailInput).toHaveValue(testEmail);

      // Look for password button and click
      await page.getByRole('button', { name: /password/i }).click();

      // Verify navigation to password page
      await page.waitForTimeout(2000);
      await expect(page).toHaveURL(/enterPassword/);
    });
  });

  test.describe('Successful Authentication', () => {
    const mockSuccessfulLogin = async (
      page: any,
      testEmail: string,
      mockUserId: string,
      mockAccessToken: string,
      mockRefreshToken: string
    ) => {
      await page.route('**/api/user/verify/**', (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: { is_new: false },
            message: 'success',
          }),
        })
      );

      await page.route(/\/token\?grant_type=refresh_token/, (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: mockAccessToken,
            refresh_token: mockRefreshToken,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      );

      await page.route('**/api/user/profile*', (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              uid: 1,
              uuid: mockUserId,
              email: testEmail,
              name: 'Test User',
              metadata: { timezone: { default_timezone: 'UTC', timezone: 'UTC' } },
              encryption_sign: null,
              latest_workspace_id: uuidv4(),
              updated_at: Date.now(),
            },
            message: 'success',
          }),
        })
      );

      await page.route('**/api/user/workspace*', (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [], message: 'success' }),
        })
      );
    };

    test('should successfully login with email and password', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const testPassword = 'SecurePassword123!';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      // Mock the password authentication endpoint
      await page.route(`${gotrueUrl}/token?grant_type=password`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: mockAccessToken,
            refresh_token: mockRefreshToken,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: mockUserId,
              email: testEmail,
              email_confirmed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
        })
      );

      await mockSuccessfulLogin(page, testEmail, mockUserId, mockAccessToken, mockRefreshToken);

      // Visit login page
      await visitLoginPage(page);

      // Enter email and go to password page
      await goToPasswordStep(page, testEmail, { waitMs: 1000, assertEmailInUrl: true });

      // Enter password
      await AuthSelectors.passwordInput(page).fill(testPassword);
      await page.waitForTimeout(500);

      // Submit password
      const loginPromise = page.waitForResponse(`${gotrueUrl}/token?grant_type=password`);
      await AuthSelectors.passwordSubmitButton(page).click();

      // Wait for API call
      const loginResponse = await loginPromise;
      expect(loginResponse.status()).toBe(200);

      // Verify successful login
      await expect(page).toHaveURL(/\/app/, { timeout: 10000 });
    });

    test('should handle login with mock API using flexible selectors', async ({
      page,
    }) => {
      const testEmail = generateRandomEmail();
      const testPassword = 'TestPassword123!';
      const mockAccessToken = 'mock-token-' + uuidv4();
      const mockRefreshToken = 'refresh-' + mockAccessToken;
      const mockUserId = uuidv4();

      // Mock the authentication endpoint
      await page.route('**/token?grant_type=password', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: mockAccessToken,
            refresh_token: mockRefreshToken,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: mockUserId, email: testEmail },
          }),
        })
      );

      await mockSuccessfulLogin(page, testEmail, mockUserId, mockAccessToken, mockRefreshToken);

      // Navigate directly to password page
      await visitAuthPath(
        page,
        `/login?action=enterPassword&email=${encodeURIComponent(testEmail)}`,
        { waitMs: 3000 }
      );

      // Look for password input and type
      const passwordInput = page.locator('input[type="password"]');
      await expect(passwordInput).toBeVisible({ timeout: 10000 });
      await passwordInput.fill(testPassword);

      // Find and click submit button
      const authPromise = page.waitForResponse('**/token?grant_type=password');
      await page.getByRole('button', { name: /continue/i }).click();

      // Wait for authentication
      await authPromise;

      // Verify successful login
      await expect(page).toHaveURL(/\/app/, { timeout: 10000 });
    });
  });

  test.describe('Error Handling', () => {
    test('should show error for invalid email format', async ({ page }) => {
      const invalidEmail = 'not-an-email';

      await visitLoginPage(page, 3000);

      // Enter invalid email
      await page.locator('input[placeholder*="email" i]').fill(invalidEmail);

      // Try to proceed with password login
      await page.getByRole('button', { name: /password/i }).click();

      // Check for error message
      await expect(page.getByText('Please enter a valid email address')).toBeVisible({
        timeout: 5000,
      });
    });

    test('should handle incorrect password error', async ({ page }) => {
      const testEmail = 'test@appflowy.io';
      const wrongPassword = 'WrongPassword123!';

      // Mock failed authentication
      await page.route(`${gotrueUrl}/token?grant_type=password`, (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Invalid login credentials',
            msg: 'Incorrect password. Please try again.',
          }),
        })
      );

      await visitLoginPage(page);

      // Enter email and go to password page
      await goToPasswordStep(page, testEmail);

      // Enter wrong password and submit
      await AuthSelectors.passwordInput(page).fill(wrongPassword);
      await AuthSelectors.passwordSubmitButton(page).click();

      // Wait for failed API call
      await page.waitForResponse(`${gotrueUrl}/token?grant_type=password`);

      // Verify error message
      await expect(page.getByText('Invalid login credentials')).toBeVisible();

      // Verify still on password page
      await expect(page).toHaveURL(/action=enterPassword/);
    });

    test('should handle network errors gracefully', async ({ page }) => {
      const testEmail = 'network-error@appflowy.io';
      const testPassword = 'TestPassword123!';

      // Mock network error
      await page.route(`${gotrueUrl}/token?grant_type=password`, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
          }),
        })
      );

      await visitLoginPage(page);

      // Enter credentials
      await goToPasswordStep(page, testEmail);

      // Enter password and submit
      await AuthSelectors.passwordInput(page).fill(testPassword);
      await AuthSelectors.passwordSubmitButton(page).click();

      // Wait for network error
      await page.waitForResponse(`${gotrueUrl}/token?grant_type=password`);

      // Verify error handling - still on password page
      await expect(page).toHaveURL(/action=enterPassword/);

      // Verify user can retry
      await expect(AuthSelectors.passwordInput(page)).toBeVisible();
      await expect(AuthSelectors.passwordSubmitButton(page)).toBeVisible();
    });
  });

  test.describe('Login Flow Navigation', () => {
    test('should navigate between login steps correctly', async ({ page }) => {
      const testEmail = 'navigation-test@appflowy.io';

      await visitLoginPage(page);

      // Enter email and go to password page
      await goToPasswordStep(page, testEmail);

      // Verify on password page
      await expect(page).toHaveURL(/action=enterPassword/);
      await expect(page.getByText('Enter password')).toBeVisible();

      // Navigate back to login
      await page.getByText('Back to login').click();
      await page.waitForTimeout(1000);

      // Verify back on main login page
      await expect(page).not.toHaveURL(/action=/);
      await expect(AuthSelectors.emailInput(page)).toBeVisible();
    });
  });
});
