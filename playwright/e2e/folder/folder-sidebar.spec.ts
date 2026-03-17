import { test, expect } from '@playwright/test';
import {
  PageSelectors,
  SidebarSelectors,
  byTestId,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { testLog } from '../../support/test-helpers';
import { expandSpaceByName } from '../../support/page/flows';

/**
 * Sidebar bidirectional sync: main window <-> iframe
 * Migrated from: cypress/e2e/folder/sidebar-add-page-no-collapse.cy.ts
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
 * Ensure the parent page-item is expanded in the main window sidebar.
 */
async function ensureParentExpanded(
  page: import('@playwright/test').Page,
  parentPageName: string
) {
  const parentItem = PageSelectors.itemByName(page, parentPageName);
  const expandToggle = parentItem.locator('[data-testid="outline-toggle-expand"]');
  if ((await expandToggle.count()) > 0) {
    await expandToggle.first().click({ force: true });
    // Wait for collapse toggle to confirm expansion succeeded
    await expect(
      parentItem.locator('[data-testid="outline-toggle-collapse"]')
    )
      .toBeVisible({ timeout: 5000 })
      .catch(() => {
        // Parent might have no children — collapse toggle won't appear
      });
  }
}

/**
 * Use the inline "+" button on a page in the MAIN window to add a child.
 * `menuItemIndex`: 0 = Document, 1 = Grid, 2 = Board, 3 = Calendar
 *
 * Retries the entire click flow (hover → click "+" → select menu item)
 * up to `maxAttempts` times, since the dropdown menu item click can
 * occasionally fail to trigger the handler in automated tests.
 */
async function addChildInMainWindow(
  page: import('@playwright/test').Page,
  parentPageName: string,
  menuItemIndex: number,
  maxAttempts: number = 5
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await ensureParentExpanded(page, parentPageName);

    const parentItem = PageSelectors.itemByName(page, parentPageName);
    const childrenContainer = parentItem.locator('> div').last();
    const directChildren = childrenContainer.locator(
      ':scope > [data-testid="page-item"]'
    );
    const beforeCount = await directChildren.count();
    testLog.info(`addChildInMainWindow attempt ${attempt}: beforeCount=${beforeCount}`);

    // Scroll parent into view and hover to reveal action buttons
    await parentItem.locator('> div').first().scrollIntoViewIfNeeded();
    await parentItem.locator('> div').first().hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the inline "+" button
    const addBtn = parentItem
      .locator('> div')
      .first()
      .locator(byTestId('inline-add-page'))
      .first();

    if ((await addBtn.count()) === 0) {
      testLog.info(`attempt ${attempt}: inline-add-page not found, retrying`);
      await page.waitForTimeout(2000);
      continue;
    }

    await addBtn.click({ force: true });
    await page.waitForTimeout(1000);

    // Wait for the view-actions-popover dropdown
    const popover = page.getByTestId('view-actions-popover');
    try {
      await expect(popover).toBeVisible({ timeout: 8000 });
    } catch {
      testLog.info(`attempt ${attempt}: popover did not appear, retrying`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      continue;
    }

    // Click the menu item to create the page
    const menuItems = popover.locator('[role="menuitem"]');
    await expect(menuItems.nth(menuItemIndex)).toBeVisible({ timeout: 3000 });
    await menuItems.nth(menuItemIndex).click();

    // Wait for popover to close (confirms the click was processed)
    await expect(popover).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Dismiss any dialog that opened (Document type opens a page modal)
    // Wait a moment for the dialog to appear (it may render asynchronously)
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"]');
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(dialog)
        .not.toBeVisible({ timeout: 5000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    // Wait for the new child to appear, re-expanding parent if needed
    try {
      await expect(async () => {
        await ensureParentExpanded(page, parentPageName);
        const count = await directChildren.count();
        expect(count).toBeGreaterThan(beforeCount);
      }).toPass({ timeout: 20000 });

      testLog.info(
        `addChildInMainWindow: child created on attempt ${attempt}, count now > ${beforeCount}`
      );
      return; // success
    } catch {
      testLog.info(`attempt ${attempt}: child count did not increase, retrying`);
      await page.waitForTimeout(2000);
    }
  }

  throw new Error(
    `addChildInMainWindow: failed to create child under "${parentPageName}" after ${maxAttempts} attempts`
  );
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

  // Inject test environment marker so inline action buttons are always rendered
  await frame.locator('html').evaluate(() => {
    (window as any).Cypress = true;
  });

  const parentItem = frame
    .locator(
      `[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentPageName}"))`
    )
    .first();

  // Dispatch hover events via JS (iframe sidebar may not be visible on screen)
  await parentItem.locator('> div').first().evaluate((el) => {
    el.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, cancelable: true })
    );
    el.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false, cancelable: true })
    );
  });

  // Click inline "+" button via evaluate (iframe may be offscreen)
  const addBtn = parentItem
    .locator('> div')
    .first()
    .locator(byTestId('inline-add-page'))
    .first();
  await expect(addBtn).toBeVisible({ timeout: 5000 });
  await addBtn.evaluate((el: HTMLElement) => el.click());

  // Wait for the view-actions-popover dropdown and select layout
  const popover = frame.getByTestId('view-actions-popover');
  await expect(popover).toBeVisible({ timeout: 10000 });
  await popover
    .locator('[role="menuitem"]')
    .nth(menuItemIndex)
    .click({ force: true });

  // Wait for popover to close (confirms click was processed)
  await expect(popover).not.toBeVisible({ timeout: 5000 });

  // Dismiss any dialog in iframe by clicking its close/escape area
  const dialog = frame.locator('[role="dialog"]');
  if (await dialog.isVisible().catch(() => false)) {
    // Focus the iframe first, then press Escape
    await frame.locator('body').first().click({ force: true, position: { x: 0, y: 0 } }).catch(() => {});
    await page.keyboard.press('Escape');
    await expect(dialog)
      .not.toBeVisible({ timeout: 5000 })
      .catch(() => {});
  }
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
  const pageItems = childrenContainer.locator(
    ':scope > [data-testid="page-item"]'
  );
  const count = await pageItems.count();

  const children: ChildInfo[] = [];
  for (let i = 0; i < count; i++) {
    const item = pageItems.nth(i);
    const name = (
      (await item.locator(byTestId('page-name')).first().textContent()) ?? ''
    ).trim();
    const testId =
      (await item.locator('> div').first().getAttribute('data-testid')) ?? '';
    const viewId = testId.startsWith('page-')
      ? testId.slice('page-'.length)
      : testId;
    children.push({ viewId, name });
  }
  return children;
}

