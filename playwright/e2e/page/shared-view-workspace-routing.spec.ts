import { test, expect, Page, APIRequestContext, Browser } from '@playwright/test';
import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createUserAccount } from '../../support/auth-utils';
import { testLog } from '../../support/test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page/flows';

/**
 * Shared View Cross-Workspace Routing Tests
 *
 * Verifies cross-workspace navigation when a guest receives a shared page
 * link from another user's workspace.
 *
 * Real-world scenario:
 *   1. Nathan (guest) is signed in and active in "Nathan Workspace A"
 *   2. Annie (owner) creates and shares a page in "Annie Workspace B"
 *   3. Nathan receives a direct link: /app/{annieWorkspaceId}/{viewId}
 *   4. Nathan navigates to the link — app should auto-switch to Annie's workspace
 *      and load the page without permission errors
 */

const isMac = process.platform === 'darwin';
const TEST_PAGE_NAME = 'Cross-Workspace Shared Page';
const TEST_PAGE_CONTENT = 'This page is shared across workspaces for routing verification.';

// ── Utility helpers ──────────────────────────────────────────────────

function workspaceIdFromUrl(url: string): string | null {
  const match = url.match(/\/app\/([^/]+)/);
  return match ? match[1] : null;
}

async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('af_auth_token') || '');
}

async function createPageWithContent(page: Page, title: string, content: string): Promise<string> {
  const viewId = await createDocumentPageAndNavigate(page);

  const titleInput = PageSelectors.titleInput(page).first();
  await expect(titleInput).toBeVisible({ timeout: 10000 });
  await titleInput.click({ force: true });
  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await titleInput.pressSequentially(title, { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const editor = page.locator(`#editor-${viewId}`);
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.click({ force: true });
  await page.keyboard.type(content, { delay: 20 });
  await page.waitForTimeout(2000);

  return viewId;
}

async function renameWorkspace(
  request: APIRequestContext, authToken: string, workspaceId: string, newName: string,
) {
  const response = await request.patch(`${TestConfig.apiUrl}/api/workspace`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    data: { workspace_id: workspaceId, workspace_name: newName },
  });
  if (!response.ok()) throw new Error(`Failed to rename workspace: ${response.status()}`);
}

async function renameUser(
  request: APIRequestContext, authToken: string, newName: string,
) {
  const response = await request.post(`${TestConfig.apiUrl}/api/user/update`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    data: { name: newName },
  });
  if (!response.ok()) throw new Error(`Failed to rename user: ${response.status()}`);
}

async function shareViewWithGuest(
  request: APIRequestContext, authToken: string,
  workspaceId: string, viewId: string, guestEmail: string,
) {
  const response = await request.put(
    `${TestConfig.apiUrl}/api/sharing/workspace/${workspaceId}/view`,
    {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      data: { view_id: viewId, emails: [guestEmail], access_level: 50, auto_confirm: true },
    },
  );
  if (!response.ok()) throw new Error(`Failed to share view: ${response.status()}`);
}

async function getUserProfile(request: APIRequestContext, authToken: string) {
  const resp = await request.get(`${TestConfig.apiUrl}/api/user/profile`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return (await resp.json()).data;
}

/** Wait for editor content with retry-on-reload for flaky workspace init.
 *  Cross-workspace navigation requires auto-switch (WorkspaceService.open) →
 *  outline reload → fallback view fetch → document load. The retry budget
 *  must stay under the 120s test timeout: 3 attempts × ~30s each = ~90s. */
async function waitForEditorContent(page: Page, maxAttempts = 3): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await expect(
        page.locator('[data-testid="editor-content"], [data-testid="page-title-input"]').first()
      ).toBeVisible({ timeout: 25000 });
      return;
    } catch {
      testLog.info(`Content not visible yet, reloading (attempt ${attempt + 1}/${maxAttempts})`);
      await page.reload();
      await page.waitForTimeout(2000);
    }
  }
  throw new Error('Editor content never became visible after retries');
}

// ── Setup: Annie creates and shares a page ───────────────────────────

