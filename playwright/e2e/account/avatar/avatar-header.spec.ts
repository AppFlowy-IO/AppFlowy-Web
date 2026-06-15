import { test, expect } from '@playwright/test';
import { PageSelectors, SpaceSelectors, WorkspaceSelectors } from '../../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { testLog } from '../../../support/test-helpers';

/**
 * Avatar Header Display Tests
 * Migrated from: cypress/e2e/account/avatar/avatar-header.cy.ts
 *
 * These tests verify that avatar images appear in the top-right header area
 * (collaborative users) after setting a workspace avatar and triggering awareness.
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
): Promise<{ avatar_url: string | null } | null> {
  return page.evaluate(
    ({ workspaceId, userUuid }) => {
      return new Promise<{ avatar_url: string | null } | null>((resolve, reject) => {
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

/**
 * Helper: expand first space, click first page, and trigger awareness by typing in editor
 */
async function openFirstPageAndTriggerAwareness(page: import('@playwright/test').Page) {
  // Expand first space
  const spaceItems = SpaceSelectors.items(page);
  const firstSpace = spaceItems.first();
  await firstSpace.waitFor({ state: 'visible', timeout: 10000 });

  const expanded = firstSpace.getByTestId('space-expanded');
  const isExpanded = await expanded.getAttribute('data-expanded');
  if (isExpanded !== 'true') {
    await firstSpace.getByTestId('space-name').first().click();
  }
  await page.waitForTimeout(1000);

  // Click first page
  await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });
  await PageSelectors.names(page).first().click({ force: true });
  await page.waitForTimeout(2000);

  // Type in editor to trigger awareness
  const editors = page.locator('[contenteditable="true"]');
  const editorCount = await editors.count();
  if (editorCount === 0) return;

  let editorFound = false;
  for (let i = 0; i < editorCount; i++) {
    const editor = editors.nth(i);
    const testId = await editor.getAttribute('data-testid');
    const className = await editor.getAttribute('class');
    if (!testId?.includes('title') && !className?.includes('editor-title')) {
      await editor.click({ force: true });
      await page.waitForTimeout(500);
      await editor.type(' ', { delay: 50 });
      editorFound = true;
      break;
    }
  }

  if (!editorFound) {
    await editors.last().click({ force: true });
    await page.waitForTimeout(500);
    await editors.last().type(' ', { delay: 50 });
  }

  await page.waitForTimeout(2000);
}

test.describe('Avatar Header Display', () => {
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

  test.describe('Header Avatar Display (Top Right Corner)', () => {
    test('should display avatar in header top right corner after setting workspace avatar', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl = 'https://api.dicebear.com/7.x/avataaars/svg?seed=header-test';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Set avatar via workspace member profile API');
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
      await page.reload();
      await page.waitForTimeout(3000);

      testLog.info('Step 3: Interact with editor to trigger collaborative user awareness');
      await openFirstPageAndTriggerAwareness(page);

      testLog.info('Step 4: Verify avatar appears in header top right corner');
      // Wait for header to be visible
      await expect(page.locator('.appflowy-top-bar')).toBeVisible();

      // Check if avatar container exists in header (collaborative users area)
      testLog.info('Header avatar area should be visible');
      const headerAvatarContainer = page
        .locator('.appflowy-top-bar')
        .locator('[class*="flex"][class*="-space-x-2"]')
        .first();
      await expect(headerAvatarContainer).toBeAttached();

      // Verify avatar image or fallback is present
      const headerAvatars = page.locator('.appflowy-top-bar [data-slot="avatar"]');
      const avatarCount = await headerAvatars.count();
      expect(avatarCount).toBeGreaterThanOrEqual(1);
    });

    test('should display emoji avatar in header when emoji is set', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const testEmoji = '\u{1F3A8}'; // paint palette emoji

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Set emoji avatar via API');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const response = await updateWorkspaceMemberAvatar(
        page,
        request,
        workspaceId!,
        testEmoji
      );
      expect(response.status()).toBe(200);

      await page.waitForTimeout(2000);
      await page.reload();
      await page.waitForTimeout(3000);

      testLog.info('Step 3: Interact with editor to trigger collaborative user awareness');
      await openFirstPageAndTriggerAwareness(page);

      testLog.info('Step 4: Verify emoji appears in header avatar fallback');
      await expect(page.locator('.appflowy-top-bar')).toBeVisible();

      testLog.info('Header should be visible with avatar area');
      const headerAvatarContainer = page
        .locator('.appflowy-top-bar')
        .locator('[class*="flex"][class*="-space-x-2"]')
        .first();
      await expect(headerAvatarContainer).toBeAttached();

      // Verify avatar appears in header
      const headerAvatars = page.locator('.appflowy-top-bar [data-slot="avatar"]');
      const avatarCount = await headerAvatars.count();
      expect(avatarCount).toBeGreaterThanOrEqual(1);

      // Verify emoji appears in fallback
      const headerAvatarFallback = page
        .locator('.appflowy-top-bar [data-slot="avatar"]')
        .first()
        .locator('[data-slot="avatar-fallback"]');
      await expect(headerAvatarFallback).toContainText(testEmoji);
    });

    test('should update header avatar when workspace member profile notification is received', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const testAvatarUrl =
        'https://api.dicebear.com/7.x/avataaars/svg?seed=header-notification';

      testLog.info('Step 1: Sign in with test account');
      await signInAndWaitForApp(page, request, testEmail);

      testLog.info('Step 2: Get user UUID and workspace ID');
      const workspaceId = await getCurrentWorkspaceId(page);
      expect(workspaceId).not.toBeNull();

      const userUuid = await getCurrentUserUuid(page);
      expect(userUuid).not.toBeNull();

      testLog.info('Step 3: Simulate workspace member profile changed notification');
      await page.evaluate(
        ({ userUuid, testAvatarUrl }) => {
          const emitter = (
            window as unknown as {
              __APPFLOWY_EVENT_EMITTER__?: { emit: (...args: unknown[]) => void };
            }
          ).__APPFLOWY_EVENT_EMITTER__;

          if (emitter) {
            emitter.emit('workspace-member-profile-changed', {
              userUuid,
              name: 'Test User',
              avatarUrl: testAvatarUrl,
            });
          }
        },
        { userUuid, testAvatarUrl }
      );

      await page.waitForTimeout(2000);

      testLog.info('Step 4: Verify avatar is updated in database');
      const profile = await getWorkspaceMemberProfile(page, workspaceId!, userUuid!);
      expect(profile).not.toBeNull();
      expect(profile?.avatar_url).toBe(testAvatarUrl);

      testLog.info('Step 5: Interact with editor to trigger collaborative user awareness');
      await openFirstPageAndTriggerAwareness(page);

      testLog.info('Step 6: Verify header avatar area is visible and updated');
      await expect(page.locator('.appflowy-top-bar')).toBeVisible();
      const headerAvatarContainer = page
        .locator('.appflowy-top-bar')
        .locator('[class*="flex"][class*="-space-x-2"]')
        .first();
      await expect(headerAvatarContainer).toBeAttached();

      // Verify avatar appears in header
      const headerAvatars = page.locator('.appflowy-top-bar [data-slot="avatar"]');
      const avatarCount = await headerAvatars.count();
      expect(avatarCount).toBeGreaterThanOrEqual(1);

      testLog.info('Avatar container verified in header - database update confirmed in Step 4');
    });
  });
});
