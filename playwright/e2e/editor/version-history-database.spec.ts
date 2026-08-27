import { test, expect } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  HeaderSelectors,
  VersionHistorySelectors,
  DatabaseGridSelectors,
  RevertedDialogSelectors,
} from '../../support/selectors';
import { testLog } from '../../support/test-helpers';

/**
 * Version History — embedded database rendering
 *
 * Regression coverage for the bug where an embedded database inside a document
 * showed an infinite loading spinner when previewed in Version history. The
 * version-preview <Editor/> was not given `loadView`/`bindViewSync`, so the
 * embedded database could never load its collab doc.
 *
 * This is a BDD-style scenario against a seeded account/page:
 *   GIVEN a signed-in user on a document that embeds a database and has version history
 *   WHEN they open Version history
 *   THEN the embedded database renders (grid + rows) instead of spinning forever.
 *
 * Note: the preview intentionally shows the database's *live* data (databases are
 * separate collab objects not captured in the document snapshot), so this test
 * only asserts that the grid renders — not that it matches a historical state.
 */

// Seeded account + page. Overridable via env so CI can point at its own fixture.
const SEEDED_USER_EMAIL = process.env.SEEDED_USER_EMAIL || 'nathan@appflowy.io';
const SEEDED_USER_PASSWORD = process.env.SEEDED_USER_PASSWORD || 'AppFlowy!@123';
const SEEDED_WORKSPACE_ID = process.env.SEEDED_WORKSPACE_ID || '997c87ed-1667-4a62-8c0a-a74ee1aadb4b';
const SEEDED_VIEW_ID = process.env.SEEDED_VIEW_ID || 'da539c35-a852-434c-88a9-52fc086c1551';

test.describe('Version History — embedded database', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress uncaught exceptions from unrelated app code
    });

    await page.setViewportSize({ width: 1440, height: 960 });

    testLog.step(1, `Sign in as seeded user (${SEEDED_USER_EMAIL})`);
    await signInWithPasswordViaUi(page, SEEDED_USER_EMAIL, SEEDED_USER_PASSWORD);
  });

  test('renders the embedded database in the version-history preview (no infinite spinner)', async ({ page }) => {
    testLog.step(2, 'Open the seeded page that embeds a database');
    await page.goto(`/app/${SEEDED_WORKSPACE_ID}/${SEEDED_VIEW_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(new RegExp(`/app/${SEEDED_WORKSPACE_ID}/${SEEDED_VIEW_ID}`), {
      timeout: 30000,
    });

    // This shared fixture may have a pending restore notification from another
    // test client. Dismiss it and reload so this scenario starts from the
    // restored document instead of a pre-restore local cache.
    const revertedDialog = RevertedDialogSelectors.dialog(page);
    const hasRevertedDialog = await revertedDialog
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (hasRevertedDialog) {
      await RevertedDialogSelectors.confirmButton(page).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    // Confirm the page itself loaded with its embedded database (baseline).
    await expect(DatabaseGridSelectors.grid(page).first()).toBeVisible({ timeout: 30000 });

    testLog.step(3, 'Open the "More actions" menu and click Version history');
    await expect(HeaderSelectors.moreActionsButton(page)).toBeVisible({ timeout: 15000 });
    await HeaderSelectors.moreActionsButton(page).click();

    await expect(VersionHistorySelectors.menuItem(page)).toBeVisible({ timeout: 10000 });
    await VersionHistorySelectors.menuItem(page).click();

    testLog.step(4, 'Wait for the version-history modal and a selected version');
    const modal = VersionHistorySelectors.modal(page);
    await expect(modal).toBeVisible({ timeout: 15000 });
    // At least one version must exist for a preview to render.
    await expect(VersionHistorySelectors.items(page).first()).toBeVisible({ timeout: 15000 });

    // The shortest seeded snapshot used to leave the embedded database at
    // width: 0 because the preview had not overflowed when sizing first ran.
    const shortestVersionItem = VersionHistorySelectors.items(page).last();
    const shortestVersionTestId = await shortestVersionItem.getAttribute('data-testid');
    const shortestVersionId = shortestVersionTestId?.replace('version-history-item-', '');

    expect(shortestVersionId).toBeTruthy();
    await shortestVersionItem.click();
    await page.waitForFunction(
      (versionId) => (window as Window & { __TEST_DOC__?: { version?: string } }).__TEST_DOC__?.version === versionId,
      shortestVersionId
    );

    testLog.step(5, 'Assert the embedded database renders inside the preview');
    // The core regression assertion: the grid appears inside the modal.
    // Before the fix this never resolved (perpetual CircularProgress).
    const previewGrid = modal.getByTestId('database-grid');
    await expect(previewGrid).toBeVisible({ timeout: 30000 });

    testLog.step(6, 'Assert the preview grid actually has data rows');
    // The shared seeded view can persist collapsed groups. Expand them in the
    // preview so the row elements are rendered before asserting their content.
    const previewRows = previewGrid.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])');
    const collapsedGroupToggles = previewGrid.locator(
      '[data-testid="grid-group-collapse-toggle"][aria-expanded="false"]'
    );

    // database-grid mounts before its row and group metadata has hydrated. Do
    // not take an immediate zero toggle count as proof that the view is
    // ungrouped; wait until either a row or a collapsed group is rendered.
    await expect(previewRows.or(collapsedGroupToggles).first()).toBeVisible({ timeout: 30000 });

    while ((await collapsedGroupToggles.count()) > 0) {
      await collapsedGroupToggles.first().click();
    }

    await expect(previewRows.first()).toBeVisible({ timeout: 30000 });
    expect(await previewRows.count()).toBeGreaterThan(0);

    testLog.step(7, 'Close the version-history modal');
    await VersionHistorySelectors.closeButton(page).click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });
});
