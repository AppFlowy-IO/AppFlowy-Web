import { test, expect } from '@playwright/test';
import {
  HeaderSelectors,
  RevertedDialogSelectors,
  VersionHistorySelectors,
  EditorSelectors,
} from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import { AuthTestUtils } from '../../support/auth-utils';

/**
 * Document Version History Tests
 * Migrated from: cypress/e2e/editor/version-history.cy.ts
 *
 * Note: The original Cypress test used cy.session() for session caching and
 * Y.Doc snapshots via window.__TEST_DOC__. In Playwright, we use the
 * signInWithTestUrl pattern and evaluate() for window access.
 */

const APPFLOWY_BASE_URL = TestConfig.apiUrl;

/**
 * Get access token from localStorage.
 */
async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const tokenStr = localStorage.getItem('token');
    if (!tokenStr) throw new Error('No token found in localStorage');
    return JSON.parse(tokenStr).access_token;
  });
}

/**
 * Extract workspaceId and viewId from the current app URL.
 * Expected format: /app/{workspaceId}/{viewId}
 */
function parseAppUrl(url: string): { workspaceId: string; viewId: string } {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  if (segments.length < 3 || segments[0] !== 'app') {
    throw new Error(`Unexpected app URL format: ${url}`);
  }
  return { workspaceId: segments[1], viewId: segments[2] };
}

/**
 * Wait for the editor to expose __TEST_DOC__ and Y on the window,
 * then take a snapshot of the current Y.Doc and return it as base64.
 */
async function snapshotCurrentDoc(page: import('@playwright/test').Page): Promise<string> {
  // Wait until __TEST_DOC__ and Y are exposed
  await page.waitForFunction(
    () => {
      const win = window as any;
      return win.__TEST_DOC__ && win.Y;
    },
    { timeout: 30000 }
  );

  return page.evaluate(() => {
    const win = window as any;
    const doc = win.__TEST_DOC__;
    const YMod = win.Y;
    const snapshot = YMod.snapshot(doc);
    const encoded: Uint8Array = YMod.encodeSnapshot(snapshot);
    // Convert Uint8Array to base64
    const binary = Array.from(encoded)
      .map((b: number) => String.fromCharCode(b))
      .join('');
    return btoa(binary);
  });
}

/**
 * Extract the first version ID from the currently open version history modal.
 */
async function getVersionIdFromModal(
  page: import('@playwright/test').Page
): Promise<string> {
  const firstItem = VersionHistorySelectors.items(page).first();
  const testId = await firstItem.getAttribute('data-testid');
  if (!testId) throw new Error('No version item found in version history modal');
  return testId.replace('version-history-item-', '');
}

/**
 * Revert a document to a specific version via API.
 */
async function revertToVersion(
  request: import('@playwright/test').APIRequestContext,
  workspaceId: string,
  viewId: string,
  accessToken: string,
  versionId: string
): Promise<void> {
  await request.post(
    `${APPFLOWY_BASE_URL}/api/workspace/${workspaceId}/collab/${viewId}/revert`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        version: versionId,
        collab_type: 0,
      },
    }
  );
}

/**
 * POST a single version history entry to the cloud API.
 */
async function postVersion(
  request: import('@playwright/test').APIRequestContext,
  workspaceId: string,
  viewId: string,
  accessToken: string,
  name: string,
  snapshotBase64: string
): Promise<void> {
  await request.post(
    `${APPFLOWY_BASE_URL}/api/workspace/${workspaceId}/collab/${viewId}/history`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name,
        snapshot: snapshotBase64,
        collab_type: 0,
      },
    }
  );
}

