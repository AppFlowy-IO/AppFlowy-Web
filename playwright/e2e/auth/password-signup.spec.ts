import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { visitAuthPath, visitLoginPage } from '../../support/auth-flow-helpers';

/**
 * Password Sign Up Flow Tests
 * Migrated from: cypress/e2e/auth/password-signup.cy.ts
 */

/** Local selectors with flexible fallbacks */
const SignUpSelectors = {
  emailInput: (page: any) =>
    page.locator('[data-testid="signup-email-input"], input[placeholder*="email" i]').first(),
  passwordInput: (page: any) =>
    page.locator('[data-testid="signup-password-input"], input[type="password"]').first(),
  confirmPasswordInput: (page: any) =>
    page.locator('[data-testid="signup-confirm-password-input"], input[type="password"]').last(),
  submitButton: (page: any) =>
    page.locator('[data-testid="signup-submit-button"], button:has-text("Sign Up")').first(),
  backToLoginButton: (page: any) =>
    page.getByTestId('signup-back-to-login-button'),
  createAccountButton: (page: any) =>
    page.getByTestId('login-create-account-button'),
};

test.describe('Password Sign Up Flow', () => {
  const { gotrueUrl } = TestConfig;

  const visitSignUpPage = async (page: any) => {
    await visitAuthPath(page, '/login?action=signUpPassword', { waitMs: 0 });
    await expect(SignUpSelectors.emailInput(page)).toBeVisible({ timeout: 10000 });
  };

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {});
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Sign Up Page Elements', () => {
    test('should display sign-up page elements correctly', async ({ page }) => {
      await visitSignUpPage(page);

      await expect(SignUpSelectors.emailInput(page)).toBeVisible();
      await expect(SignUpSelectors.passwordInput(page)).toBeVisible();
      await expect(SignUpSelectors.confirmPasswordInput(page)).toBeVisible();
      await expect(SignUpSelectors.submitButton(page)).toBeVisible();
      await expect(SignUpSelectors.submitButton(page)).toBeDisabled();
      await expect(SignUpSelectors.backToLoginButton(page)).toBeVisible();
    });

    test('should navigate from login page to sign-up page', async ({ page }) => {
      await visitLoginPage(page, 0);

      await expect(SignUpSelectors.createAccountButton(page)).toBeVisible();
      await SignUpSelectors.createAccountButton(page).click();

      await expect(page).toHaveURL(/action=signUpPassword/);
      await expect(SignUpSelectors.emailInput(page)).toBeVisible();
    });

    test('should navigate back to login page from sign-up page', async ({ page }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.backToLoginButton(page).click();

      await expect(page).not.toHaveURL(/action=signUpPassword/);
      await expect(SignUpSelectors.createAccountButton(page)).toBeVisible();
    });
  });

  test.describe('Form Validation', () => {
    test('should show error for invalid email format', async ({ page }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill('not-an-email');
      await SignUpSelectors.passwordInput(page).fill('ValidPass1!');
      await SignUpSelectors.confirmPasswordInput(page).fill('ValidPass1!');

      // Force click to trigger validation
      await SignUpSelectors.submitButton(page).click({ force: true });

      await expect(page.getByText('Please enter a valid email address')).toBeVisible();
    });

    test('should show error for weak password - missing uppercase', async ({ page }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(generateRandomEmail());
      await SignUpSelectors.passwordInput(page).fill('weakpass1!');
      await SignUpSelectors.passwordInput(page).blur();

      await expect(page.getByText(/uppercase/i)).toBeVisible();
    });

    test('should show error for weak password - missing special character', async ({
      page,
    }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(generateRandomEmail());
      await SignUpSelectors.passwordInput(page).fill('WeakPass1');
      await SignUpSelectors.passwordInput(page).blur();

      await expect(page.getByText(/special/i)).toBeVisible();
    });

    test('should show error for password too short', async ({ page }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(generateRandomEmail());
      await SignUpSelectors.passwordInput(page).fill('Ab1!');
      await SignUpSelectors.passwordInput(page).blur();

      await expect(page.getByText(/6 characters/i)).toBeVisible();
    });

    test('should show error when passwords do not match', async ({ page }) => {
      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(generateRandomEmail());
      await SignUpSelectors.passwordInput(page).fill('ValidPass1!');
      await SignUpSelectors.confirmPasswordInput(page).fill('DifferentPass1!');
      await SignUpSelectors.confirmPasswordInput(page).blur();

      await expect(page.getByText(/match/i)).toBeVisible();
    });

    test('should enable submit button when all fields are valid', async ({ page }) => {
      await visitSignUpPage(page);

      await expect(SignUpSelectors.submitButton(page)).toBeDisabled();

      await SignUpSelectors.emailInput(page).fill(generateRandomEmail());
      await SignUpSelectors.passwordInput(page).fill('ValidPass1!');
      await SignUpSelectors.confirmPasswordInput(page).fill('ValidPass1!');

      await expect(SignUpSelectors.submitButton(page)).not.toBeDisabled();
    });
  });

  test.describe('Successful Sign Up', () => {
    const mockSuccessfulSignUp = async (page: any, testEmail: string, mockUserId: string) => {
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();

      await page.route(`${gotrueUrl}/signup`, (route: any) =>
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

      await page.route('**/api/user/update', (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: null, message: 'success' }),
        })
      );

      await page.route('**/api/user/verify/**', (route: any) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: { is_new: true }, message: 'success' }),
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
    };

    test('should successfully sign up with valid credentials', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';
      const mockUserId = uuidv4();

      await mockSuccessfulSignUp(page, testEmail, mockUserId);

      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(testEmail);
      await SignUpSelectors.passwordInput(page).fill(validPassword);
      await SignUpSelectors.confirmPasswordInput(page).fill(validPassword);

      const signUpPromise = page.waitForResponse(`${gotrueUrl}/signup`);
      await expect(SignUpSelectors.submitButton(page)).not.toBeDisabled();
      await SignUpSelectors.submitButton(page).click();

      const signUpResponse = await signUpPromise;
      expect(signUpResponse.status()).toBe(200);

      // Verify redirect to app
      await expect(page).toHaveURL(/\/app(?:\?|$)/, { timeout: 15000 });
    });
  });

  test.describe('Error Handling', () => {
    test('should handle email already registered error (422)', async ({ page }) => {
      const testEmail = 'existing@appflowy.io';
      const validPassword = 'ValidPass1!';

      await page.route(`${gotrueUrl}/signup`, (route) =>
        route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'user_already_exists',
            error_description: 'User already registered',
            msg: 'This email is already registered',
          }),
        })
      );

      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(testEmail);
      await SignUpSelectors.passwordInput(page).fill(validPassword);
      await SignUpSelectors.confirmPasswordInput(page).fill(validPassword);
      await SignUpSelectors.submitButton(page).click();

      await page.waitForResponse(`${gotrueUrl}/signup`);

      await expect(page.getByText(/already registered/i)).toBeVisible();
      await expect(page).toHaveURL(/action=signUpPassword/);
    });

    test('should handle rate limit error (429)', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';

      await page.route(`${gotrueUrl}/signup`, (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'rate_limit_exceeded',
            error_description: 'Too many requests',
            msg: 'Too many requests, please try again later.',
          }),
        })
      );

      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(testEmail);
      await SignUpSelectors.passwordInput(page).fill(validPassword);
      await SignUpSelectors.confirmPasswordInput(page).fill(validPassword);
      await SignUpSelectors.submitButton(page).click();

      await page.waitForResponse(`${gotrueUrl}/signup`);

      await expect(page.getByText(/Too many requests/i)).toBeVisible({ timeout: 5000 });
    });

    test('should handle network/server errors gracefully', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const validPassword = 'ValidPass1!';

      await page.route(`${gotrueUrl}/signup`, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
          }),
        })
      );

      await visitSignUpPage(page);

      await SignUpSelectors.emailInput(page).fill(testEmail);
      await SignUpSelectors.passwordInput(page).fill(validPassword);
      await SignUpSelectors.confirmPasswordInput(page).fill(validPassword);
      await SignUpSelectors.submitButton(page).click();

      await page.waitForResponse(`${gotrueUrl}/signup`);

      await expect(page).toHaveURL(/action=signUpPassword/);
      await expect(SignUpSelectors.emailInput(page)).toBeVisible();
      await expect(SignUpSelectors.submitButton(page)).toBeVisible();
    });
  });
});
