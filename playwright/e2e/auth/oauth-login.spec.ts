import { test, expect } from '@playwright/test';
import { TestConfig } from '../../support/test-config';

/**
 * Real Authentication Login Tests
 * Migrated from: cypress/e2e/auth/oauth-login.cy.ts
 *
 * These tests verify the login flow using real credentials.
 * Uses password-based authentication via GoTrue.
 */
test.describe('Real Authentication Login', () => {
  // Run tests serially — the password-change test mutates shared account state
  test.describe.configure({ mode: 'serial' });

  const { gotrueUrl, apiUrl } = TestConfig;

  // Test account credentials
  const testEmail = 'db_blob_user@appflowy.io';
  const testPassword = 'AppFlowy!@123';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot read properties of undefined') ||
        err.message.includes('WebSocket') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    // Clear localStorage before each test
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
  });

  test('should login with email and password successfully', async ({ page, request }) => {
    // Step 1: Get access token via password grant
    const tokenResponse = await request.post(`${gotrueUrl}/token?grant_type=password`, {
      data: { email: testEmail, password: testPassword },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    });
    expect(tokenResponse.status()).toBe(200);

    const tokenData = await tokenResponse.json();
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.refresh_token).toBeTruthy();

    // Step 2: Verify user with AppFlowy backend
    const verifyResponse = await request.get(
      `${apiUrl}/api/user/verify/${tokenData.access_token}`,
      { failOnStatusCode: false, timeout: 30000 }
    );
    expect([200, 201]).toContain(verifyResponse.status());

    // Step 3: Store token in localStorage
    await page.evaluate((data) => {
      localStorage.setItem('token', JSON.stringify(data));
    }, tokenData);

    // Step 4: Visit the app
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    // Step 5: Verify we're logged in
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);

    // Step 6: Wait for app to load and verify no redirect loop
    await page.waitForTimeout(5000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page).not.toHaveURL(/\/login/);

    // Step 7: Verify token is still in localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
  });

  test('should persist session after page reload', async ({ page, request }) => {
    // Step 1: Login first
    const tokenResponse = await request.post(`${gotrueUrl}/token?grant_type=password`, {
      data: { email: testEmail, password: testPassword },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(tokenResponse.status()).toBe(200);
    const tokenData = await tokenResponse.json();

    // Verify user
    await request.get(`${apiUrl}/api/user/verify/${tokenData.access_token}`, {
      failOnStatusCode: false,
    });

    // Store token
    await page.evaluate((data) => {
      localStorage.setItem('token', JSON.stringify(data));
    }, tokenData);

    // Visit app
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    // Step 2: Reload the page
    await page.reload();

    // Step 3: Verify still logged in after reload
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page).not.toHaveURL(/\/login/);

    // Step 4: Verify token still exists
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).not.toBeNull();
  });

  test('should redirect to login when token is invalid', async ({ page }) => {
    // Step 1: Set an invalid token in localStorage
    await page.evaluate(() => {
      localStorage.setItem(
        'token',
        JSON.stringify({
          access_token: 'invalid-token-12345',
          refresh_token: 'invalid-refresh-12345',
          expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired
        })
      );
    });

    // Step 2: Try to visit the app
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    // Step 3: Should be redirected to login
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
  });

  test('should change password, login with new password, then revert', async ({
    page,
    request,
  }) => {
    const originalPassword = testPassword;
    const newPassword = 'NewAppFlowy!@456';
    let passwordChanged = false;
    let latestAccessToken = '';

    // Step 1: Login with original password
    const loginResponse = await request.post(`${gotrueUrl}/token?grant_type=password`, {
      data: { email: testEmail, password: originalPassword },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginResponse.status()).toBe(200);
    latestAccessToken = (await loginResponse.json()).access_token;

    try {
      // Step 2: Change password to new password
      const changeResponse = await request.put(`${gotrueUrl}/user`, {
        headers: {
          Authorization: `Bearer ${latestAccessToken}`,
          'Content-Type': 'application/json',
        },
        data: { password: newPassword },
      });
      expect(changeResponse.status()).toBe(200);
      passwordChanged = true;

      // Step 3: Verify old password no longer works
      const oldPasswordResponse = await request.post(
        `${gotrueUrl}/token?grant_type=password`,
        {
          data: { email: testEmail, password: originalPassword },
          headers: { 'Content-Type': 'application/json' },
          failOnStatusCode: false,
        }
      );
      expect(oldPasswordResponse.status()).toBe(400);

      // Step 4: Login with new password
      const newLoginResponse = await request.post(
        `${gotrueUrl}/token?grant_type=password`,
        {
          data: { email: testEmail, password: newPassword },
          headers: { 'Content-Type': 'application/json' },
        }
      );
      expect(newLoginResponse.status()).toBe(200);
      latestAccessToken = (await newLoginResponse.json()).access_token;

      // Step 5: Store token and verify app access
      await page.evaluate((data) => {
        localStorage.setItem('token', JSON.stringify(data));
      }, await newLoginResponse.json());

      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    } finally {
      // Always revert password if it was changed, even if test assertions fail
      if (passwordChanged) {
        // If we don't have a token from the new password, try to get one
        if (!latestAccessToken) {
          const recovery = await request.post(`${gotrueUrl}/token?grant_type=password`, {
            data: { email: testEmail, password: newPassword },
            headers: { 'Content-Type': 'application/json' },
            failOnStatusCode: false,
          });
          if (recovery.ok()) {
            latestAccessToken = (await recovery.json()).access_token;
          }
        }

        if (latestAccessToken) {
          await request.put(`${gotrueUrl}/user`, {
            headers: {
              Authorization: `Bearer ${latestAccessToken}`,
              'Content-Type': 'application/json',
            },
            data: { password: originalPassword },
          });
        }
      }
    }

    // Step 7: Verify original password works again
    const finalLoginResponse = await request.post(
      `${gotrueUrl}/token?grant_type=password`,
      {
        data: { email: testEmail, password: originalPassword },
        headers: { 'Content-Type': 'application/json' },
      }
    );
    expect(finalLoginResponse.status()).toBe(200);
  });
});
