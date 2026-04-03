/**
 * Published Database Rows Visibility Test
 *
 * Reproduces GitHub issue: AppFlowy-IO/AppFlowy#8464
 * Bug: Database rows render as blank on published pages.
 *
 * Root cause: The web previously told the server to gather row data from its
 * own storage, but the server returned rows with empty cells. The desktop works
 * because it gathers all data locally and sends it. The fix makes the web
 * gather data client-side (like the desktop) via POST /{workspaceId}/publish.
 */
import { test, expect, Page } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  ShareSelectors,
  SidebarSelectors,
  PageSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { testLog } from '../../support/test-helpers';

/**
 * Publish the currently open page and return the published URL.
 */
async function publishCurrentPage(page: Page): Promise<string> {
  // Open share popover (use evaluate to bypass sticky header overlay)
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);

  // Switch to publish tab
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover).toBeVisible({ timeout: 5000 });
  await popover.getByText('Publish', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);

  // Click Publish button
  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible();
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled();
  await ShareSelectors.publishConfirmButton(page).click({ force: true });
  await page.waitForTimeout(5000);

  // Extract published URL
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });
  const origin = new URL(page.url()).origin;
  const namespace = (await ShareSelectors.publishNamespace(page).textContent() ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();
  const publishedUrl = `${origin}/${namespace}/${publishName}`;

  // Close popover
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  return publishedUrl;
}

test.describe('Published Database Rows Visibility (issue #8464)', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('published database grid should display row data in a fresh browser context', async ({
    page,
    request,
    browser,
  }) => {
    // Suppress benign errors during app session
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes('Record not found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });

    // Given: a signed-in user with the app fully loaded
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('Signed in');
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // When: creating a new Grid database
    testLog.info('Creating Grid database');
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Then: the grid is visible and ready
    await waitForGridReady(page);
    testLog.info('Grid database created and ready');

    // When: typing text into the first cell (primary field / title)
    const testText = `Row1-${Date.now()}`;

    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type(testText);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    testLog.info(`Entered row data: "${testText}"`);

    // Then: verify the data is visible in the grid before publishing
    await expect(DatabaseGridSelectors.grid(page)).toContainText(testText);
    testLog.info('Row data confirmed visible in app');

    // Wait for cell data to sync, then reload to ensure persistence
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForTimeout(5000);
    await expect(DatabaseGridSelectors.grid(page)).toContainText(testText, { timeout: 15000 });
    testLog.info('Row data persisted after reload');

    // When: publishing the database page
    testLog.info('Publishing database page');
    const publishedUrl = await publishCurrentPage(page);

    testLog.info(`Published URL: ${publishedUrl}`);

    // ---- Open the published URL in a FRESH browser context ----
    // This simulates a different user visiting the link with no prior IndexedDB data.
    testLog.info('Opening published page in fresh browser context');
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    await freshPage.setViewportSize({ width: 1280, height: 720 });

    // Collect useSyncInternal errors (second symptom of issue #8464)
    const syncContextErrors: string[] = [];

    freshPage.on('pageerror', (err) => {
      if (err.message.includes('useSyncInternal must be used within a SyncInternalProvider')) {
        syncContextErrors.push(err.message);
      }
    });

    // Suppress benign errors on the published page
    freshPage.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes('Record not found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await freshPage.goto(publishedUrl, { waitUntil: 'load' });
    await freshPage.waitForTimeout(8000);

    // Then: the published page renders the database container
    const dbContainer = freshPage.locator('.appflowy-database');

    await expect(dbContainer).toBeVisible({ timeout: 15000 });
    testLog.info('Database container visible on published page');

    // And: grid rows are present (not empty/undefined)
    const gridRows = freshPage.locator('[data-testid^="grid-row-"]');

    await expect(gridRows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await gridRows.count();

    testLog.info(`Found ${rowCount} grid rows on published page`);

    // And: the row data that was entered is visible in the published database
    // This is the core assertion — issue #8464 reports these rows are blank
    await expect(dbContainer).toContainText(testText, { timeout: 10000 });
    testLog.info('Row data is visible on published page');

    // And: no useSyncInternal context errors were thrown
    expect(syncContextErrors).toHaveLength(0);
    testLog.info('No useSyncInternal errors detected');

    await freshContext.close();
  });
});
