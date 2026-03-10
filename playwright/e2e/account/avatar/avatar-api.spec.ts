import { test, expect } from '@playwright/test';
import { AvatarUiSelectors, WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar API Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-api.cy.ts
 *
 * These tests verify avatar upload/display via API calls.
 *
 * TODO: The following Cypress helpers are not yet available in Playwright support:
 * - updateUserMetadata (from cypress/support/api-utils.ts)
 * - AvatarSelectors (avatar-specific selectors from cypress/support/avatar-selectors.ts)
 * - dbUtils (IndexedDB utils from cypress/support/db-utils.ts)
 * Tests are marked as test.skip until these helpers are migrated.
 */

/** Helper: get access token from localStorage */
async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const tokenStr = localStorage.getItem('token');
    if (!tokenStr) throw new Error('No token found in localStorage');
    const token = JSON.parse(tokenStr);
    return token.access_token;
  });
}

/** Helper: update user metadata (icon_url) via API */
async function updateUserMetadata(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  iconUrl: string
) {
  const accessToken = await getAccessToken(page);
  return request.post(`${TestConfig.apiUrl}/api/user/update`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      metadata: {
        icon_url: iconUrl,
      },
    },
    failOnStatusCode: false,
  });
}

/** Helper: open workspace dropdown then account settings */
async function openAccountSettings(page: import('@playwright/test').Page) {
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await page.waitForTimeout(1000);
  const settingsButton = page.getByTestId('account-settings-button');
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.getByTestId('account-settings-dialog')).toBeVisible();
}

/** Helper: reload page and open account settings */
async function reloadAndOpenAccountSettings(page: import('@playwright/test').Page) {
  await page.reload();
  await page.waitForTimeout(3000);
  await openAccountSettings(page);
}

test.describe('Avatar API', () => {
  test.beforeEach(async ({ page }) => {
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

  test.describe('Avatar Upload via API', () => {
    test('should update avatar URL via API and display in UI', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=test';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Update avatar via API');
      const response = await updateUserMetadata(page, request, testAvatarUrl);
      testLog.info(`API Response status: ${response.status()}`);
      expect(response.status()).toBe(200);

      testLog.info('Step 3: Reload page to see updated avatar');
      await reloadAndOpenAccountSettings(page);

      testLog.info('Step 4: Verify avatar image is displayed in Account Settings');
      // Wait for any avatar image to be present and loaded
      // The AvatarImage component loads asynchronously and sets opacity to 0 while loading
      const avatarImages = AvatarUiSelectors.image(page);
      await expect(avatarImages.first()).toBeVisible({ timeout: 10000 });

      // Verify that at least one avatar image has loaded (non-zero opacity and non-empty src)
      const foundVisible = await page.evaluate(() => {
        const imgs = document.querySelectorAll('[data-testid="avatar-image"]');
        for (const img of imgs) {
          const el = img as HTMLElement;
          const opacity = window.getComputedStyle(el).opacity;
          const src = el.getAttribute('src') || '';
          if (opacity !== '0' && src.length > 0) {
            return true;
          }
        }
        return false;
      });
      expect(foundVisible, 'At least one avatar image should be visible').toBeTruthy();

      // Verify that the avatar image has loaded (check for non-empty src and visible state)
      const foundLoaded = await page.evaluate(() => {
        const imgs = document.querySelectorAll('[data-testid="avatar-image"]');
        for (const img of imgs) {
          const el = img as HTMLElement;
          const opacity = parseFloat(window.getComputedStyle(el).opacity || '0');
          const src = el.getAttribute('src') || '';
          if (opacity > 0 && src.length > 0) {
            return true;
          }
        }
        return false;
      });
      expect(foundLoaded, 'At least one avatar image should be loaded and visible').toBeTruthy();
    });

    test('test direct API call', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=test';

      testLog.info('========== Step 1: Sign in with test account ==========');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('========== Step 2: Get token from localStorage ==========');
      const tokenStr = await page.evaluate(() => localStorage.getItem('token'));
      testLog.info(`Token string: ${tokenStr ? 'Found' : 'Not found'}`);
      const token = JSON.parse(tokenStr!);
      const accessToken = token.access_token;
      testLog.info(
        `Access token: ${accessToken ? 'Present (length: ' + accessToken.length + ')' : 'Missing'}`
      );

      testLog.info('========== Step 3: Making API request ==========');
      testLog.info(`URL: ${TestConfig.apiUrl}/api/user/update`);
      testLog.info(`Avatar URL: ${testAvatarUrl}`);

      const response = await updateUserMetadata(page, request, testAvatarUrl);

      testLog.info('========== Step 4: Checking response ==========');
      testLog.info(`Response status: ${response.status()}`);
      const body = await response.json();
      testLog.info(`Response body: ${JSON.stringify(body)}`);

      expect(response).not.toBeNull();
      expect(response.status()).toBe(200);

      if (body) {
        testLog.info(`Response body code: ${body.code}`);
        testLog.info(`Response body message: ${body.message}`);
      }
    });

    test('should display emoji as avatar via API', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testEmoji = '\u{1F3A8}'; // paint palette emoji

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Update avatar to emoji via API');
      const response = await updateUserMetadata(page, request, testEmoji);
      expect(response).not.toBeNull();
      expect(response.status()).toBe(200);

      testLog.info('Step 3: Reload page');
      await reloadAndOpenAccountSettings(page);

      testLog.info('Step 4: Verify emoji is displayed in fallback');
      const avatarFallback = page.locator('[data-slot="avatar-fallback"]');
      await expect(avatarFallback.first()).toContainText(testEmoji);
    });

    test('should display fallback character when no avatar is set', async ({ page, request }) => {
      const testEmail = generateRandomEmail();

      testLog.info('Step 1: Sign in with test account (no avatar set)');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Open workspace dropdown to see avatar');
      await WorkspaceSelectors.dropdownTrigger(page).click();
      await page.waitForTimeout(500);

      testLog.info('Step 3: Verify fallback is displayed in workspace dropdown avatar');
      const workspaceDropdownAvatar = page.locator(
        '[data-testid="workspace-dropdown-trigger"] [data-slot="avatar"]'
      );
      const avatarFallback = workspaceDropdownAvatar.locator('[data-slot="avatar-fallback"]');
      await expect(avatarFallback).toBeVisible();
    });
  });
});
