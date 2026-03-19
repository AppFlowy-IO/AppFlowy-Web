import { test, expect } from '@playwright/test';
import { SidebarSelectors, WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Workspace Upgrade Entry Tests
 * Migrated from: cypress/e2e/app/upgrade-plan.cy.ts
 *
 * Note: The original Cypress test imported en.json translations to derive
 * UPGRADE_MENU_LABEL. For Playwright, we use the known default string.
 */
const UPGRADE_MENU_LABEL = 'Upgrade to Pro Plan';

test.describe('Workspace Upgrade Entry', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }
    });
  });

  test('shows Upgrade to Pro Plan for workspace owners', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

    await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
    await WorkspaceSelectors.dropdownTrigger(page).click();

    const dropdownContent = WorkspaceSelectors.dropdownContent(page);
    await expect(dropdownContent).toBeVisible({ timeout: 10000 });

    // Verify workspace menu items
    await expect(dropdownContent.getByText('Create workspace')).toBeVisible();
    await expect(dropdownContent.getByText(UPGRADE_MENU_LABEL)).toBeVisible();
  });
});
