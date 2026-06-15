import { test, expect } from '@playwright/test';
import { WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar Priority Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-priority.cy.ts
 *
 * These tests verify that workspace member avatar takes priority
 * over user metadata avatar when both are set.
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

test.describe('Avatar Priority', () => {
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

  test('should prioritize workspace avatar over user metadata avatar', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const userMetadataAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=user-metadata';
    const workspaceAvatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=workspace';

    testLog.info('Step 1: Sign in with test account');
    await signInAndWaitForApp(page, request, testEmail);

    testLog.info('Step 2: Set user metadata avatar');
    const userMetaResponse = await updateUserMetadata(page, request, userMetadataAvatar);
    expect(userMetaResponse.status()).toBe(200);

    await page.waitForTimeout(2000);

    testLog.info('Step 3: Set workspace member avatar');
    const workspaceId = await getCurrentWorkspaceId(page);
    expect(workspaceId).not.toBeNull();

    const workspaceResponse = await updateWorkspaceMemberAvatar(page, request, workspaceId!, workspaceAvatar);
    expect(workspaceResponse.status()).toBe(200);

    await expect
      .poll(async () => {
        const response = await getWorkspaceMemberProfile(page, request, workspaceId!);
        if (response.status() !== 200) return null;
        const body = await response.json();
        return body?.data?.avatar_url ?? null;
      })
      .toBe(workspaceAvatar);

    await page.reload();
    await expect(page.locator('.appflowy-top-bar')).toBeVisible();

    testLog.info('Step 4: Verify workspace avatar is displayed (priority)');
    const dialog = await openProfileSettings(page);

    // Workspace avatar should be displayed, not user metadata avatar
    const avatarImage = dialog.getByTestId('avatar-image');
    await expect(avatarImage).toBeAttached();
    await expect(avatarImage).toHaveAttribute('src', workspaceAvatar);
  });
});
