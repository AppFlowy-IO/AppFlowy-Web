import { test, expect } from '@playwright/test';
import { PageSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

const INVALID_VIEW_ID = '00000000-0000-0000-0000-000000000000';

function extractViewId(testId: string | null | undefined, prefix: string): string {
  if (!testId || !testId.startsWith(prefix)) {
    throw new Error(`Unexpected data-testid: ${String(testId)}`);
  }

  return testId.slice(prefix.length);
}

async function waitForSidebarReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="space-item"]').first()).toBeVisible({ timeout: 60000 });
  await expect(PageSelectors.items(page).first()).toBeVisible({ timeout: 60000 });
}

/**
 * Tests for outline lazy loading behavior.
 * Migrated from: cypress/e2e/app/outline-lazy-loading.cy.ts
 */
test.describe('Outline Lazy Loading', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }

      throw err; // Fail on unknown uncaught exceptions (matches Cypress default)
    });
  });

  test('refetches subtree after collapsing and reopening a space', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    let targetSpaceId = '';
    let subtreeRequestCount = 0;

    // Intercept subtree requests
    await page.route('**/api/workspace/*/view/*', async (route) => {
      const url = new URL(route.request().url());
      const depth = url.searchParams.get('depth');
      const requestViewId = url.pathname.split('/').pop();

      if (targetSpaceId && depth === '1' && requestViewId === targetSpaceId) {
        subtreeRequestCount += 1;
      }

      await route.continue();
    });

    await signInAndWaitForApp(page, request, testEmail);
    await waitForSidebarReady(page);

    // Use :visible to get the clickable space header
    const spaceEl = page.locator('[data-testid^="space-"][data-expanded]:visible').first();
    await expect(spaceEl).toBeVisible({ timeout: 30000 });
    const spaceTestId = await spaceEl.getAttribute('data-testid');
    targetSpaceId = extractViewId(spaceTestId, 'space-');

    const selector = `[data-testid="space-${targetSpaceId}"]`;
    const spaceLocator = page.locator(selector);

    // Collapse if expanded
    const expanded = await spaceLocator.getAttribute('data-expanded');
    if (expanded === 'true') {
      await spaceLocator.click({ force: true });
    }

    // Open the space
    await spaceLocator.click({ force: true });

    // Wait for subtree request to be made
    await expect(async () => {
      expect(subtreeRequestCount).toBeGreaterThan(0);
    }).toPass({ timeout: 20000 });

    const previousCount = subtreeRequestCount;

    // In-memory view cache (VIEW_CACHE_TTL_MS = 5000 in cached-api.ts) prevents
    // a fresh HTTP request when re-expanding within 5s. In the Cypress version,
    // the cumulative overhead of Cypress command queuing (~200-300ms per command)
    // naturally exceeds the 5s TTL between the first expand and the re-expand.
    // Playwright executes commands much faster, so we need an explicit wait.
    await page.waitForTimeout(5500);

    // Collapse and re-expand
    await spaceLocator.click({ force: true });
    await page.waitForTimeout(400);
    await spaceLocator.click({ force: true });

    // Wait for another subtree request
    await expect(async () => {
      expect(subtreeRequestCount).toBeGreaterThan(previousCount);
    }).toPass({ timeout: 20000 });
  });

  test('prunes invalid expanded ids from localStorage on reload', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    let fakeIdRequested = false;
    let validSpaceId = '';

    // Intercept subtree requests
    await page.route('**/api/workspace/*/view/*', async (route) => {
      const url = new URL(route.request().url());
      const requestViewId = url.pathname.split('/').pop();
      const depth = url.searchParams.get('depth');

      if (depth === '1' && requestViewId === INVALID_VIEW_ID) {
        fakeIdRequested = true;
      }

      await route.continue();
    });

    await signInAndWaitForApp(page, request, testEmail);
    await waitForSidebarReady(page);

    // Get the visible space header
    const spaceEl = page.locator('[data-testid^="space-"][data-expanded]:visible').first();
    await expect(spaceEl).toBeVisible({ timeout: 30000 });
    const spaceTestId = await spaceEl.getAttribute('data-testid');
    validSpaceId = extractViewId(spaceTestId, 'space-');

    // Set localStorage with valid and invalid IDs
    await page.evaluate(
      ({ validId, invalidId }) => {
        window.localStorage.setItem(
          'outline_expanded',
          JSON.stringify({
            [validId]: true,
            [invalidId]: true,
          })
        );
      },
      { validId: validSpaceId, invalidId: INVALID_VIEW_ID }
    );

    await page.reload();
    await waitForSidebarReady(page);

    // Wait for the outline restore/pruning logic to complete
    await page.waitForTimeout(3000);

    const expanded = await page.evaluate(() => {
      const expandedRaw = window.localStorage.getItem('outline_expanded');
      return expandedRaw ? (JSON.parse(expandedRaw) as Record<string, boolean>) : {};
    });

    expect(expanded[INVALID_VIEW_ID]).toBeUndefined();
    expect(expanded[validSpaceId]).toBe(true);
    expect(fakeIdRequested).toBe(false);
  });

  test('logs depth=1 subtree batch requests with one or more ids', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const seenBatchRequests: Array<{ depth: string | null; viewIds: string[] }> = [];

    // Intercept batch view requests
    await page.route('**/api/workspace/*/views*', async (route) => {
      const url = new URL(route.request().url());
      const depth = url.searchParams.get('depth');
      const viewIds =
        url.searchParams
          .get('view_ids')
          ?.split(',')
          .map((id: string) => id.trim())
          .filter(Boolean) ?? [];

      seenBatchRequests.push({ depth, viewIds });
      await route.continue();
    });

    await signInAndWaitForApp(page, request, testEmail);
    await waitForSidebarReady(page);

    // Collect all visible space IDs
    const spaceIds: string[] = [];
    const spaceElements = page.locator('[data-testid^="space-"][data-expanded]:visible');
    await expect(spaceElements.first()).toBeVisible({ timeout: 30000 });
    const count = await spaceElements.count();

    for (let i = 0; i < count; i++) {
      const testId = await spaceElements.nth(i).getAttribute('data-testid');
      if (testId) {
        spaceIds.push(extractViewId(testId, 'space-'));
      }
    }

    // Set localStorage for batch loading
    const expandedMap: Record<string, boolean> = {};
    spaceIds.forEach((id) => {
      expandedMap[id] = true;
    });

    await page.evaluate((expanded) => {
      window.localStorage.setItem('outline_expanded', JSON.stringify(expanded));
    }, expandedMap);

    // Reload to trigger batch loading
    await page.reload();
    await waitForSidebarReady(page);

    await page.waitForTimeout(3000);

    const matched = seenBatchRequests.filter((req) => req.depth === '1' && req.viewIds.length > 0);
    expect(matched.length).toBeGreaterThan(0);
  });
});
