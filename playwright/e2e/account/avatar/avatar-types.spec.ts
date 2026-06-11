import { test, expect } from '@playwright/test';
import { PageSelectors, SpaceSelectors, WorkspaceSelectors } from '../../../support/selectors';
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

/** Helper: open a page and type in the editor so the header awareness avatar is rendered */
async function openFirstPageAndTriggerAwareness(page: import('@playwright/test').Page) {
  const firstSpace = SpaceSelectors.items(page).first();

  await firstSpace.waitFor({ state: 'visible', timeout: 10000 });

  const expanded = firstSpace.getByTestId('space-expanded');
  const isExpanded = await expanded.getAttribute('data-expanded');

  if (isExpanded !== 'true') {
    await firstSpace.getByTestId('space-name').first().click();
  }

  await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });
  await PageSelectors.names(page).first().click({ force: true });
  await page.waitForTimeout(2000);

  const editors = page.locator('[contenteditable="true"]');
  const editorCount = await editors.count();

  for (let index = 0; index < editorCount; index += 1) {
    const editor = editors.nth(index);
    const testId = await editor.getAttribute('data-testid');
    const className = await editor.getAttribute('class');

    if (testId?.includes('title') || className?.includes('editor-title')) {
      continue;
    }

    await editor.click({ force: true });
    await editor.type(' ', { delay: 50 });
    return;
  }

  if (editorCount > 0) {
    await editors.last().click({ force: true });
    await editors.last().type(' ', { delay: 50 });
  }
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
    const emojiAvatars = ['\u{1F3A8}', '\u{1F680}', '\u{2B50}', '\u{1F3AF}']; // paint, rocket, star, target

    testLog.info('Step 1: Sign in with test account');
    await signInAndWaitForApp(page, request, testEmail);

    testLog.info('Step 2: Test each emoji avatar');
    const workspaceId = await getCurrentWorkspaceId(page);
    expect(workspaceId).not.toBeNull();

    for (const emoji of emojiAvatars) {
      const response = await updateWorkspaceMemberAvatar(page, request, workspaceId!, emoji);
      expect(response.status()).toBe(200);

      await expect
        .poll(async () => {
          const profileResponse = await getWorkspaceMemberProfile(page, request, workspaceId!);
          if (profileResponse.status() !== 200) return null;
          const body = await profileResponse.json();
          return body?.data?.avatar_url ?? null;
        })
        .toBe(emoji);

      await page.reload();
      await expect(page.locator('.appflowy-top-bar')).toBeVisible();
      await openFirstPageAndTriggerAwareness(page);

      const headerAvatarFallback = page
        .locator('.appflowy-top-bar [data-slot="avatar"]')
        .first()
        .locator('[data-slot="avatar-fallback"]');

      await expect(headerAvatarFallback).toContainText(emoji);
    }
  });
});
