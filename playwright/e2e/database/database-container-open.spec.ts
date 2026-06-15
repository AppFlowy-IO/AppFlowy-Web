/**
 * Database Container Open Behavior Tests
 *
 * Tests that clicking a database container in the sidebar
 * correctly opens its first child view.
 *
 * Migrated from: cypress/e2e/database/database-container-open.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  ModalSelectors,
  PageSelectors,
  SpaceSelectors,
  AddPageSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { currentViewIdFromUrl, closeModalsIfOpen, navigateAwayToNewPage } from '../../support/page-utils';

test.describe('Database Container Open Behavior', () => {
  const dbName = 'New Database';
  const spaceName = 'General';

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  async function createGridAndWait(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testEmail: string
  ) {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', {
      createWaitMs: 7000,
      verify: async (p) => {
        await expect(DatabaseGridSelectors.grid(p)).toBeVisible({ timeout: 15000 });
        await expect(DatabaseGridSelectors.cells(p).first()).toBeVisible({ timeout: 10000 });
      },
    });
  }

  test('opens the first child view when clicking a database container', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    await createGridAndWait(page, request, testEmail);

    // Verify: a newly created container has exactly 1 child view tab (Grid, active)
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(1);
    await expect(DatabaseViewSelectors.viewTab(page).first()).toHaveAttribute('data-state', 'active');
    await expect(DatabaseViewSelectors.viewTab(page).first()).toContainText('Grid');

    // Ensure sidebar space is expanded
    const spaceItem = SpaceSelectors.itemByName(page, spaceName);
    await expect(spaceItem).toBeVisible();
    const expandedIndicator = spaceItem.locator('[data-testid="space-expanded"]');
    const isExpanded = await expandedIndicator.getAttribute('data-expanded');
    if (isExpanded !== 'true') {
      await spaceItem.locator('[data-testid="space-name"]').click({ force: true });
      await page.waitForTimeout(500);
    }

    // Capture the currently active viewId (the first child view)
    const firstChildViewId = currentViewIdFromUrl(page);
    expect(firstChildViewId).not.toBe('');

    // Navigate away to a new document page
    await navigateAwayToNewPage(page);

    // Click on the database container in sidebar and verify redirect to first child
    await PageSelectors.nameContaining(page, dbName).first().click({ force: true });

    await expect(page).toHaveURL(new RegExp(`/${firstChildViewId}`), { timeout: 20000 });
    await expect(DatabaseViewSelectors.viewTab(page, firstChildViewId)).toHaveAttribute('data-state', 'active');

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
    await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible();
  });
});