// Skip: these tests require window.__TEST_DOC__ and window.Y globals
// which are only available in development builds, not CI production builds.
test.describe.skip('Document Version History', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page, request }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 900 });

    // Sign in and navigate to app
    await authUtils.signInWithTestUrl(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  });

  /**
   * Use the default document page and create version history entries.
   */
  async function createVersionsOnCurrentPage(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    versionCount = 4
  ): Promise<void> {
    testLog.step(1, 'Wait for editor to be ready');
    await expect(EditorSelectors.slateEditor(page)).toBeVisible();

    const edits = [
      'First version content.',
      'Second edit - adding more content.',
      'Third edit - even more content.',
      'Fourth edit - final content.',
    ];

    const accessToken = await getAccessToken(page);
    const { workspaceId, viewId } = parseAppUrl(page.url());

    testLog.step(2, `Create ${versionCount} version history entries via API`);

    for (let i = 0; i < Math.min(edits.length, versionCount); i++) {
      // Type content into the editor
      await EditorSelectors.firstEditor(page).click({ force: true });
      await page.keyboard.press('Enter');
      await page.keyboard.type(edits[i]);
      await page.waitForTimeout(1000);

      // Snapshot the live Y.Doc and POST the version
      const versionName = `Version ${i + 1}`;
      const snap = await snapshotCurrentDoc(page);
      await postVersion(request, workspaceId, viewId, accessToken, versionName, snap);
    }

    await page.waitForTimeout(1000);
  }

  /**
   * Open version history modal via the header "More actions" dropdown.
   */
  async function openVersionHistory(page: import('@playwright/test').Page): Promise<void> {
    testLog.info('Opening More Actions menu');
    await expect(HeaderSelectors.moreActionsButton(page)).toBeVisible();
    await HeaderSelectors.moreActionsButton(page).click();
    await page.waitForTimeout(500);

    testLog.info('Clicking Version History menu item');
    await expect(VersionHistorySelectors.menuItem(page)).toBeVisible();
    await VersionHistorySelectors.menuItem(page).click();
    await page.waitForTimeout(1000);

    testLog.info('Waiting for version history modal to appear');
    await expect(VersionHistorySelectors.modal(page)).toBeVisible({ timeout: 15000 });
  }

  test.describe('Version History Records', () => {
    test('should show version history records and allow selecting different versions', async ({
      page,
      request,
    }) => {
      await createVersionsOnCurrentPage(page, request, 4);

      testLog.step(3, 'Open version history');
      await openVersionHistory(page);

      testLog.step(4, 'Verify version list is visible and contains at least 4 entries');
      await expect(VersionHistorySelectors.list(page)).toBeVisible();
      const itemCount = await VersionHistorySelectors.items(page).count();
      expect(itemCount).toBeGreaterThanOrEqual(4);

      testLog.step(5, 'Select different versions and verify selection changes');
      // The first item should be selected by default
      await expect(VersionHistorySelectors.items(page).nth(0)).toHaveClass(/bg-fill-content-hover/);

      // Select the second version
      testLog.info('Selecting second version');
      await VersionHistorySelectors.items(page).nth(1).click();
      await page.waitForTimeout(2000);
      await expect(VersionHistorySelectors.items(page).nth(1)).toHaveClass(/bg-fill-content-hover/);

      // Select the third version
      testLog.info('Selecting third version');
      await VersionHistorySelectors.items(page).nth(2).click();
      await page.waitForTimeout(2000);
      await expect(VersionHistorySelectors.items(page).nth(2)).toHaveClass(/bg-fill-content-hover/);

      testLog.step(6, 'Close version history modal');
      await VersionHistorySelectors.closeButton(page).click();
      await expect(VersionHistorySelectors.modal(page)).not.toBeVisible();
    });
  });

  test.describe('Version Restore', () => {
    test('should restore a selected version', async ({ page, request }) => {
      await createVersionsOnCurrentPage(page, request, 4);

      testLog.step(3, 'Open version history');
      await openVersionHistory(page);

      testLog.step(4, 'Verify at least 2 versions exist');
      const itemCount = await VersionHistorySelectors.items(page).count();
      expect(itemCount).toBeGreaterThanOrEqual(2);

      testLog.step(5, 'Select the second version');
      await VersionHistorySelectors.items(page).nth(1).click();
      await page.waitForTimeout(2000);

      testLog.step(6, 'Click the Restore button');
      await expect(VersionHistorySelectors.restoreButton(page)).toBeVisible();
      await expect(VersionHistorySelectors.restoreButton(page)).toBeEnabled();
      await VersionHistorySelectors.restoreButton(page).click();

      testLog.step(7, 'Wait for restore to complete');
      // After a successful restore the modal closes.
      await expect(VersionHistorySelectors.modal(page)).not.toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);

      testLog.step(8, 'Verify document is still accessible');
      await expect(EditorSelectors.slateEditor(page)).toBeVisible();
    });
  });

  /**
   * Revert Dialog Tests
   *
   * These tests verify the popup dialog that appears when another device (desktop/mobile)
   * reverts the current document to a previous version.
   */
  test.describe('Revert Dialog', () => {
    test('should show dialog with correct content when document is reverted externally', async ({
      page,
      request,
    }) => {
      await createVersionsOnCurrentPage(page, request, 2);

      testLog.step(3, 'Open version history to find a version ID');
      await openVersionHistory(page);
      const itemCount = await VersionHistorySelectors.items(page).count();
      expect(itemCount).toBeGreaterThanOrEqual(1);

      testLog.step(4, 'Revert to the first version via API (simulates another device)');
      const accessToken = await getAccessToken(page);
      const { workspaceId, viewId } = parseAppUrl(page.url());
      const versionId = await getVersionIdFromModal(page);

      // Close the modal first so the dialog has a clean backdrop
      await VersionHistorySelectors.closeButton(page).click();
      await expect(VersionHistorySelectors.modal(page)).not.toBeVisible({ timeout: 5000 });

      // Trigger the revert via API (bypasses in-app UI -> sets isExternalRevert: true)
      await revertToVersion(request, workspaceId, viewId, accessToken, versionId);

      testLog.step(5, 'Assert the revert dialog appears automatically');
      await expect(RevertedDialogSelectors.dialog(page)).toBeVisible({ timeout: 15000 });

      testLog.step(6, 'Assert dialog title is "Page Restored"');
      const dialogTitle = RevertedDialogSelectors.dialog(page).locator(
        '[data-slot="dialog-title"]'
      );
      await expect(dialogTitle).toHaveText('Page Restored');

      testLog.step(7, 'Assert dialog description explains the external revert');
      await expect(RevertedDialogSelectors.dialog(page)).toContainText(
        'This page was restored to a previous version from another device.'
      );

      testLog.step(8, 'Assert "Got it" dismiss button is visible and labeled correctly');
      const confirmBtn = RevertedDialogSelectors.confirmButton(page);
      await expect(confirmBtn).toBeVisible();
      await expect(confirmBtn).toBeEnabled();
      await expect(confirmBtn).toContainText('Got it');
    });

    test('should dismiss dialog and restore editor when Got it is clicked', async ({
      page,
      request,
    }) => {
      await createVersionsOnCurrentPage(page, request, 2);

      await openVersionHistory(page);
      const itemCount = await VersionHistorySelectors.items(page).count();
      expect(itemCount).toBeGreaterThanOrEqual(1);

      const accessToken = await getAccessToken(page);
      const { workspaceId, viewId } = parseAppUrl(page.url());
      const versionId = await getVersionIdFromModal(page);

      await VersionHistorySelectors.closeButton(page).click();
      await expect(VersionHistorySelectors.modal(page)).not.toBeVisible({ timeout: 5000 });

      await revertToVersion(request, workspaceId, viewId, accessToken, versionId);

      // Wait for dialog to appear
      await expect(RevertedDialogSelectors.dialog(page)).toBeVisible({ timeout: 15000 });

      testLog.step(5, 'Click Got it to dismiss the dialog');
      await RevertedDialogSelectors.confirmButton(page).click();

      testLog.step(6, 'Assert the dialog is gone after dismissal');
      await expect(RevertedDialogSelectors.dialog(page)).not.toBeVisible();

      testLog.step(7, 'Assert the editor is still visible and functional after dismissal');
      await expect(EditorSelectors.slateEditor(page)).toBeVisible();
    });

    test('should NOT show dialog when user restores via the version history UI', async ({
      page,
      request,
    }) => {
      await createVersionsOnCurrentPage(page, request, 2);

      testLog.step(3, 'Open version history modal');
      await openVersionHistory(page);
      const itemCount = await VersionHistorySelectors.items(page).count();
      expect(itemCount).toBeGreaterThanOrEqual(2);

      testLog.step(4, 'Select the second version and click the in-app Restore button');
      await VersionHistorySelectors.items(page).nth(1).click();
      await page.waitForTimeout(2000);
      await expect(VersionHistorySelectors.restoreButton(page)).toBeVisible();
      await expect(VersionHistorySelectors.restoreButton(page)).toBeEnabled();
      await VersionHistorySelectors.restoreButton(page).click();

      testLog.step(5, 'Wait for the version history modal to close (restore complete)');
      await expect(VersionHistorySelectors.modal(page)).not.toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);

      testLog.step(6, 'Assert the revert dialog does NOT appear for user-initiated restore');
      // User initiated the restore through the UI -- dialog must NOT show
      await expect(RevertedDialogSelectors.dialog(page)).not.toBeVisible();

      testLog.step(7, 'Assert the editor remains functional');
      await expect(EditorSelectors.slateEditor(page)).toBeVisible();
    });
  });
});
