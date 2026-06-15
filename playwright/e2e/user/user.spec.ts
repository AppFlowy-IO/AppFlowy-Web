import { test, expect } from '@playwright/test';
import { WorkspaceSelectors, SidebarSelectors, PageSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { openWorkspaceDropdown, getWorkspaceItems, getWorkspaceMemberCounts } from '../../support/page/workspace';

/**
 * User Feature Tests
 * Migrated from: cypress/e2e/user/user.cy.ts
 */
test.describe('User Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.describe('User Login Tests', () => {
    test('should show AppFlowy Web login page, authenticate, and verify workspace', async ({
      page,
      request,
    }) => {
      page.on('pageerror', (err) => {
        if (
          err.message.includes('No workspace or service found') ||
          err.message.includes('Failed to fetch dynamically imported module')
        ) {
          return;
        }
      });

      const randomEmail = generateRandomEmail();

      // Sign in
      await signInAndWaitForApp(page, request, randomEmail);
      await expect(page).toHaveURL(/\/app/);

      // Wait for the loading screen to disappear and main app to appear
      await expect(page.locator('body')).not.toContainText('Welcome!', { timeout: 30000 });

      // Wait for the sidebar to be visible (indicates app is loaded)
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

      // Wait for at least one page to exist in the sidebar
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });

      // Wait for workspace dropdown to be available
      await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);

      // Open workspace dropdown
      await openWorkspaceDropdown(page);
      await page.waitForTimeout(500);

      // Verify user email is displayed in the dropdown
      const dropdownContent = WorkspaceSelectors.dropdownContent(page);
      await expect(dropdownContent).toBeVisible({ timeout: 5000 });
      await expect(dropdownContent.getByText(randomEmail)).toBeVisible({ timeout: 5000 });

      // Verify one member count
      const memberCounts = await getWorkspaceMemberCounts(page);
      await expect(memberCounts).toContainText('1 member');

      // Verify exactly one workspace exists
      const workspaceItems = await getWorkspaceItems(page);
      await expect(workspaceItems).toHaveCount(1);

      // Verify workspace name is present and not empty
      await expect(WorkspaceSelectors.itemName(page).first()).toBeVisible();
    });
  });
});
