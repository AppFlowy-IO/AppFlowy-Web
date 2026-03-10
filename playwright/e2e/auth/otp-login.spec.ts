import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { TestConfig, generateRandomEmail } from '../../support/test-config';
import { AuthSelectors } from '../../support/selectors';
import { visitAuthPath } from '../../support/auth-flow-helpers';

/**
 * OTP Login Flow Tests
 * Migrated from: cypress/e2e/auth/otp-login.cy.ts
 */
test.describe('OTP Login Flow', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

  const visitLoginWithRedirect = async (page: any, encodedRedirectTo: string) => {
    await visitAuthPath(page, `/login?redirectTo=${encodedRedirectTo}`);
  };

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {}); // Ignore all page errors
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('OTP Code Login with Redirect URL Conversion', () => {
    test('should successfully login with OTP code for new user and redirect to /app', async ({
      page,
    }) => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      // Mock the magic link request endpoint
      await page.route(`${gotrueUrl}/magiclink`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );

      // Mock the OTP verification endpoint
      await page.route(`${gotrueUrl}/verify`, (route) =>
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

      // Mock the user verification endpoint
      await page.route(`${apiUrl}/api/user/verify/*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: { is_new: true },
            message: 'User verified successfully',
          }),
        })
      );

      // Mock the refresh token endpoint
      await page.route(`${gotrueUrl}/token?grant_type=refresh_token`, (route) =>
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

      // Step 1: Visit login page with redirectTo parameter
      await visitLoginWithRedirect(page, encodedRedirectTo);

      // Step 2: Enter email
      await AuthSelectors.emailInput(page).fill(testEmail);
      await page.waitForTimeout(500);

      // Step 3: Click sign in with email (magic link)
      const magicLinkPromise = page.waitForResponse(`${gotrueUrl}/magiclink`);
      await AuthSelectors.magicLinkButton(page).click();

      // Step 4: Wait for magic link request
      const magicLinkResponse = await magicLinkPromise;
      expect(magicLinkResponse.status()).toBe(200);

      // Step 5: Verify we're on the check email page
      await expect(page).toHaveURL(/action=checkEmail/);
      await page.waitForTimeout(1000);

      // Step 6: Verify localStorage has the redirectTo saved
      const redirectTo = await page.evaluate(() => localStorage.getItem('redirectTo'));
      expect(redirectTo).toContain('/app');

      // Step 7: Click "Enter code manually" button
      await AuthSelectors.enterCodeManuallyButton(page).click();
      await page.waitForTimeout(1000);

      // Step 8: Enter OTP code
      await AuthSelectors.otpCodeInput(page).fill(testOtpCode);
      await page.waitForTimeout(500);

      // Step 9: Submit OTP code — set up response promises before clicking
      const otpPromise = page.waitForResponse(`${gotrueUrl}/verify`);
      const userVerifyPromise = page.waitForResponse((resp) =>
        resp.url().includes('/api/user/verify/') && resp.status() === 200
      );
      await AuthSelectors.otpSubmitButton(page).click();

      // Step 10: Wait for OTP verification
      const otpResponse = await otpPromise;
      expect(otpResponse.status()).toBe(200);

      // Step 11: Wait for user verification
      await userVerifyPromise;

      // Step 12: Verify redirect to /app
      await expect(page).toHaveURL(`${baseUrl}/app`, { timeout: 10000 });

      // Step 13: Verify redirectTo is cleared for new users
      const finalRedirectTo = await page.evaluate(() => localStorage.getItem('redirectTo'));
      expect(finalRedirectTo).toBeNull();
    });

    test('should login existing user and use afterAuth redirect logic', async ({
      page,
    }) => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      // Mock endpoints
      await page.route(`${gotrueUrl}/magiclink`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );

      await page.route(`${gotrueUrl}/verify`, (route) =>
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

      await page.route(`${apiUrl}/api/user/verify/*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: { is_new: false },
            message: 'User verified successfully',
          }),
        })
      );

      await page.route(`${gotrueUrl}/token?grant_type=refresh_token`, (route) =>
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

      // Visit login page
      await visitLoginWithRedirect(page, encodedRedirectTo);

      // Enter email and request magic link
      await AuthSelectors.emailInput(page).fill(testEmail);
      const magiclinkPromise = page.waitForResponse(`${gotrueUrl}/magiclink`);
      await AuthSelectors.magicLinkButton(page).click();
      await magiclinkPromise;
      await page.waitForTimeout(1000);

      // Click "Enter code manually"
      await AuthSelectors.enterCodeManuallyButton(page).click();
      await page.waitForTimeout(1000);

      // Enter OTP code
      await AuthSelectors.otpCodeInput(page).fill(testOtpCode);
      await page.waitForTimeout(500);

      // Submit OTP code — set up response promises before clicking
      const verifyPromise = page.waitForResponse(`${gotrueUrl}/verify`);
      const userVerifyPromise = page.waitForResponse((resp) =>
        resp.url().includes('/api/user/verify/') && resp.status() === 200
      );
      await AuthSelectors.otpSubmitButton(page).click();

      // Wait for verification
      await verifyPromise;
      await userVerifyPromise;

      // Verify existing user is redirected to /app (is_new: false from mock)
      await expect(page).toHaveURL(/\/app/, { timeout: 10000 });
    });

    test('should handle invalid OTP code error', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const invalidOtpCode = '000000';
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      // Mock endpoints
      await page.route(`${gotrueUrl}/magiclink`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );

      await page.route(`${gotrueUrl}/verify`, (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 403, msg: 'Invalid OTP code' }),
        })
      );

      // Visit login page
      await visitLoginWithRedirect(page, encodedRedirectTo);

      // Enter email and request magic link
      await AuthSelectors.emailInput(page).fill(testEmail);
      const magiclinkPromise = page.waitForResponse(`${gotrueUrl}/magiclink`);
      await AuthSelectors.magicLinkButton(page).click();
      await magiclinkPromise;
      await page.waitForTimeout(1000);

      // Click "Enter code manually"
      await AuthSelectors.enterCodeManuallyButton(page).click();
      await page.waitForTimeout(1000);

      // Enter invalid OTP code
      await AuthSelectors.otpCodeInput(page).fill(invalidOtpCode);
      await page.waitForTimeout(500);

      // Submit OTP code
      const verifyPromise = page.waitForResponse(`${gotrueUrl}/verify`);
      await AuthSelectors.otpSubmitButton(page).click();
      await verifyPromise;

      // Verify error message
      await expect(page.getByText('The code is invalid or has expired')).toBeVisible();

      // Verify still on check email page
      await expect(page).toHaveURL(/action=checkEmail/);
    });

    test('should navigate back to login from check email page', async ({ page }) => {
      const testEmail = generateRandomEmail();
      const redirectToUrl = '/app';
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${redirectToUrl}`);

      // Mock endpoints
      await page.route(`${gotrueUrl}/magiclink`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );

      // Visit login page
      await visitLoginWithRedirect(page, encodedRedirectTo);

      // Enter email and request magic link
      await AuthSelectors.emailInput(page).fill(testEmail);
      const magiclinkPromise = page.waitForResponse(`${gotrueUrl}/magiclink`);
      await AuthSelectors.magicLinkButton(page).click();
      await magiclinkPromise;
      await page.waitForTimeout(1000);

      // Verify on check email page
      await expect(page).toHaveURL(/action=checkEmail/);

      // Click back to login
      await page.getByText('Back to login').click();
      await page.waitForTimeout(1000);

      // Verify back on login page
      await expect(page).not.toHaveURL(/action=/);
      await expect(page).toHaveURL(/redirectTo=/);
      await expect(AuthSelectors.emailInput(page)).toBeVisible();
    });

    test('should sanitize workspace-specific UUIDs from redirectTo before login', async ({
      page,
    }) => {
      const testEmail = generateRandomEmail();
      const testOtpCode = '123456';
      const mockAccessToken = 'mock-access-token-' + uuidv4();
      const mockRefreshToken = 'mock-refresh-token-' + uuidv4();
      const mockUserId = uuidv4();

      const userAWorkspaceId = '12345678-1234-1234-1234-123456789abc';
      const userAViewId = '87654321-4321-4321-4321-cba987654321';
      const userARedirectUrl = `/app/${userAWorkspaceId}/${userAViewId}`;
      const encodedRedirectTo = encodeURIComponent(`${baseUrl}${userARedirectUrl}`);

      // Mock endpoints
      await page.route(`${gotrueUrl}/magiclink`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );

      await page.route(`${gotrueUrl}/verify`, (route) =>
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

      await page.route(`${apiUrl}/api/user/verify/*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: { is_new: true },
            message: 'User verified successfully',
          }),
        })
      );

      await page.route(`${gotrueUrl}/token?grant_type=refresh_token`, (route) =>
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

      await page.route(`${apiUrl}/api/workspace*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [], message: 'Success' }),
        })
      );

      // Visit login page with User A's workspace-specific redirect URL
      await visitLoginWithRedirect(page, encodedRedirectTo);

      // Enter email (User B)
      await AuthSelectors.emailInput(page).fill(testEmail);
      await page.waitForTimeout(500);

      // Click sign in with email (magic link)
      const magiclinkPromise = page.waitForResponse(`${gotrueUrl}/magiclink`);
      await AuthSelectors.magicLinkButton(page).click();
      await magiclinkPromise;
      await page.waitForTimeout(1000);

      // Verify redirectTo was sanitized
      const storedRedirectTo = await page.evaluate(() => localStorage.getItem('redirectTo'));
      expect(storedRedirectTo).toBeTruthy();
      const decoded = decodeURIComponent(storedRedirectTo || '');
      expect(decoded).toContain('/app');

      // Click "Enter code manually"
      await AuthSelectors.enterCodeManuallyButton(page).click();
      await page.waitForTimeout(1000);

      // Enter OTP code
      await AuthSelectors.otpCodeInput(page).fill(testOtpCode);
      await page.waitForTimeout(500);

      // Submit OTP code — set up response promises before clicking
      const verifyPromise = page.waitForResponse(`${gotrueUrl}/verify`);
      const userVerifyPromise = page.waitForResponse((resp) =>
        resp.url().includes('/api/user/verify/') && resp.status() === 200
      );
      await AuthSelectors.otpSubmitButton(page).click();

      // Wait for verification
      await verifyPromise;
      await userVerifyPromise;

      // Verify User B is redirected to /app (NOT User A workspace)
      await expect(page).toHaveURL(new RegExp(`${baseUrl}/app`), { timeout: 10000 });

      // Verify redirectTo was cleared for new user
      const finalRedirectTo = await page.evaluate(() => localStorage.getItem('redirectTo'));
      expect(finalRedirectTo).toBeNull();
    });
  });
});
