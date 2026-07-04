/**
 * Publish Database Views Test
 *
 * When a database has multiple views (Grid, Board, etc.) and one view is
 * published, the database container should appear in the published page
 * sidebar and all sibling database views should appear in the database tab bar.
 */
import { test, expect, Page } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  ShareSelectors,
  SidebarSelectors,
  PageSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { getActiveDatabaseViewId, withPublishedDatabaseView } from '../../support/publish-database-helpers';
import { testLog } from '../../support/test-helpers';

async function publishCurrentPage(page: Page): Promise<string> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);

  const popover = ShareSelectors.sharePopover(page);

  await expect(popover).toBeVisible({ timeout: 5000 });
  await popover.getByText('Publish', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);

  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible();
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled();
  await ShareSelectors.publishConfirmButton(page).click({ force: true });
  await page.waitForTimeout(5000);

  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });
  const origin = new URL(page.url()).origin;
  const namespace = (await ShareSelectors.publishNamespace(page).textContent() ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();
  const publishedUrl = `${origin}/${namespace}/${publishName}`;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  return publishedUrl;
}

async function addViewViaButton(page: Page, viewType: 'Board' | 'Calendar') {
  const addBtn = DatabaseViewSelectors.addViewButton(page);

  await addBtn.scrollIntoViewIfNeeded();
  await expect(addBtn).toBeVisible({ timeout: 5000 });
  await addBtn.click();
  await page.waitForTimeout(300);

  const menuItem = page.getByRole('menuitem', { name: viewType });

  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.click({ force: true });
  await page.waitForTimeout(3000);
}

function suppressBenignErrors(page: Page) {
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
}

test.describe('Publish Database with Multiple Views', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('published database should show all sibling views in sidebar and tab bar', async ({
    page,
    request,
    browser,
  }) => {
    suppressBenignErrors(page);
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
    testLog.info('Grid database created');

    // When: adding a Board view to the same database
    testLog.info('Adding Board view');
    await addViewViaButton(page, 'Board');
    await expect(
      page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Board' })
    ).toBeVisible({ timeout: 5000 });
    testLog.info('Board view added');

    // And: switching back to the Grid tab before publishing
    const gridTab = DatabaseViewSelectors.viewTab(page).first();

    await gridTab.click({ force: true });
    await page.waitForTimeout(2000);
    await waitForGridReady(page);

    // When: typing text into the first cell to have identifiable data
    const testText = `Row1-${Date.now()}`;

    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type(testText);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    // Wait for sync, reload to ensure persistence
    await page.reload();
    await page.waitForTimeout(5000);
    await expect(DatabaseGridSelectors.grid(page)).toContainText(testText, { timeout: 15000 });
    testLog.info('Row data persisted');

    const activeDatabaseViewId = await getActiveDatabaseViewId(page);

    // When: publishing the database page
    testLog.info('Publishing database page');
    const publishedUrl = withPublishedDatabaseView(await publishCurrentPage(page), activeDatabaseViewId);

    testLog.info(`Published URL: ${publishedUrl}`);

    // ---- Open the published URL in a FRESH browser context ----
    testLog.info('Opening published page in fresh browser context');
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    suppressBenignErrors(freshPage);
    await freshPage.setViewportSize({ width: 1280, height: 720 });
    await freshPage.goto(publishedUrl, { waitUntil: 'load' });
    await freshPage.waitForTimeout(8000);

    // Then: the published page renders the database
    const dbContainer = freshPage.locator('.appflowy-database');

    await expect(dbContainer).toBeVisible({ timeout: 15000 });
    testLog.info('Database visible on published page');

    // And: the row data is visible
    await expect(dbContainer).toContainText(testText, { timeout: 10000 });
    testLog.info('Row data visible');

    // And: the database tab bar shows BOTH Grid and Board tabs in correct order
    const viewTabs = freshPage.locator('[data-testid^="view-tab-"]');

    await expect(viewTabs).toHaveCount(2, { timeout: 10000 });
    const tabTexts = await viewTabs.allTextContents();

    testLog.info(`Tab texts: ${JSON.stringify(tabTexts)}`);
    expect(tabTexts.some(t => t.includes('Grid'))).toBeTruthy();
    expect(tabTexts.some(t => t.includes('Board'))).toBeTruthy();
    testLog.info('Both Grid and Board tabs visible');

    // And: the sidebar keeps the database as a single container page.
    const outlineItems = freshPage.locator('[data-testid^="outline-item-"]');
    const outlineTexts = await outlineItems.allTextContents();

    testLog.info(`Outline item texts: ${JSON.stringify(outlineTexts)}`);
    expect(outlineTexts.some(t => t.includes('New Database'))).toBeTruthy();
    testLog.info('Sidebar shows the database container');

    // When: clicking the Board tab
    testLog.info('Clicking Board tab');
    const boardTab = viewTabs.filter({ hasText: 'Board' }).first();

    await boardTab.click({ force: true });
    await freshPage.waitForTimeout(2000);

    // Then: the database tab bar switches to the Board tab
    const activeTab = freshPage.locator(
      '[data-testid^="view-tab-"][data-state="active"]'
    );

    await expect(activeTab).toContainText('Board', { timeout: 5000 });
    testLog.info('Board tab is now active after tab click');

    // And: the URL has the ?v= parameter
    expect(freshPage.url()).toContain('v=');
    testLog.info('URL updated with v= parameter');

    // When: clicking the Grid tab
    testLog.info('Clicking Grid tab');
    const publishedGridTab = viewTabs.filter({ hasText: 'Grid' }).first();

    await publishedGridTab.click({ force: true });
    await freshPage.waitForTimeout(2000);

    // Then: the tab bar switches back to Grid
    await expect(activeTab).toContainText('Grid', { timeout: 5000 });
    testLog.info('Grid tab is now active after tab click');

    await freshContext.close();
  });
});