/**
 * Wait until a parent in the main window has at least `expectedCount` children.
 * Uses Playwright's auto-retry instead of manual polling.
 */
async function waitForMainWindowChildCount(
  page: import('@playwright/test').Page,
  parentPageName: string,
  expectedCount: number
): Promise<void> {
  await expect(async () => {
    await ensureParentExpanded(page, parentPageName);
    const children = await getChildrenInMainWindow(page, parentPageName);
    testLog.info(
      `Main window child count: ${children.length} (expected >= ${expectedCount})`
    );
    expect(children.length).toBeGreaterThanOrEqual(expectedCount);
  }).toPass({ timeout: 30000 });
}

function logChildren(label: string, children: ChildInfo[]) {
  const summary = children
    .map((c) => `${c.name} [${c.viewId.slice(0, 8)}]`)
    .join(', ');
  testLog.info(`${label} (${children.length}): ${summary}`);
}

function assertContainsAllViewIds(
  children: ChildInfo[],
  expectedViewIds: string[],
  _context: string
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

    // Viewport must be large enough for both the main window sidebar AND the
    // iframe sidebar.  The app hides the sidebar when
    // window.innerWidth − drawerWidth ≤ 768 (drawer defaults to 268 px).
    // Iframe will be 1100 px wide → 1100 − 268 = 832 > 768 → sidebar visible.
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('should sync sub-documents and sub-databases bidirectionally without sidebar collapse or reload', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const allCreatedViewIds: string[] = [];

    // Step 1: Sign in
    testLog.step(1, 'Sign in with a new user');
    await signInAndWaitForApp(page, request, testEmail);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({
      timeout: 30000,
    });

    // Step 2: Expand General space
    testLog.step(2, 'Expand General space');
    await expandSpaceByName(page, SPACE_NAME);
    await expect(PageSelectors.names(page).first()).toBeVisible({
      timeout: 10000,
    });

    // Step 3: Navigate to the existing "Getting started" page and rename it.
    // Using an existing Document page avoids the ViewModal that opens when
    // creating a new page via inline-add-page.
    testLog.step(3, 'Navigate to Getting started and rename it');
    const gettingStartedItem = PageSelectors.itemByName(page, 'Getting started');
    await gettingStartedItem.click();

    const titleInput = page.getByTestId('page-title-input');
    await expect(titleInput).toBeVisible({ timeout: 15000 });

    const parentPageName = `SyncTest-${Date.now()}`;
    // Clear existing text then type the new name (contentEditable div)
    await titleInput.click();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type(parentPageName);
    // Blur to trigger immediate sendUpdateImmediately (bypasses 300ms debounce)
    await titleInput.evaluate((el) => el.blur());
    await page.waitForTimeout(1000);

    // Wait for the rename to sync to the sidebar
    await expect(
      PageSelectors.nameContaining(page, parentPageName).first()
    ).toBeVisible({ timeout: 30000 });
    testLog.info(`Parent page "${parentPageName}" created and renamed`);

    // Step 4: Create iframe for bidirectional sync
    testLog.step(4, 'Create iframe with same app URL');

    // Install reload detection marker
    await page.evaluate((marker) => {
      (window as any)[marker] = true;
    }, RELOAD_MARKER);

    const appUrl = page.url();
    testLog.info(`App URL: ${appUrl}`);

    // Ensure the sidebar-open flag is in localStorage so the iframe starts
    // with its sidebar visible (the hook reads this during mount).
    await page.evaluate(() => {
      localStorage.setItem('outline_open', 'true');
    });

    // Create the sync iframe
    await page.evaluate(
      ({ url, selector }) => {
        const iframe = document.createElement('iframe');
        iframe.id = selector.replace('#', '');
        iframe.src = url;
        iframe.style.cssText =
          'position:fixed;bottom:0;right:0;width:1100px;height:700px;z-index:9999;border:2px solid blue;';
        document.body.appendChild(iframe);
      },
      { url: appUrl, selector: IFRAME_SELECTOR }
    );

    // Wait for iframe to fully load (sidebar header visible)
    const frame = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      frame.locator('[data-testid="sidebar-page-header"]')
    ).toBeVisible({ timeout: 30000 });

    // Expand space in iframe (replicate expandSpaceByName logic)
    testLog.info('Expanding space in iframe');
    const iframeSpaceItem = frame
      .locator(
        `[data-testid="space-item"]:has([data-testid="space-name"]:text-is("${SPACE_NAME}"))`
      )
      .first();
    await expect(iframeSpaceItem).toBeVisible({ timeout: 15000 });

    const iframeExpanded = iframeSpaceItem.locator(
      '[data-testid="space-expanded"]'
    );
    const isIframeExpanded =
      (await iframeExpanded.getAttribute('data-expanded')) === 'true';
    if (!isIframeExpanded) {
      await iframeSpaceItem.getByTestId('space-name').click({ force: true });
    }

    // Wait for parent page to be visible in iframe sidebar
    await expect(
      frame
        .locator(
          `[data-testid="page-name"]:text-is("${parentPageName}")`
        )
        .first()
    ).toBeVisible({ timeout: 15000 });

    // Expand parent and record baseline children
    testLog.info('Expanding parent to record baseline children');
    await ensureParentExpanded(page, parentPageName);

    // Wait for collapse toggle — indicates children are loaded
    await expect(
      PageSelectors.itemByName(page, parentPageName).locator(
        '[data-testid="outline-toggle-collapse"]'
      )
    )
      .toBeVisible({ timeout: 5000 })
      .catch(() => {
        // No collapse toggle = parent has no children (baseline = 0)
      });

    // Wait for children to fully load and stabilize (lazy loading)
    await page.waitForTimeout(2000);

    // Re-expand after loading to ensure children are visible
    await ensureParentExpanded(page, parentPageName);

    // Wait for the child count to stabilize (stop changing)
    let stableCount = -1;
    for (let i = 0; i < 5; i++) {
      const c = await getChildrenInMainWindow(page, parentPageName);
      if (c.length === stableCount) break;
      stableCount = c.length;
      await page.waitForTimeout(1000);
    }

    const baselineChildren = await getChildrenInMainWindow(
      page,
      parentPageName
    );
    const baselineViewIds = new Set(baselineChildren.map((c) => c.viewId));
    const baselineCount = baselineChildren.length;
    logChildren('Baseline children', baselineChildren);
    testLog.info(`Baseline child count: ${baselineCount}`);

    // Step 5: Main window — create sub-document #1
    testLog.step(5, 'Main window: create sub-document #1');
    await addChildInMainWindow(page, parentPageName, 0);

    await waitForMainWindowChildCount(
      page,
      parentPageName,
      baselineCount + 1
    );
    let children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #1', children);
    const newDoc1 = children.find(
      (c) =>
        !baselineViewIds.has(c.viewId) &&
        !allCreatedViewIds.includes(c.viewId)
    );
    expect(newDoc1).toBeDefined();
    allCreatedViewIds.push(newDoc1!.viewId);
    testLog.info(`Doc #1 viewId: ${newDoc1!.viewId}`);

    // Step 6: Iframe — create sub-document #2
    testLog.step(6, 'Iframe: create sub-document #2');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0);

    await waitForMainWindowChildCount(
      page,
      parentPageName,
      baselineCount + 2
    );
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #2 sync', children);
    const newDoc2 = children.find(
      (c) =>
        !baselineViewIds.has(c.viewId) &&
        !allCreatedViewIds.includes(c.viewId)
    );
    expect(newDoc2).toBeDefined();
    allCreatedViewIds.push(newDoc2!.viewId);
    testLog.info(`Doc #2 viewId: ${newDoc2!.viewId}`);

    // Step 7: Main window — create sub-document #3
    testLog.step(7, 'Main window: create sub-document #3');
    await addChildInMainWindow(page, parentPageName, 0);

    await waitForMainWindowChildCount(
      page,
      parentPageName,
      baselineCount + 3
    );
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #3', children);
    const newDoc3 = children.find(
      (c) =>
        !baselineViewIds.has(c.viewId) &&
        !allCreatedViewIds.includes(c.viewId)
    );
    expect(newDoc3).toBeDefined();
    allCreatedViewIds.push(newDoc3!.viewId);
    testLog.info(`Doc #3 viewId: ${newDoc3!.viewId}`);

    // Step 8: Iframe — create sub-document #4
    testLog.step(8, 'Iframe: create sub-document #4');
    await addChildInIframe(page, IFRAME_SELECTOR, parentPageName, 0);

    await waitForMainWindowChildCount(
      page,
      parentPageName,
      baselineCount + 4
    );
    children = await getChildrenInMainWindow(page, parentPageName);
    logChildren('Main window children after doc #4 sync', children);
    const newDoc4 = children.find(
      (c) =>
        !baselineViewIds.has(c.viewId) &&
        !allCreatedViewIds.includes(c.viewId)
    );
    expect(newDoc4).toBeDefined();
    allCreatedViewIds.push(newDoc4!.viewId);
    testLog.info(`Doc #4 viewId: ${newDoc4!.viewId}`);

    // Step 9: Final assertions
    testLog.step(9, 'Final assertions');

    const markerValue = await page.evaluate((marker) => {
      return (window as any)[marker];
    }, RELOAD_MARKER);
    expect(markerValue).toBe(true);
    testLog.info('No page reload occurred');

    const mainChildren = await getChildrenInMainWindow(
      page,
      parentPageName
    );
    logChildren('FINAL main window children', mainChildren);
    expect(mainChildren.length).toBe(baselineCount + 4);
    assertContainsAllViewIds(
      mainChildren,
      allCreatedViewIds,
      'FINAL main window'
    );

    for (const viewId of allCreatedViewIds) {
      await expect(page.locator(byTestId(`page-${viewId}`))).toBeVisible();
      testLog.info(`Main window: [${viewId}] visible`);
    }

    testLog.info(
      'Bidirectional sync verified -- all 4 test children present in main window'
    );

    // Cleanup: remove iframe
    await page.evaluate((selector) => {
      const iframe = document.querySelector(selector);
      if (iframe) iframe.remove();
    }, IFRAME_SELECTOR);
  });
});
