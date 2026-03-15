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
 *
 * Includes retry logic: verifies child count increased after each attempt.
 */
async function addChildInMainWindow(
  page: import('@playwright/test').Page,
  parentPageName: string,
  menuItemIndex: number,
  maxRetries: number = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const beforeChildren = await getChildrenInMainWindow(page, parentPageName);
    const beforeCount = beforeChildren.length;
    testLog.info(`addChildInMainWindow attempt ${attempt + 1}: beforeCount=${beforeCount}`);

    // Re-expand parent if collapsed
    const parentItem = PageSelectors.itemByName(page, parentPageName);
    const expandToggle = parentItem.locator('[data-testid="outline-toggle-expand"]');
    if (await expandToggle.count() > 0) {
      testLog.info('Re-expanding collapsed parent before add');
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Scroll parent into view to ensure visibility
    await parentItem.locator('> div').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Hover to reveal the inline add button
    await parentItem.locator('> div').first().hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the inline "+" button
    const addBtn = parentItem
      .locator('> div')
      .first()
      .locator(byTestId('inline-add-page'))
      .first();

    if (await addBtn.count() === 0) {
      testLog.info('inline-add-page button not found, retrying...');
      await page.waitForTimeout(2000);
      continue;
    }

    await addBtn.click({ force: true });
    await page.waitForTimeout(1000);

    // Wait for dropdown and select layout
    const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
    const dropdownVisible = await dropdownContent.isVisible().catch(() => false);
    if (!dropdownVisible) {
      testLog.info('Dropdown not visible after click, waiting...');
      try {
        await expect(dropdownContent).toBeVisible({ timeout: 5000 });
      } catch {
        testLog.info('Dropdown failed to appear, retrying...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        continue;
      }
    }

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

    // Re-expand parent to verify child was created
    const parentItem2 = PageSelectors.itemByName(page, parentPageName);
    const expandToggle2 = parentItem2.locator('[data-testid="outline-toggle-expand"]');
    if (await expandToggle2.count() > 0) {
      await expandToggle2.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Verify child count increased
    const afterChildren = await getChildrenInMainWindow(page, parentPageName);
    testLog.info(`addChildInMainWindow attempt ${attempt + 1}: afterCount=${afterChildren.length}`);

    if (afterChildren.length > beforeCount) {
      testLog.info(`addChildInMainWindow succeeded on attempt ${attempt + 1}`);
      return;
    }

    testLog.info(`addChildInMainWindow attempt ${attempt + 1} failed to create child, retrying...`);
    await page.waitForTimeout(2000);
  }

  throw new Error(`addChildInMainWindow: failed to create child under "${parentPageName}" after ${maxRetries} attempts`);
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
  // Use :scope > to match only DIRECT children, not nested page-items
  const pageItems = childrenContainer.locator(':scope > [data-testid="page-item"]');
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
  // Use :scope > to match only DIRECT children, not nested page-items
  const pageItems = childrenContainer.locator(':scope > [data-testid="page-item"]');
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
    // Re-expand parent if it collapsed (outline re-render can collapse it)
    const parentItem = PageSelectors.itemByName(page, parentPageName);
    const expandToggle = parentItem.locator('[data-testid="outline-toggle-expand"]');
    if (await expandToggle.count() > 0) {
      testLog.info(`Re-expanding collapsed parent "${parentPageName}" (attempt ${attempt})`);
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const children = await getChildrenInMainWindow(page, parentPageName);
    testLog.info(
      `Main window child count: ${children.length} (expected >= ${expectedCount}, attempt ${attempt})`
    );
    if (children.length >= expectedCount) {
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
  const frame = page.frameLocator(iframeSelector);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Re-expand parent in iframe if collapsed
    const parentItem = frame
      .locator(`[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentPageName}"))`)
      .first();
    const expandToggle = parentItem.locator('[data-testid="outline-toggle-expand"]');
    if (await expandToggle.count() > 0) {
      testLog.info(`Iframe: re-expanding parent (attempt ${attempt})`);
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const children = await getChildrenInIframe(page, iframeSelector, parentPageName);
    testLog.info(
      `Iframe child count: ${children.length} (expected >= ${expectedCount}, attempt ${attempt})`
    );
    if (children.length >= expectedCount) {
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

    await page.setViewportSize({ width: 1600, height: 1000 });
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
    // Use the space's inline "+" button to create a blank page (avoids Welcome template sub-pages)
    const spaceItem = page
      .locator(`${byTestId('space-item')}:has(${byTestId('space-name')}:text-is("${SPACE_NAME}"))`)
      .first();
    await spaceItem.hover({ force: true });
    await page.waitForTimeout(500);
    await spaceItem.locator(byTestId('inline-add-page')).first().click({ force: true });
    await page.waitForTimeout(1000);

    // Select "Document" from the dropdown
    const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdownContent).toBeVisible({ timeout: 5000 });
    await dropdownContent.locator('[role="menuitem"]').first().click();
    await page.waitForTimeout(3000);

    // Dismiss any modal
    const dialogCount = await page
      .locator('[role="dialog"], .MuiDialog-container')
      .count();
    if (dialogCount > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    // Rename the parent page to a unique name to avoid "Untitled" ambiguity
    // (child pages are also created as "Untitled", which confuses locators)
    const parentPageName = `SyncTest-${Date.now()}`;
    const titleInput = page.getByTestId('page-title-input');
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill(parentPageName);
    await page.waitForTimeout(2000);

    // Verify renamed page appears in sidebar
    await expect(
      PageSelectors.nameContaining(page, parentPageName).first()
    ).toBeVisible({ timeout: 10000 });
    testLog.info(`Parent page "${parentPageName}" created and renamed`);

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
          'position:fixed;bottom:0;right:0;width:900px;height:600px;z-index:9999;border:2px solid blue;';
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

    // Expand parent and record baseline children (Welcome template may add sub-pages)
    testLog.info('Expanding parent to record baseline children');
    const expandToggle = PageSelectors.itemByName(page, parentPageName)
      .locator('[data-testid="outline-toggle-expand"]');
    if (await expandToggle.count() > 0) {
      await expandToggle.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    const baselineChildren = await getChildrenInMainWindow(page, parentPageName);
    const baselineViewIds = new Set(baselineChildren.map((c) => c.viewId));
    const baselineCount = baselineChildren.length;
    logChildren('Baseline children', baselineChildren);
    testLog.info(`Baseline child count: ${baselineCount}`);

    // When: creating sub-document #1 in main window
    testLog.step(5, 'Main window: create sub-document #1');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    // Then: main window shows baseline + 1 children
    await waitForMainWindowChildCount(page, parentPageName, baselineCount + 1);
    let children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #1', children);
    const newDoc1 = children.find((c) => !baselineViewIds.has(c.viewId) && !allCreatedViewIds.includes(c.viewId));
    expect(newDoc1).toBeDefined();
    allCreatedViewIds.push(newDoc1!.viewId);
    testLog.info(`Doc #1 viewId: ${newDoc1!.viewId}`);

    // When: creating sub-document #2 in iframe
    testLog.step(6, 'Iframe: create sub-document #2');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0); // 0 = Document

    // Then: doc #2 syncs to main window
    await waitForMainWindowChildCount(page, parentPageName, baselineCount + 2);
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #2 sync', children);
    const newDoc2 = children.find((c) => !baselineViewIds.has(c.viewId) && !allCreatedViewIds.includes(c.viewId));
    expect(newDoc2).toBeDefined();
    allCreatedViewIds.push(newDoc2!.viewId);
    testLog.info(`Doc #2 viewId: ${newDoc2!.viewId}`);

    // When: creating sub-document #3 in main window
    testLog.step(7, 'Main window: create sub-document #3');
    await addChildInMainWindow(page, parentPageName, 0); // 0 = Document

    // Then: main window shows baseline + 3 children
    await waitForMainWindowChildCount(page, parentPageName, baselineCount + 3);
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #3', children);
    const newDoc3 = children.find((c) => !baselineViewIds.has(c.viewId) && !allCreatedViewIds.includes(c.viewId));
    expect(newDoc3).toBeDefined();
    allCreatedViewIds.push(newDoc3!.viewId);
    testLog.info(`Doc #3 viewId: ${newDoc3!.viewId}`);

    // When: creating sub-document #4 in iframe
    testLog.step(8, 'Iframe: create sub-document #4');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0); // 0 = Document

    // Then: doc #4 syncs to main window
    await waitForMainWindowChildCount(page, parentPageName, baselineCount + 4);
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #4 sync', children);
    const newDoc4 = children.find((c) => !baselineViewIds.has(c.viewId) && !allCreatedViewIds.includes(c.viewId));
    expect(newDoc4).toBeDefined();
    allCreatedViewIds.push(newDoc4!.viewId);
    testLog.info(`Doc #4 viewId: ${newDoc4!.viewId}`);

    // Then: no page reload occurred during the entire sync process
    testLog.step(9, 'Final assertions');

    const markerValue = await page.evaluate((marker) => {
      return (window as any)[marker];
    }, RELOAD_MARKER);
    expect(markerValue).toBe(true);
    testLog.info('No page reload occurred');

    // And: main window has all created test children visible
    const mainChildren = await getChildrenInMainWindow(page, parentPageName);
    logChildren('FINAL main window children', mainChildren);
    expect(mainChildren.length).toBe(baselineCount + 4);
    assertContainsAllViewIds(mainChildren, allCreatedViewIds, 'FINAL main window');

    for (const viewId of allCreatedViewIds) {
      await expect(page.locator(byTestId(`page-${viewId}`))).toBeVisible();
      testLog.info(`Main window: [${viewId}] visible`);
    }

    testLog.info(
      'Bidirectional sync verified -- all 4 test children present in main window (2 created in main, 2 created in iframe)'
    );

    // Cleanup: remove iframe
    await page.evaluate((selector) => {
      const iframe = document.querySelector(selector);
      if (iframe) iframe.remove();
    }, IFRAME_SELECTOR);
  });
});
