/**
 * Relation Cell Refresh Integration Test
 *
 * Reproduces a bug where relation cell content disappears after refreshing
 * the page. When navigating to "New Database" via the sidebar, the Relation
 * column correctly shows "Related DB content". But after a page reload the
 * cell becomes empty.
 *
 * Uses a pre-seeded account (pdf_db_relation@appflowy.io) with:
 *   - General > Getting started > New Database — grid with a Relation column
 *   - General > Getting started > Related DB — grid referenced by that column
 *   - First row of New Database has Relation = "Related DB content"
 */
import { test, expect } from '@playwright/test';
import {
  AuthSelectors,
  PageSelectors,
  DatabaseGridSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';
import { expandSpaceByName, expandPageByName } from '../../support/page-utils';

const TEST_EMAIL = 'pdf_db_relation@appflowy.io';
const TEST_PASSWORD = 'AppFlowy!@123';
const DATABASE_NAME = 'New Database';
const RELATED_DB_NAME = 'Related DB';
const GETTING_STARTED = 'Getting started';
const RELATION_CONTENT = 'Related DB content';

test.describe('Relation Cell Refresh', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1600, height: 900 });
  });

  test('relation cell content should persist after page refresh', async ({ page }) => {
    // ── Given: signed in with a pre-seeded account ────────────────────

    await page.addInitScript(() => {
      (window as any).Cypress = true;
    });

    await page.goto('/login', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    await expect(AuthSelectors.emailInput(page)).toBeVisible({ timeout: 30000 });
    await AuthSelectors.emailInput(page).fill(TEST_EMAIL);
    await page.waitForTimeout(500);

    await expect(AuthSelectors.passwordSignInButton(page)).toBeVisible();
    await AuthSelectors.passwordSignInButton(page).click();
    await page.waitForTimeout(1000);

    await expect(page).toHaveURL(/action=enterPassword/);
    await expect(AuthSelectors.passwordInput(page)).toBeVisible();
    await AuthSelectors.passwordInput(page).fill(TEST_PASSWORD);
    await page.waitForTimeout(500);
    await AuthSelectors.passwordSubmitButton(page).click();

    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(5000);
    await expect(PageSelectors.names(page).first()).toBeAttached({ timeout: 60000 });
    await page.waitForTimeout(3000);

    // ── And: sidebar expanded to show the databases ───────────────────

    await expandSpaceByName(page, 'General');
    await page.waitForTimeout(1000);
    await expandPageByName(page, GETTING_STARTED);
    await page.waitForTimeout(2000);

    // ── And: visit "Related DB" first to prime the local cache ────────
    // The relation cell resolves by loading the related database doc and
    // its row docs.  On a fresh browser (no IndexedDB), the related DB
    // data must be fetched at least once before the relation cell can
    // display anything.

    const relatedDbPage = PageSelectors.nameContaining(page, RELATED_DB_NAME).first();

    await expect(relatedDbPage).toBeVisible({ timeout: 15000 });
    await relatedDbPage.click({ force: true });
    await page.waitForTimeout(3000);
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // ── When: navigate to "New Database" ──────────────────────────────

    const databasePage = PageSelectors.nameContaining(page, DATABASE_NAME).first();

    await expect(databasePage).toBeVisible({ timeout: 15000 });
    await databasePage.click({ force: true });
    await page.waitForTimeout(3000);

    // Wait for grid to load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(5000);

    // ── Then: the relation cell should show "Related DB content" ──────

    const relationCell = page.locator('.relation-cell').first();

    await expect(relationCell).toContainText(RELATION_CONTENT, { timeout: 30000 });

    // ── When: refresh the current page ────────────────────────────────

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // Wait for grid to re-render after refresh
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
    await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(5000);

    // ── Then: the relation cell should still show "Related DB content" ─
    // BUG: After refresh, the relation cell content disappears.

    const relationCellAfterRefresh = page.locator('.relation-cell').first();

    await expect(relationCellAfterRefresh).toContainText(RELATION_CONTENT, {
      timeout: 30000,
    });
  });
});
