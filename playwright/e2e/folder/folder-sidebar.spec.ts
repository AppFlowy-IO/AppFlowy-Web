import { test, expect } from '@playwright/test';
import {
  PageSelectors,
  SidebarSelectors,
  byTestId,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { testLog } from '../../support/test-helpers';
import { expandSpaceByName, expandPageByName } from '../../support/page/flows';

/**
 * Sidebar bidirectional sync: main window <-> iframe
 * Migrated from: cypress/e2e/folder/sidebar-add-page-no-collapse.cy.ts
 *
 * Note: This test uses iframes for bidirectional sync testing.
 * In Playwright, iframe interactions use page.frameLocator() instead of
 * Cypress's getIframeBody() pattern.
 */

const SPACE_NAME = 'General';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChildInfo {
  viewId: string;
  name: string;
}

/**
 * Use the inline "+" button on a page in the MAIN window to add a child.
 * `menuItemIndex`: 0 = Document, 1 = Grid, 2 = Board, 3 = Calendar
 */
async function addChildInMainWindow(
  page: import('@playwright/test').Page,
  parentPageName: string,
  menuItemIndex: number
) {
  const parentItem = PageSelectors.itemByName(page, parentPageName);
  // Hover to reveal the inline add button
  await parentItem.locator('> div').first().hover({ force: true });
  await page.waitForTimeout(1000);

  // Click the inline "+" button
  await parentItem
    .locator('> div')
    .first()
    .locator(byTestId('inline-add-page'))
    .first()
    .click({ force: true });
  await page.waitForTimeout(1000);

  // Select layout from dropdown
  const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(dropdownContent).toBeVisible({ timeout: 5000 });
  await dropdownContent.locator('[role="menuitem"]').nth(menuItemIndex).click();
  await page.waitForTimeout(3000);

  // Dismiss any modal/dialog that opens
  const dialogCount = await page
    .locator('[role="dialog"], .MuiDialog-container')
    .count();
  if (dialogCount > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);
}

/**
 * Use the inline "+" button on a page in the IFRAME to add a child.
 */
async function addChildInIframe(
  page: import('@playwright/test').Page,
  iframeSelector: string,
  parentPageName: string,
  menuItemIndex: number
) {
  const frame = page.frameLocator(iframeSelector);

  // Hover over parent in iframe to reveal "+"
  const parentItem = frame
    .locator(`[data-testid="page-name"]:has-text("${parentPageName}")`)
    .first()
    .locator('xpath=ancestor::*[@data-testid="page-item"]')
    .first();
  await parentItem.locator('> div').first().hover({ force: true });
  await page.waitForTimeout(1000);

  // Click inline "+" button
  await parentItem.locator(byTestId('inline-add-page')).first().click({ force: true });
  await page.waitForTimeout(1000);

  // Select layout from the dropdown inside iframe
  const dropdownContent = frame.locator('[data-slot="dropdown-menu-content"]');
  await expect(dropdownContent).toBeVisible({ timeout: 5000 });
  await dropdownContent.locator('[role="menuitem"]').nth(menuItemIndex).click({ force: true });
  await page.waitForTimeout(3000);

  // Close any dialog in iframe
  const dialogCount = await frame.locator('[role="dialog"], .MuiDialog-container').count();
  if (dialogCount > 0) {
    // Press Escape on the main page (iframe shares keyboard)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // Check for "Back to home" button
  const backBtn = frame.locator('button:has-text("Back to home")');
  const backCount = await backBtn.count();
  if (backCount > 0) {
    await backBtn.first().click({ force: true });
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(1000);
}

/**
 * Collect direct child {viewId, name} under a parent in the main window.
 */
async function getChildrenInMainWindow(
  page: import('@playwright/test').Page,
  parentPageName: string
): Promise<ChildInfo[]> {
  const parentItem = PageSelectors.itemByName(page, parentPageName);
  const childrenContainer = parentItem.locator('> div').last();
  const pageItems = childrenContainer.locator(byTestId('page-item'));
  const count = await pageItems.count();

  const children: ChildInfo[] = [];
  for (let i = 0; i < count; i++) {
    const item = pageItems.nth(i);
    const name = ((await item.locator(byTestId('page-name')).first().textContent()) ?? '').trim();
    const testId = (await item.locator('> div').first().getAttribute('data-testid')) ?? '';
    const viewId = testId.startsWith('page-') ? testId.slice('page-'.length) : testId;
    children.push({ viewId, name });
  }
  return children;
}

/**
 * Collect direct child {viewId, name} under a parent in the iframe.
 */
async function getChildrenInIframe(
  page: import('@playwright/test').Page,
  iframeSelector: string,
  parentPageName: string
): Promise<ChildInfo[]> {
  const frame = page.frameLocator(iframeSelector);
  const parentItem = frame
    .locator(`[data-testid="page-name"]:has-text("${parentPageName}")`)
    .first()
    .locator('xpath=ancestor::*[@data-testid="page-item"]')
    .first();
  const childrenContainer = parentItem.locator('> div').last();
  const pageItems = childrenContainer.locator(byTestId('page-item'));
  const count = await pageItems.count();

  const children: ChildInfo[] = [];
  for (let i = 0; i < count; i++) {
    const item = pageItems.nth(i);
    const name = ((await item.locator(byTestId('page-name')).first().textContent()) ?? '').trim();
    const testId = (await item.locator('> div').first().getAttribute('data-testid')) ?? '';
    const viewId = testId.startsWith('page-') ? testId.slice('page-'.length) : testId;
    children.push({ viewId, name });
  }
  return children;
}

/**
 * Wait until a parent in the main window has at least `expectedCount` children.
 */
async function waitForMainWindowChildCount(
  page: import('@playwright/test').Page,
  parentPageName: string,
  expectedCount: number,
  maxAttempts = 30
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const children = await getChildrenInMainWindow(page, parentPageName);
    if (children.length >= expectedCount) {
      testLog.info(
        `Main window child count: ${children.length} (expected >= ${expectedCount})`
      );
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `Main window: child count under "${parentPageName}" did not reach ${expectedCount}`
  );
}

/**
 * Wait until a parent in the iframe has at least `expectedCount` children.
 */
async function waitForIframeChildCount(
  page: import('@playwright/test').Page,
  iframeSelector: string,
  parentPageName: string,
  expectedCount: number,
  maxAttempts = 30
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const children = await getChildrenInIframe(page, iframeSelector, parentPageName);
    if (children.length >= expectedCount) {
      testLog.info(
        `Iframe child count: ${children.length} (expected >= ${expectedCount})`
      );
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `Iframe: child count under "${parentPageName}" did not reach ${expectedCount}`
  );
}

/**
 * Log children summary.
 */
function logChildren(label: string, children: ChildInfo[]) {
  const summary = children.map((c) => `${c.name} [${c.viewId.slice(0, 8)}]`).join(', ');
  testLog.info(`${label} (${children.length}): ${summary}`);
}

/**
 * Assert that a list of children contains all expected view IDs.
 */
function assertContainsAllViewIds(
  children: ChildInfo[],
  expectedViewIds: string[],
  context: string
) {
  const currentViewIds = new Set(children.map((c) => c.viewId));
  for (const viewId of expectedViewIds) {
    expect(currentViewIds.has(viewId)).toBe(true);
  }
}

const IFRAME_SELECTOR = '#test-sync-iframe';
const RELOAD_MARKER = '__NO_RELOAD_MARKER__';

// =============================================================================
// Tests
// =============================================================================

test.describe('Sidebar bidirectional sync: main window <-> iframe', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection') ||
        err.message.includes('cancelled') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('_dEH') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('cross-origin')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('should sync sub-documents and sub-databases bidirectionally without sidebar collapse or reload', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const allCreatedViewIds: string[] = [];

    // ------------------------------------------------------------------
    // Step 1: Sign in and create a parent page
    // ------------------------------------------------------------------
    testLog.step(1, 'Sign in with a new user');
    await signInAndWaitForApp(page, request, testEmail);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

    testLog.step(2, 'Expand General space');
    await expandSpaceByName(page, SPACE_NAME);
    await page.waitForTimeout(1000);
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

    testLog.step(3, 'Create a parent page in General');
    await page.locator(byTestId('new-page-button')).first().click({ force: true });
    await page.waitForTimeout(1000);

    const newPageModal = page.locator(byTestId('new-page-modal'));
    await expect(newPageModal).toBeVisible();
    await newPageModal
      .locator(byTestId('space-item'))
      .filter({ hasText: SPACE_NAME })
      .click({ force: true });
    await page.waitForTimeout(500);

    await newPageModal.locator('button').filter({ hasText: 'Add' }).click({ force: true });
    await page.waitForTimeout(3000);

    // Dismiss any modal
    const dialogCount = await page
      .locator('[role="dialog"], .MuiDialog-container')
      .count();
    if (dialogCount > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    const parentPageName = 'Untitled';
    await expect(
      PageSelectors.nameContaining(page, parentPageName).first()
    ).toBeVisible({ timeout: 10000 });
    testLog.info(`Parent page "${parentPageName}" created`);

    // ------------------------------------------------------------------
    // Step 4: Open iframe FIRST, before creating any children
    // ------------------------------------------------------------------
    testLog.step(4, 'Create iframe with same app URL');

    // Install reload detection marker
    await page.evaluate((marker) => {
      (window as any)[marker] = true;
    }, RELOAD_MARKER);

    const appUrl = page.url();
    testLog.info(`App URL: ${appUrl}`);

    // Create the sync iframe
    await page.evaluate(
      ({ url, selector }) => {
        const iframe = document.createElement('iframe');
        iframe.id = selector.replace('#', '');
        iframe.src = url;
        iframe.style.cssText =
          'position:fixed;bottom:0;right:0;width:600px;height:400px;z-index:9999;border:2px solid blue;';
        document.body.appendChild(iframe);
      },
      { url: appUrl, selector: IFRAME_SELECTOR }
    );

    // Wait for iframe to load
    await page.waitForTimeout(5000);

    // Expand space in iframe
    testLog.info('Expanding space in iframe');
    const frame = page.frameLocator(IFRAME_SELECTOR);
    await frame
      .locator(`[data-testid="space-name"]:has-text("${SPACE_NAME}")`)
      .first()
      .click({ force: true });
    await page.waitForTimeout(1000);

    // ------------------------------------------------------------------
    // Step 5: MAIN WINDOW -> create sub-document #1
    // ------------------------------------------------------------------
    testLog.step(5, 'Main window: create sub-document #1');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    // Expand parent in main window to see the child
    await expandPageByName(page, parentPageName);

    let children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #1', children);
    expect(children.length).toBe(1);
    allCreatedViewIds.push(children[0].viewId);
    testLog.info(`Doc #1 viewId: ${children[0].viewId}`);

    // Verify it syncs to iframe - expand parent in iframe first
    testLog.info('Expanding parent in iframe');
    await frame
      .locator(`[data-testid="page-name"]:has-text("${parentPageName}")`)
      .first()
      .locator('xpath=ancestor::*[@data-testid="page-item"]')
      .first()
      .locator(byTestId('outline-toggle-expand'))
      .first()
      .click({ force: true });
    await page.waitForTimeout(1000);

    await waitForIframeChildCount(page, IFRAME_SELECTOR, parentPageName, 1);

    children = await getChildrenInIframe(page, IFRAME_SELECTOR, parentPageName);
    logChildren('Iframe children after doc #1 sync', children);
    assertContainsAllViewIds(children, allCreatedViewIds, 'Iframe after doc #1');
    testLog.info('Doc #1 synced to iframe');

    // ------------------------------------------------------------------
    // Step 6: IFRAME -> create sub-database (Grid)
    // ------------------------------------------------------------------
    testLog.step(6, 'Iframe: create sub-database (Grid)');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 1); // 1 = Grid

    children = await getChildrenInIframe(page, IFRAME_SELECTOR, parentPageName);
    logChildren('Iframe children after grid', children);
    const newGridChild = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newGridChild).toBeDefined();
    allCreatedViewIds.push(newGridChild!.viewId);
    testLog.info(`Grid viewId: ${newGridChild!.viewId}`);

    // Verify it syncs to main window
    await waitForMainWindowChildCount(page, parentPageName, 2);

    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after grid sync', children);
    assertContainsAllViewIds(children, allCreatedViewIds, 'Main after grid');
    testLog.info('Grid synced to main window');

    // ------------------------------------------------------------------
    // Step 7: MAIN WINDOW -> create sub-document #2
    // ------------------------------------------------------------------
    testLog.step(7, 'Main window: create sub-document #2');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #2', children);
    const newDoc2Child = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newDoc2Child).toBeDefined();
    allCreatedViewIds.push(newDoc2Child!.viewId);
    testLog.info(`Doc #2 viewId: ${newDoc2Child!.viewId}`);

    // Verify it syncs to iframe
    await waitForIframeChildCount(page, IFRAME_SELECTOR, parentPageName, 3);

    children = await getChildrenInIframe(page, IFRAME_SELECTOR, parentPageName);
    logChildren('Iframe children after doc #2 sync', children);
    assertContainsAllViewIds(children, allCreatedViewIds, 'Iframe after doc #2');
    testLog.info('Doc #2 synced to iframe');

    // ------------------------------------------------------------------
    // Step 8: IFRAME -> create sub-document #3
    // ------------------------------------------------------------------
    testLog.step(8, 'Iframe: create sub-document #3');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0); // 0 = Document

    children = await getChildrenInIframe(page, IFRAME_SELECTOR, parentPageName);
    logChildren('Iframe children after doc #3', children);
    const newDoc3Child = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newDoc3Child).toBeDefined();
    allCreatedViewIds.push(newDoc3Child!.viewId);
    testLog.info(`Doc #3 viewId: ${newDoc3Child!.viewId}`);

    // Verify it syncs to main window
    await waitForMainWindowChildCount(page, parentPageName, 4);

    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #3 sync', children);
    assertContainsAllViewIds(children, allCreatedViewIds, 'Main after doc #3');
    testLog.info('Doc #3 synced to main window');

    // ------------------------------------------------------------------
    // Step 9: Final strict assertions
    // ------------------------------------------------------------------
    testLog.step(9, 'Final strict assertions on both sides');

    // Assert no page reload
    const markerValue = await page.evaluate((marker) => {
      return (window as any)[marker];
    }, RELOAD_MARKER);
    expect(markerValue).toBe(true);
    testLog.info('No page reload occurred');

    // Strict assertion on MAIN WINDOW
    const mainChildren = await getChildrenInMainWindow(page, parentPageName);
    logChildren('FINAL main window children', mainChildren);
    expect(mainChildren.length).toBe(4);
    assertContainsAllViewIds(mainChildren, allCreatedViewIds, 'FINAL main window');

    // Verify each child is visible in the DOM
    for (const child of mainChildren) {
      await expect(page.locator(byTestId(`page-${child.viewId}`))).toBeVisible();
      testLog.info(`Main window: "${child.name}" [${child.viewId}] visible`);
    }

    // Strict assertion on IFRAME
    const iframeChildren = await getChildrenInIframe(
      page,
      IFRAME_SELECTOR,
      parentPageName
    );
    logChildren('FINAL iframe children', iframeChildren);
    expect(iframeChildren.length).toBe(4);
    assertContainsAllViewIds(iframeChildren, allCreatedViewIds, 'FINAL iframe');

    // Verify each child exists in iframe DOM
    for (const child of iframeChildren) {
      await expect(
        frame.locator(byTestId(`page-${child.viewId}`))
      ).toBeVisible();
      testLog.info(`Iframe: "${child.name}" [${child.viewId}] exists`);
    }

    testLog.info(
      'Bidirectional sync verified -- all 4 children (2 docs + 1 grid from both sides) present on both sides'
    );

    // Cleanup: remove iframe
    await page.evaluate((selector) => {
      const iframe = document.querySelector(selector);
      if (iframe) iframe.remove();
    }, IFRAME_SELECTOR);
  });
});
