import { test, expect } from '@playwright/test';
import { WorkspaceSelectors, AccountSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Update User Profile Tests
 * Migrated from: cypress/e2e/account/update-user-profile.cy.ts
 */
test.describe('Update User Profile', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should update user profile settings through Account Settings', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Step 1-2: Login and wait for app to load
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Step 3: Open workspace dropdown
    await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible();
    await WorkspaceSelectors.dropdownTrigger(page).click();

    // Wait for dropdown to open
    await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible();

    // Step 4: Click on Account Settings
    await expect(AccountSelectors.settingsButton(page)).toBeVisible();
    await AccountSelectors.settingsButton(page).click();

    // Add a wait to ensure the dialog has time to open
    await page.waitForTimeout(1000);

    // Step 5: Wait for Account Settings dialog to open
    await expect(AccountSelectors.settingsDialog(page)).toBeVisible();

    // Step 6: Check initial date format (should be Month/Day/Year)
    await expect(AccountSelectors.dateFormatDropdown(page)).toBeVisible();

    // Step 7: Test Date Format change - select Year/Month/Day
    await AccountSelectors.dateFormatDropdown(page).click();
    await page.waitForTimeout(500);

    // Select US format (value 1) which is Year/Month/Day
    await expect(AccountSelectors.dateFormatOptionYearMonthDay(page)).toBeVisible();
    await AccountSelectors.dateFormatOptionYearMonthDay(page).click();
    await page.waitForTimeout(3000); // Wait for API call to complete

    // Verify the dropdown now shows Year/Month/Day
    await expect(AccountSelectors.dateFormatDropdown(page)).toContainText('Year/Month/Day');

    // Step 8: Test Time Format change
    await expect(AccountSelectors.timeFormatDropdown(page)).toBeVisible();
    await AccountSelectors.timeFormatDropdown(page).click();
    await page.waitForTimeout(500);

    // Select 24-hour format (value 1)
    await expect(AccountSelectors.timeFormatOption24(page)).toBeVisible();
    await AccountSelectors.timeFormatOption24(page).click();
    await page.waitForTimeout(3000); // Wait for API call to complete

    // Verify the dropdown now shows 24-hour format
    await expect(AccountSelectors.timeFormatDropdown(page)).toContainText('24');

    // Step 9: Test Start Week On change
    await expect(AccountSelectors.startWeekDropdown(page)).toBeVisible();
    await AccountSelectors.startWeekDropdown(page).click();
    await page.waitForTimeout(500);

    // Select Monday (value 1)
    await expect(AccountSelectors.startWeekMonday(page)).toBeVisible();
    await AccountSelectors.startWeekMonday(page).click();
    await page.waitForTimeout(3000); // Wait for API call to complete

    await expect(AccountSelectors.startWeekDropdown(page)).toContainText('Monday');

    // Step 10: Verify all settings are showing correctly
    await expect(AccountSelectors.dateFormatDropdown(page)).toContainText('Year/Month/Day');
    await expect(AccountSelectors.timeFormatDropdown(page)).toContainText('24');
    await expect(AccountSelectors.startWeekDropdown(page)).toContainText('Monday');
  });
});