async function annieCreatesAndSharesPage(
  browser: Browser, request: APIRequestContext, ownerEmail: string, guestEmail: string,
): Promise<{ ownerWorkspaceId: string; sharedViewId: string; directLink: string }> {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  setupPageErrorHandling(ownerPage);
  await signInAndWaitForApp(ownerPage, request, ownerEmail);

  await expect(SidebarSelectors.pageHeader(ownerPage)).toBeVisible({ timeout: 30000 });
  await expect(PageSelectors.names(ownerPage).first()).toBeVisible({ timeout: 30000 });
  await ownerPage.waitForTimeout(2000);

  const ownerWorkspaceId = workspaceIdFromUrl(ownerPage.url())!;
  const ownerToken = await getAuthToken(ownerPage);

  await renameWorkspace(request, ownerToken, ownerWorkspaceId, 'Annie Workspace B');
  await renameUser(request, ownerToken, 'Annie');
  testLog.info('Annie signed in, workspace renamed to "Annie Workspace B"');

  await ownerPage.reload();
  await expect(SidebarSelectors.pageHeader(ownerPage)).toBeVisible({ timeout: 30000 });
  await expect(PageSelectors.names(ownerPage).first()).toBeVisible({ timeout: 30000 });
  await ownerPage.waitForTimeout(2000);

  const sharedViewId = await createPageWithContent(ownerPage, TEST_PAGE_NAME, TEST_PAGE_CONTENT);
  testLog.info(`Annie created "${TEST_PAGE_NAME}" (${sharedViewId})`);

  await shareViewWithGuest(request, ownerToken, ownerWorkspaceId, sharedViewId, guestEmail);
  testLog.info(`Annie shared page with guest (auto_confirm=true)`);

  const directLink = `/app/${ownerWorkspaceId}/${sharedViewId}`;
  await ownerContext.close();
  return { ownerWorkspaceId, sharedViewId, directLink };
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Shared View Cross-Workspace Routing', () => {
  let ownerEmail: string;
  let guestEmail: string;

  test.beforeEach(async () => {
    ownerEmail = generateRandomEmail();
    guestEmail = generateRandomEmail();
  });

  test('should auto-switch workspace when guest opens a shared direct link', async ({
    context, browser, request,
  }) => {
    // Given: Nathan's account exists and Nathan is signed in to "Nathan Workspace A"
    await createUserAccount(request, guestEmail);
    await createUserAccount(request, ownerEmail);
    testLog.info('Both user accounts created');

    const guestPage = await context.newPage();
    setupPageErrorHandling(guestPage);
    await signInAndWaitForApp(guestPage, request, guestEmail);
    await expect(SidebarSelectors.pageHeader(guestPage)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(guestPage).first()).toBeVisible({ timeout: 30000 });
    testLog.info('Nathan signed in');

    // And: Nathan's workspace is renamed for visual clarity
    const guestWorkspaceId = workspaceIdFromUrl(guestPage.url())!;
    const guestToken = await getAuthToken(guestPage);
    await renameWorkspace(request, guestToken, guestWorkspaceId, 'Nathan Workspace A');
    await renameUser(request, guestToken, 'Nathan');
    await guestPage.reload();
    await expect(SidebarSelectors.pageHeader(guestPage)).toBeVisible({ timeout: 30000 });
    await guestPage.waitForTimeout(2000);
    testLog.info(`Nathan is active in "Nathan Workspace A" (${guestWorkspaceId})`);

    // And: Annie creates a page in her workspace and shares it with Nathan
    const { ownerWorkspaceId, directLink } = await annieCreatesAndSharesPage(
      browser, request, ownerEmail, guestEmail,
    );
    expect(ownerWorkspaceId).not.toBe(guestWorkspaceId);
    testLog.info(`Direct link to Annie's page: ${directLink}`);

    // When: Nathan navigates to the direct link (e.g. pasted from Slack)
    await guestPage.goto(directLink);
    testLog.info('Nathan navigated to the direct link');

    // Then: the URL should contain Annie's workspace ID (not Nathan's)
    const navigatedWorkspaceId = workspaceIdFromUrl(guestPage.url());
    expect(navigatedWorkspaceId).toBe(ownerWorkspaceId);
    testLog.info(`URL switched to Annie's workspace: ${navigatedWorkspaceId}`);

    // And: the shared page content should load without permission errors
    await waitForEditorContent(guestPage);
    testLog.info('Shared page loaded successfully');

    // Wait for the workspace auto-switch to fully settle. The app detects the
    // URL workspace differs from the selected workspace and calls
    // WorkspaceService.open() + loadUserWorkspaceInfo(), which can re-render
    // the page. Wait for the sidebar to show the correct workspace name as a
    // signal that the switch is complete.
    await expect(guestPage.locator('text=Annie Workspace B').first()).toBeVisible({ timeout: 30000 });
    testLog.info('Workspace switch settled');

    // And: Nathan can edit the document in Annie's workspace
    const contentText = guestPage.locator('text=This page is shared across workspaces');
    await expect(contentText.first()).toBeVisible({ timeout: 10000 });
    await contentText.first().click({ timeout: 30000 });
    await guestPage.keyboard.press('End');
    await guestPage.keyboard.press('Enter');
    await guestPage.keyboard.press('Enter');
    await guestPage.keyboard.type('Nathan was here - editing in Annie\'s workspace!', { delay: 30 });
    await guestPage.waitForTimeout(2000);
    testLog.info('Nathan typed content in the shared document');

    // And: the logged-in user is confirmed to be Nathan (not Annie)
    const profile = await getUserProfile(request, await getAuthToken(guestPage));
    testLog.info(`Logged-in user: name="${profile.name}", email="${profile.email}"`);
    expect(profile.name).toBe('Nathan');

    await guestPage.close();
  });

  test('should open shared link in new tab with correct workspace', async ({
    context, browser, request,
  }) => {
    // Given: Nathan is signed in to "Nathan Workspace A"
    await createUserAccount(request, guestEmail);
    await createUserAccount(request, ownerEmail);

    const guestPage = await context.newPage();
    setupPageErrorHandling(guestPage);
    await signInAndWaitForApp(guestPage, request, guestEmail);
    await expect(SidebarSelectors.pageHeader(guestPage)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(guestPage).first()).toBeVisible({ timeout: 30000 });
    testLog.info('Nathan signed in');

    const guestWorkspaceId = workspaceIdFromUrl(guestPage.url())!;
    const guestToken = await getAuthToken(guestPage);
    await renameWorkspace(request, guestToken, guestWorkspaceId, 'Nathan Workspace A');
    await renameUser(request, guestToken, 'Nathan');

    // And: Annie creates a page and shares it with Nathan
    const { ownerWorkspaceId, directLink } = await annieCreatesAndSharesPage(
      browser, request, ownerEmail, guestEmail,
    );
    expect(guestWorkspaceId).not.toBe(ownerWorkspaceId);
    testLog.info(`Annie's direct link: ${directLink}`);

    // When: Nathan opens the direct link in a new tab
    const newTab = await context.newPage();
    setupPageErrorHandling(newTab);
    await newTab.goto(directLink);
    testLog.info('Nathan opened direct link in new tab');

    // Then: the new tab URL should contain Annie's workspace ID
    const newTabWorkspaceId = workspaceIdFromUrl(newTab.url());
    expect(newTabWorkspaceId).toBe(ownerWorkspaceId);
    testLog.info(`New tab workspace: ${newTabWorkspaceId}`);

    // And: the shared page content should load
    await waitForEditorContent(newTab);
    testLog.info('Shared page loaded in new tab');

    await newTab.close();
    await guestPage.close();
  });

  test('should not load page when guest navigates with wrong workspace URL', async ({
    context, browser, request,
  }) => {
    // Given: Nathan is signed in to "Nathan Workspace A"
    await createUserAccount(request, guestEmail);
    await createUserAccount(request, ownerEmail);

    const guestPage = await context.newPage();
    setupPageErrorHandling(guestPage);
    await signInAndWaitForApp(guestPage, request, guestEmail);
    await expect(PageSelectors.names(guestPage).first()).toBeVisible({ timeout: 30000 });
    testLog.info('Nathan signed in');

    const guestWorkspaceId = workspaceIdFromUrl(guestPage.url())!;
    const guestToken = await getAuthToken(guestPage);
    await renameWorkspace(request, guestToken, guestWorkspaceId, 'Nathan Workspace A');
    await renameUser(request, guestToken, 'Nathan');

    // And: Annie creates a page and shares it with Nathan
    const { sharedViewId } = await annieCreatesAndSharesPage(
      browser, request, ownerEmail, guestEmail,
    );

    // When: Nathan navigates using his OWN workspace ID with the shared view ID
    // (this simulates the bug — wrong workspace + correct view ID)
    const wrongLink = `/app/${guestWorkspaceId}/${sharedViewId}`;
    testLog.info(`Navigating to wrong workspace URL: ${wrongLink}`);
    await guestPage.goto(wrongLink);
    await guestPage.waitForTimeout(5000);

    // Then: the page should show an error or not load normally
    const hasError = await guestPage
      .locator('[data-testid="error-page"], [data-testid="not-found"]')
      .count().then((c) => c > 0).catch(() => false);

    const hasNormalContent = await guestPage
      .locator('[data-testid="editor-content"], [data-testid="page-title-input"]')
      .first().isVisible({ timeout: 3000 }).catch(() => false);

    testLog.info(`Error page: ${hasError}, Normal content: ${hasNormalContent}`);
    expect(hasError || !hasNormalContent).toBeTruthy();
    testLog.info('Wrong workspace URL correctly prevented page access');

    await guestPage.close();
  });
});
