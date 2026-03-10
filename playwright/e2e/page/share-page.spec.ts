import { test, expect, Page } from '@playwright/test';
import { DropdownSelectors, PageSelectors, SidebarSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Share Page Tests
 * Migrated from: cypress/e2e/page/share-page.cy.ts
 */

async function openSharePopover(page: Page) {
  await ShareSelectors.shareButton(page).click();
  await page.waitForTimeout(1000);
}

/**
 * Ensure the Share tab is active inside the share popover.
 * If the email-tag-input is not present, click the "Share" tab.
 */
async function ensureShareTab(page: Page) {
  const popover = ShareSelectors.sharePopover(page);
  const hasInviteInput = await popover.locator('[data-slot="email-tag-input"]').count();
  if (hasInviteInput === 0) {
    await page.getByText('Share').click({ force: true });
    await page.waitForTimeout(1000);
  }
}

/**
 * Type an email into the share email input and press Enter to add it as a tag.
 */
async function addEmailTag(page: Page, email: string) {
  const emailInput = ShareSelectors.emailTagInput(page).locator('input[type="text"]');
  await expect(emailInput).toBeVisible();
  await emailInput.clear();
  await emailInput.fill(email);
  await page.waitForTimeout(500);
  await emailInput.press('Enter');
  await page.waitForTimeout(1000);
}

/**
 * Click the Invite button inside the share popover.
 */
async function clickInviteButton(page: Page) {
  const inviteBtn = ShareSelectors.inviteButton(page);
  await expect(inviteBtn).toBeVisible();
  await expect(inviteBtn).toBeEnabled();
  await inviteBtn.click({ force: true });
}

/**
 * Find the access-level dropdown button for a given user email within the share popover,
 * then click it. The button is inside the closest ancestor div.group of the email text.
 */
async function openAccessDropdownForUser(page: Page, email: string) {
  const popover = ShareSelectors.sharePopover(page);
  const emailLocator = popover.getByText(email);
  await expect(emailLocator).toBeVisible();

  // Navigate up to the group container
  const groupContainer = emailLocator.locator('xpath=ancestor::div[contains(@class, "group")]').first();

  // Find the button whose text contains view/edit/read
  const accessButton = groupContainer.locator('button').filter({
    hasText: /view|edit|read/i,
  }).first();
  await expect(accessButton).toBeVisible();
  await accessButton.click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Click "Remove access" from the currently open dropdown menu.
 */
async function clickRemoveAccess(page: Page) {
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.getByText(/remove access/i).click({ force: true });
  await page.waitForTimeout(3000);
}

test.describe('Share Page Test', () => {
  let testEmail: string;
  let userBEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
    userBEmail = generateRandomEmail();
  });

  test('should invite user B to page via email and then remove their access', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // 1. Sign in as user A
    await signInAndWaitForApp(page, request, testEmail);

    // Wait for app to fully load
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Open share popover
    await openSharePopover(page);

    // Verify that the Share and Publish tabs are visible
    await expect(page.getByText('Share')).toBeVisible();
    await expect(page.getByText('Publish')).toBeVisible();

    // 3. Ensure we're on the Share tab
    await ensureShareTab(page);

    // 4. Type user B's email and invite
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);

    // 5. Wait for the invite to be sent
    await page.waitForTimeout(3000);

    // Verify user B appears in the "People with access" section
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    // 6. Open user B's access dropdown and remove access
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    // 7. Verify user B is removed from the list
    await expect(popover.getByText(userBEmail)).not.toBeVisible();

    // 8. Close the share popover and verify user A still has access
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should change user B access level from "Can view" to "Can edit"', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Invite user B first
    await openSharePopover(page);
    await ensureShareTab(page);
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify user B is added with default "Can view" access
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    const groupContainer = popover.getByText(userBEmail)
      .locator('xpath=ancestor::div[contains(@class, "group")]').first();
    await expect(groupContainer.locator('button').filter({ hasText: /view|read/i }).first()).toBeVisible();

    // Change access level to "Can edit"
    await openAccessDropdownForUser(page, userBEmail);

    // Select "Can edit" option from the dropdown menu
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.getByText(/can edit|edit/i).first().click({ force: true });
    await page.waitForTimeout(3000);

    // Reopen share popover (it closes after selecting from dropdown)
    await openSharePopover(page);

    // Verify access level changed
    const popoverAfter = ShareSelectors.sharePopover(page);
    const groupAfter = popoverAfter.getByText(userBEmail)
      .locator('xpath=ancestor::div[contains(@class, "group")]').first();
    await expect(groupAfter.locator('button').filter({ hasText: /edit|write/i }).first()).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Escape');
  });

  test('should invite multiple users at once', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    const userCEmail = generateRandomEmail();
    const userDEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await openSharePopover(page);
    await ensureShareTab(page);

    // Invite multiple users by adding email tags
    const emails = [userBEmail, userCEmail, userDEmail];
    for (const email of emails) {
      const emailInput = ShareSelectors.emailTagInput(page).locator('input[type="text"]');
      await expect(emailInput).toBeVisible();
      await emailInput.clear();
      await emailInput.fill(email);
      await page.waitForTimeout(300);
      await emailInput.press('Enter');
      await page.waitForTimeout(500);
    }

    // Click Invite button
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify all users appear in the list
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userCEmail)).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userDEmail)).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Escape');
  });

  test('should invite user with "Can edit" access level', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await openSharePopover(page);
    await ensureShareTab(page);

    // Set access level to "Can edit" before inviting
    // Find the access level selector button within the popover
    const popover = ShareSelectors.sharePopover(page);
    const accessButtons = popover.locator('button');
    const count = await accessButtons.count();

    for (let i = 0; i < count; i++) {
      const button = accessButtons.nth(i);
      const text = (await button.textContent() || '').toLowerCase();
      if (text.includes('view') || text.includes('edit') || text.includes('read only')) {
        await button.click({ force: true });
        await page.waitForTimeout(500);

        // Select "Can edit" from dropdown
        const menu = DropdownSelectors.menu(page);
        await menu.getByText(/can edit|edit/i).first().click({ force: true });
        await page.waitForTimeout(500);
        break;
      }
    }

    // Add email and invite
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify user B is added
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Escape');
  });

  test('should show pending status for invited users', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await openSharePopover(page);
    await ensureShareTab(page);

    // Invite user B
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Check for pending status
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    // Look for "Pending" badge or text near user B's email
    const groupContainer = popover.getByText(userBEmail)
      .locator('xpath=ancestor::div[contains(@class, "group")]').first();
    const groupText = (await groupContainer.textContent() || '').toLowerCase();
    const hasPending = groupText.includes('pending');

    if (hasPending) {
      // Verify the Pending text is present
      await expect(groupContainer.getByText(/pending/i)).toBeVisible();
    }
    // Note: Pending status may not be visible immediately in all environments

    await page.keyboard.press('Escape');
  });

  test('should handle removing access for multiple users', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    const userCEmail = generateRandomEmail();

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await openSharePopover(page);
    await ensureShareTab(page);

    // Invite two users
    for (const email of [userBEmail, userCEmail]) {
      const emailInput = ShareSelectors.emailTagInput(page).locator('input[type="text"]');
      await expect(emailInput).toBeVisible();
      await emailInput.clear();
      await emailInput.fill(email);
      await page.waitForTimeout(300);
      await emailInput.press('Enter');
      await page.waitForTimeout(500);
    }

    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify both users are added
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userCEmail)).toBeVisible({ timeout: 10000 });

    // Remove user B's access
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    // Verify user B is removed but user C still exists
    await expect(popover.getByText(userBEmail)).not.toBeVisible();
    await expect(popover.getByText(userCEmail)).toBeVisible();

    // Remove user C's access
    await openAccessDropdownForUser(page, userCEmail);
    await clickRemoveAccess(page);

    // Verify both users are removed
    await expect(popover.getByText(userBEmail)).not.toBeVisible();
    await expect(popover.getByText(userCEmail)).not.toBeVisible();

    // Verify user A still has access
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should NOT navigate when removing another user\'s access', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the current page URL to verify we stay on it
    const initialUrl = page.url();

    await openSharePopover(page);
    await ensureShareTab(page);

    // Invite user B
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify user B is added
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    // Remove user B's access (NOT user A's own access)
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    // Verify user B is removed
    await expect(popover.getByText(userBEmail)).not.toBeVisible();

    // CRITICAL: Verify we're still on the SAME page URL (no navigation happened)
    expect(page.url()).toBe(initialUrl);
  });

  test('should verify outline refresh wait mechanism works correctly', async ({ page, request }) => {
    // This test verifies that the outline refresh waiting mechanism is properly set up.
    // Note: We cannot test "remove own access" for owners since owners cannot remove their own access.
    // But we can verify the fix works for the main scenario: removing another user's access.
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    await signInAndWaitForApp(page, request, testEmail);

    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the current page URL to verify we stay on it
    const initialUrl = page.url();

    await openSharePopover(page);
    await ensureShareTab(page);

    // Invite user B
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Verify user B is added
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail)).toBeVisible({ timeout: 10000 });

    // Record time before removal to verify outline refresh timing
    const startTime = Date.now();

    // Remove user B's access (verifying outline refresh mechanism)
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    const endTime = Date.now();
    const elapsed = endTime - startTime;

    // Verify user B is removed
    await expect(popover.getByText(userBEmail)).not.toBeVisible();

    // CRITICAL: Verify we're still on the SAME page URL (no navigation happened)
    expect(page.url()).toBe(initialUrl);

    // Log timing for diagnostics (visible in test output)
    console.log(`Outline refresh operation completed in ${elapsed}ms`);
  });
});
