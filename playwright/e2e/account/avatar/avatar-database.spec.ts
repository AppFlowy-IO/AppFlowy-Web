import { test, expect } from '@playwright/test';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar Database Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-database.cy.ts
 *
 * These tests verify that avatar data is correctly stored in the
 * workspace_member_profiles table (IndexedDB).
 *
 * TODO: dbUtils (IndexedDB helpers from cypress/support/db-utils.ts) are
 * reimplemented inline using page.evaluate() for Playwright.
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
  workspace_id: string;
  user_uuid: string;
  avatar_url: string | null;
  name: string;
} | null> {
  return page.evaluate(
    ({ workspaceId, userUuid }) => {
      return new Promise<{
        workspace_id: string;
        user_uuid: string;
        avatar_url: string | null;
        name: string;
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

test.describe('Avatar Database', () => {
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

  test.describe('Database Verification', () => {
    test('should store avatar in workspace_member_profiles table', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=db-test';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Set avatar via API');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const response = await updateWorkspaceMemberAvatar(
        page,
        request,
        workspaceId!,
        testAvatarUrl
      );
      expect(response.status()).toBe(200);

      await page.waitForTimeout(3000);

      testLog.info('Step 3: Verify avatar is stored in database');
      const userUuid = await getCurrentUserUuid(page);
      expect(userUuid).not.toBeNull();

      const profile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(profile).not.toBeNull();
      expect(profile?.avatar_url).toBe(testAvatarUrl);
      expect(profile?.workspace_id).toBe(workspaceId);
      expect(profile?.user_uuid).toBe(userUuid);
    });
  });
});
