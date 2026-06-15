import { test, expect } from '@playwright/test';
import { WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar Types Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-types.cy.ts
 *
 * These tests verify that HTTPS avatar URLs and emoji avatars are
 * handled correctly.
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

/** Helper: get current workspace ID from URL */
async function getCurrentWorkspaceId(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const urlMatch = window.location.pathname.match(/\/app\/([^/]+)/);
    return urlMatch ? urlMatch[1] : null;
  });
}

/** Helper: update workspace member avatar via API */
async function updateWorkspaceMemberAvatar(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  workspaceId: string,
  avatarUrl: string,
  name: string = 'Test User'
) {
  const accessToken = await getAccessToken(page);
  return request.put(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/update-member-profile`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      name,
      avatar_url: avatarUrl,
    },
    failOnStatusCode: false,
  });
}

/** Helper: get current user's workspace member profile via API */
async function getWorkspaceMemberProfile(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  workspaceId: string
) {
  const accessToken = await getAccessToken(page);
  return request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/workspace-profile`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });
}

/** Helper: open workspace dropdown then account settings */
async function openAccountSettings(page: import('@playwright/test').Page) {
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await page.waitForTimeout(1000);
  const settingsButton = page.getByTestId('settings-button');
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

/** Helper: open the Profile panel inside settings */
async function openProfileSettings(page: import('@playwright/test').Page) {
  await openAccountSettings(page);
  const dialog = page.getByTestId('settings-dialog');
  await dialog.getByTestId('settings-menu-profile').click();
  await expect(dialog.getByTestId('profile-display-name-input')).toBeVisible();
  return dialog;
}

/** Helper: reload page and open profile settings */
async function reloadAndOpenProfileSettings(page: import('@playwright/test').Page) {
  await page.reload();
  await expect(page.locator('.appflowy-top-bar')).toBeVisible();
  return openProfileSettings(page);
}

test.describe('Avatar Types', () => {
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

  test('should handle HTTPS avatar URL', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const httpsAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=https';

    testLog.info('Step 1: Sign in with test account');
    await signInAndWaitForApp(page, request, testEmail);

    testLog.info('Step 2: Test HTTPS avatar URL');
    const workspaceId = await getCurrentWorkspaceId(page);
    expect(workspaceId).not.toBeNull();

    const response = await updateWorkspaceMemberAvatar(page, request, workspaceId!, httpsAvatar);
    expect(response.status()).toBe(200);

    await expect
      .poll(async () => {
        const profileResponse = await getWorkspaceMemberProfile(page, request, workspaceId!);
        if (profileResponse.status() !== 200) return null;
        const body = await profileResponse.json();
        return body?.data?.avatar_url ?? null;
      })
      .toBe(httpsAvatar);

    const dialog = await reloadAndOpenProfileSettings(page);
    const avatarImage = dialog.getByTestId('avatar-image');
    await expect(avatarImage).toBeAttached();
    await expect(avatarImage).toHaveAttribute('src', httpsAvatar);
  });

  test('should handle emoji avatars correctly', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const emojiAvatar = '\u{1F3A8}'; // paint palette emoji

    testLog.info('Step 1: Sign in with test account');
    await signInAndWaitForApp(page, request, testEmail);

    testLog.info('Step 2: Test emoji avatar');
    const workspaceId = await getCurrentWorkspaceId(page);
    expect(workspaceId).not.toBeNull();

    const response = await updateWorkspaceMemberAvatar(page, request, workspaceId!, emojiAvatar);
    expect(response.status()).toBe(200);

    await expect
      .poll(async () => {
        const profileResponse = await getWorkspaceMemberProfile(page, request, workspaceId!);
        if (profileResponse.status() !== 200) return null;
        const body = await profileResponse.json();
        return body?.data?.avatar_url ?? null;
      })
      .toBe(emojiAvatar);

    const dialog = await reloadAndOpenProfileSettings(page);
    const profileAvatarFallback = dialog
      .locator('[data-slot="avatar"]')
      .first()
      .locator('[data-slot="avatar-fallback"]');

    await expect(profileAvatarFallback).toContainText(emojiAvatar);
  });
});
