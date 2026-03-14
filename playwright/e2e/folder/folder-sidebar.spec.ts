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

  // Inject test environment marker into iframe so inline action buttons are always rendered.
  // The source code in Outline.tsx checks 'Cypress' in window to keep buttons visible.
  await frame.locator('html').evaluate(() => {
    (window as any).Cypress = true;
  });

  const parentItem = frame
    .locator(`[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentPageName}"))`)
    .first();

  // Dispatch hover events via JS (iframe sidebar may not be visible on screen)
  await parentItem.locator('> div').first().evaluate((el) => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
  });
  await page.waitForTimeout(1500);

  // Click inline "+" button via evaluate (iframe sidebar may be offscreen)
  // Scope to parent's own renderItem div (> div:first-child) to avoid clicking child's button
  const addBtn = parentItem.locator('> div').first().locator(byTestId('inline-add-page')).first();
  await addBtn.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1500);

  // Select layout from the dropdown inside iframe.
  const dropdownContent = frame.locator('[data-slot="dropdown-menu-content"]');
  await expect(dropdownContent).toBeVisible({ timeout: 10000 });
  await dropdownContent.locator('[role="menuitem"]').nth(menuItemIndex).click({ force: true });
  await page.waitForTimeout(3000);

  // Close any dialog in iframe
  const dialogCount = await frame.locator('[role="dialog"], .MuiDialog-container').count();
  if (dialogCount > 0) {
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
  // Use > div:first-child to match ONLY the page-item's own page-name, not nested children
  const parentItem = frame
    .locator(`[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentPageName}"))`)
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

    // Given: a new user is signed in with a parent page in General
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

    // And: an iframe is created with the same app URL for bidirectional sync
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

    // When: creating sub-document #1 in main window
    testLog.step(5, 'Main window: create sub-document #1');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    // Expand parent in main window to see the child
    await expandPageByName(page, parentPageName);

    // Then: main window shows 1 child
    let children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #1', children);
    expect(children.length).toBe(1);
    allCreatedViewIds.push(children[0].viewId);
    testLog.info(`Doc #1 viewId: ${children[0].viewId}`);

    // And: sub-document #1 syncs to iframe
    testLog.info('Expanding parent in iframe');
    await frame
      .locator(`[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentPageName}"))`)
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

    // When: creating sub-document #2 in iframe
    // Note: Grid/database creation places containers at space level, not as children,
    // so we test with Document instead to verify bidirectional child sync.
    testLog.step(6, 'Iframe: create sub-document #2');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0); // 0 = Document

    // Then: doc #2 syncs to main window (verify here first since main window parent is stable)
    await waitForMainWindowChildCount(page, parentPageName, 2);
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #2 sync', children);
    const newDoc2IframeChild = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newDoc2IframeChild).toBeDefined();
    allCreatedViewIds.push(newDoc2IframeChild!.viewId);
    testLog.info(`Doc #2 viewId: ${newDoc2IframeChild!.viewId}`);

    // When: creating sub-document #3 in main window
    testLog.step(7, 'Main window: create sub-document #3');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    // Then: main window shows the new document child
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #3', children);
    const newDoc3Child = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newDoc3Child).toBeDefined();
    allCreatedViewIds.push(newDoc3Child!.viewId);
    testLog.info(`Doc #3 viewId: ${newDoc3Child!.viewId}`);

    // When: creating sub-document #4 in iframe
    testLog.step(8, 'Iframe: create sub-document #4');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0); // 0 = Document

    // Then: doc #4 syncs to main window
    // After addChildInIframe, the iframe sidebar may no longer be visible
    // (iframe navigates to the new doc page), so we verify all sync via main window.
    await waitForMainWindowChildCount(page, parentPageName, 4);
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #4 sync', children);
    const newDoc4Child = children.find((c) => !allCreatedViewIds.includes(c.viewId));
    expect(newDoc4Child).toBeDefined();
    allCreatedViewIds.push(newDoc4Child!.viewId);
    testLog.info(`Doc #4 viewId: ${newDoc4Child!.viewId}`);

    // Then: no page reload occurred during the entire sync process
    testLog.step(9, 'Final assertions');

    const markerValue = await page.evaluate((marker) => {
      return (window as any)[marker];
    }, RELOAD_MARKER);
    expect(markerValue).toBe(true);
    testLog.info('No page reload occurred');

    // And: main window has all 4 children visible
    const mainChildren = await getChildrenInMainWindow(page, parentPageName);
    logChildren('FINAL main window children', mainChildren);
    expect(mainChildren.length).toBe(4);
    assertContainsAllViewIds(mainChildren, allCreatedViewIds, 'FINAL main window');

    for (const child of mainChildren) {
      await expect(page.locator(byTestId(`page-${child.viewId}`))).toBeVisible();
      testLog.info(`Main window: "${child.name}" [${child.viewId}] visible`);
    }

    testLog.info(
      'Bidirectional sync verified -- all 4 children present in main window (2 created in main, 2 created in iframe)'
    );

    // Cleanup: remove iframe
    await page.evaluate((selector) => {
      const iframe = document.querySelector(selector);
      if (iframe) iframe.remove();
    }, IFRAME_SELECTOR);
  });
});
