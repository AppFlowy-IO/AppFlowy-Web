import { test, expect } from '@playwright/test';
import { WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar Notifications Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-notifications.cy.ts
 *
 * These tests verify that avatar updates are correctly handled when
 * workspace member profile notifications are received via the event emitter.
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

/** Helper: get current user UUID from token in localStorage */
async function getCurrentUserUuid(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const tokenStr = localStorage.getItem('token');
    if (!tokenStr) return null;
    const token = JSON.parse(tokenStr);
    return token?.user?.id || null;
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

/** Helper: get workspace member profile from IndexedDB */
async function getWorkspaceMemberProfile(
  page: import('@playwright/test').Page,
  workspaceId: string,
  userUuid: string
): Promise<{
  avatar_url: string | null;
  name: string;
  workspace_id: string;
  user_uuid: string;
} | null> {
  return page.evaluate(
    ({ workspaceId, userUuid }) => {
      return new Promise<{
        avatar_url: string | null;
        name: string;
        workspace_id: string;
        user_uuid: string;
      } | null>((resolve, reject) => {
        const dbName = 'af_database_cache';
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          try {
            const transaction = db.transaction(['workspace_member_profiles'], 'readonly');
            const store = transaction.objectStore('workspace_member_profiles');
            const getReq = store.get([workspaceId, userUuid]);

            getReq.onsuccess = () => {
              resolve(getReq.result || null);
            };

            getReq.onerror = () => {
              reject(getReq.error);
            };

            transaction.oncomplete = () => {
              db.close();
            };
          } catch {
            db.close();
            resolve(null);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    },
    { workspaceId, userUuid }
  );
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

/** Helper: emit workspace member profile changed event */
async function emitProfileChangedEvent(
  page: import('@playwright/test').Page,
  payload: { userUuid: string | null; name: string; avatarUrl?: string }
) {
  await page.evaluate(
    ({ payload }) => {
      const emitter = (
        window as unknown as {
          __APPFLOWY_EVENT_EMITTER__?: { emit: (...args: unknown[]) => void };
        }
      ).__APPFLOWY_EVENT_EMITTER__;

      if (emitter) {
        emitter.emit('workspace-member-profile-changed', payload);
      }
    },
    { payload }
  );
}

test.describe('Avatar Notifications', () => {
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

  test.describe('Workspace Member Profile Notifications', () => {
    test('should update avatar when workspace member profile notification is received', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl =
        'https://api.dicebear.com/7.x/avataaars/svg?seed=notification-test';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Get user UUID and workspace ID');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const userUuid = await getCurrentUserUuid(page);
      expect(userUuid).not.toBeNull();

      testLog.info('Step 3: Simulate workspace member profile changed notification');
      await emitProfileChangedEvent(page, {
        userUuid,
        name: 'Test User',
        avatarUrl: testAvatarUrl,
      });

      await page.waitForTimeout(2000);

      testLog.info('Step 4: Verify avatar is updated in database');
      const profile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(profile).not.toBeNull();
      expect(profile?.avatar_url).toBe(testAvatarUrl);

      testLog.info('Step 5: Reload page and verify avatar persists');
      await reloadAndOpenAccountSettings(page);

      testLog.info('Step 6: Verify avatar image uses updated URL');
      const avatarImage = page.locator('[data-testid="avatar-image"]');
      await expect(avatarImage).toBeAttached();
      await expect(avatarImage).toHaveAttribute('src', testAvatarUrl);
    });

    test('should preserve existing avatar when notification omits avatar field', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const existingAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=existing';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Set initial avatar via API');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const response = await updateWorkspaceMemberAvatar(
        page,
        request,
        workspaceId!,
        existingAvatarUrl
      );
      expect(response.status()).toBe(200);

      await page.waitForTimeout(2000);

      testLog.info('Step 3: Get user UUID and workspace ID');
      const userUuid = await getCurrentUserUuid(page);
      expect(userUuid).not.toBeNull();

      testLog.info('Step 4: Verify initial avatar is set');
      const initialProfile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(initialProfile?.avatar_url).toBe(existingAvatarUrl);

      testLog.info('Step 5: Simulate notification without avatar field');
      await emitProfileChangedEvent(page, {
        userUuid,
        name: 'Updated Name',
        // avatarUrl is undefined - should preserve existing
      });

      await page.waitForTimeout(2000);

      testLog.info('Step 6: Verify avatar is preserved');
      const updatedProfile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(updatedProfile?.avatar_url).toBe(existingAvatarUrl);
      expect(updatedProfile?.name).toBe('Updated Name');
    });

    test('should clear avatar when notification sends empty string', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=to-clear';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Set initial avatar');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const response = await updateWorkspaceMemberAvatar(
        page,
        request,
        workspaceId!,
        testAvatarUrl
      );
      expect(response.status()).toBe(200);

      await page.waitForTimeout(2000);

      const userUuid = await getCurrentUserUuid(page);
      expect(userUuid).not.toBeNull();

      testLog.info('Step 3: Simulate notification with empty avatar');
      await emitProfileChangedEvent(page, {
        userUuid,
        name: 'Test User',
        avatarUrl: '', // Empty string should clear avatar
      });

      await page.waitForTimeout(2000);

      testLog.info('Step 4: Verify avatar is cleared');
      const profile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(profile?.avatar_url).toBeNull();
    });
  });
});
