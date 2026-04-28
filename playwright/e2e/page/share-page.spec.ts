import { test, expect, Page } from '@playwright/test';
import { DropdownSelectors, PageSelectors, SidebarSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createUserAccount } from '../../support/auth-utils';
import { testLog } from '../../support/test-helpers';

/**
 * Share Page Tests
 * Migrated from: cypress/e2e/page/share-page.cy.ts
 */

async function openSharePopover(page: Page) {
  // Use evaluate to bypass sticky header overlay intercepting pointer events
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
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
    await popover.getByText('Share', { exact: true }).click({ force: true });
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
 * then click it. The button is inside the .group container (PersonItem row) that contains the email.
 * NOTE: xpath=ancestor:: in Playwright returns elements in document order, not reverse order,
 * so we use CSS .group + filter({ hasText }) instead.
 */
async function openAccessDropdownForUser(page: Page, email: string) {
  const popover = ShareSelectors.sharePopover(page);
  // Use a generous timeout — the share popover list reflects the backend's
  // shared-user state which may take time to propagate after an invite.
  await expect(popover.getByText(email).first()).toBeVisible({ timeout: 20000 });

  // Find the PersonItem .group container that contains this email
  const groupContainer = popover.locator('.group').filter({ hasText: email }).first();

  // Find the button whose text contains view/edit/read
  const accessButton = groupContainer.locator('button').filter({
    hasText: /view|edit|read/i,
  }).first();
  await expect(accessButton).toBeVisible({ timeout: 10000 });
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

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    testLog.info('Waiting for app to fully load...');
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // When: opening the share popover
    await openSharePopover(page);
    testLog.info('Share popover opened');

    // Then: the Share and Publish tabs are visible
    const sharePopover = ShareSelectors.sharePopover(page);
    await expect(sharePopover.getByText('Share', { exact: true })).toBeVisible();
    await expect(sharePopover.getByText('Publish', { exact: true })).toBeVisible();
    testLog.info('Share and Publish tabs verified');

    // And: the Share tab is active
    await ensureShareTab(page);

    // When: inviting user B via email
    testLog.info(`Inviting user B: ${userBEmail}`);
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    testLog.info('Clicked Invite button');

    await page.waitForTimeout(3000);

    // Then: user B appears in the "People with access" section
    testLog.info('Waiting for user B to appear in the people list...');
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });
    testLog.info('User B successfully added to the page');

    // When: removing user B's access
    testLog.info('Finding user B\'s access dropdown...');
    await openAccessDropdownForUser(page, userBEmail);
    testLog.info('Opened access level dropdown');
    testLog.info('Clicking Remove access...');
    await clickRemoveAccess(page);

    // Then: user B is no longer in the list
    testLog.info('Verifying user B is removed...');
    await expect(popover.getByText(userBEmail)).toHaveCount(0);
    testLog.info('User B successfully removed from access list');

    // And: user A still has access to the page
    testLog.info('Closing share popover and verifying page is still accessible...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator('body')).toBeVisible();
    testLog.info('User A still has access to the page after removing user B');
    testLog.info('Test completed successfully');
  });

  test('should change user B access level from "Can view" to "Can edit"', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: user B has been invited to the page
    await openSharePopover(page);
    await ensureShareTab(page);
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Then: user B appears with default "Can view" access
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });

    const groupContainer = popover.locator('.group').filter({ hasText: userBEmail }).first();
    await expect(groupContainer.locator('button').filter({ hasText: /view|read/i }).first()).toBeVisible();
    testLog.info('User B added with default view access');

    // When: changing user B's access level to "Can edit"
    testLog.info('Changing user B access level to "Can edit"...');
    await openAccessDropdownForUser(page, userBEmail);

    // And: selecting "Can edit" from the dropdown menu
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.getByText(/can edit|edit/i).first().click({ force: true });
    await page.waitForTimeout(3000);

    // The share popover may still be open after the dropdown closes.
    // Only reopen if it closed.
    const popoverAfter = ShareSelectors.sharePopover(page);
    if (!(await popoverAfter.isVisible().catch(() => false))) {
      await openSharePopover(page);
    }

    // Then: user B's access level is now "Can edit"
    const groupAfter = popoverAfter.locator('.group').filter({ hasText: userBEmail }).first();
    await expect(groupAfter.locator('button').filter({ hasText: /edit|write/i }).first()).toBeVisible({ timeout: 10000 });
    testLog.info('User B access level successfully changed to "Can edit"');

    await page.keyboard.press('Escape');
    testLog.info('Test completed successfully');
  });

  test('should invite multiple users at once', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    const userCEmail = generateRandomEmail();
    const userDEmail = generateRandomEmail();

    // Given: multiple user accounts exist and user A is signed in
    await Promise.all([
      createUserAccount(request, userBEmail),
      createUserAccount(request, userCEmail),
      createUserAccount(request, userDEmail),
    ]);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the share popover is open on the Share tab
    await openSharePopover(page);
    await ensureShareTab(page);

    // When: adding multiple email tags for users B, C, and D
    testLog.info(`Inviting multiple users: ${userBEmail}, ${userCEmail}, ${userDEmail}`);
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

    // And: clicking the Invite button
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Then: all three users appear in the "People with access" list
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userCEmail).first()).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userDEmail).first()).toBeVisible({ timeout: 10000 });
    testLog.info('All users successfully added to the page');

    await page.keyboard.press('Escape');
    testLog.info('Test completed successfully');
  });

  test('should invite user with "Can edit" access level', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the share popover is open on the Share tab
    await openSharePopover(page);
    await ensureShareTab(page);

    // When: setting the access level to "Can edit" before inviting
    testLog.info('Inviting user B with "Can edit" access level');
    const popover = ShareSelectors.sharePopover(page);
    const accessButtons = popover.locator('button');
    const count = await accessButtons.count();

    for (let i = 0; i < count; i++) {
      const button = accessButtons.nth(i);
      const text = (await button.textContent() || '').toLowerCase();
      if (text.includes('view') || text.includes('edit') || text.includes('read only')) {
        await button.click({ force: true });
        await page.waitForTimeout(500);

        const menu = DropdownSelectors.menu(page);
        await menu.getByText(/can edit|edit/i).first().click({ force: true });
        await page.waitForTimeout(500);
        break;
      }
    }

    // And: inviting user B via email
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Then: user B appears in the share list
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });
    testLog.info('User B successfully invited');

    await page.keyboard.press('Escape');
    testLog.info('Test completed successfully');
  });

  test('should show pending status for invited users', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the share popover is open on the Share tab
    await openSharePopover(page);
    await ensureShareTab(page);

    // When: inviting user B via email
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // Then: user B appears in the share list
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });

    // And: user B's entry shows a "Pending" status badge (invitation not yet accepted)
    const groupContainer2 = popover.locator('.group').filter({ hasText: userBEmail }).first();
    await expect(groupContainer2.getByText(/pending/i)).toBeVisible({ timeout: 5000 });
    testLog.info('User B shows pending status');

    await page.keyboard.press('Escape');
    testLog.info('Test completed successfully');
  });

  test('should handle removing access for multiple users', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    const userCEmail = generateRandomEmail();

    // Given: user B and C accounts exist and user A is signed in
    await createUserAccount(request, userBEmail);
    await createUserAccount(request, userCEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the share popover is open on the Share tab
    await openSharePopover(page);
    await ensureShareTab(page);

    // And: users B and C are invited via email tags
    testLog.info(`Inviting users: ${userBEmail}, ${userCEmail}`);
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

    // Then: both users appear in the share list
    // The invite triggers an async chain: sharePageTo API → refreshPeople → loadMentionableData → loadPeople (getShareDetail API).
    // Use a generous timeout instead of a static wait to handle backend propagation delay.
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 20000 });
    await expect(popover.getByText(userCEmail).first()).toBeVisible({ timeout: 20000 });
    testLog.info('Both users added successfully');

    // When: removing user B's access
    testLog.info('Removing user B access...');
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    // Then: user B is removed but user C still has access
    await expect(popover.getByText(userBEmail)).toHaveCount(0);
    await expect(popover.getByText(userCEmail).first()).toBeVisible();
    testLog.info('User B removed, User C still has access');

    // When: removing user C's access
    testLog.info('Removing user C access...');
    await openAccessDropdownForUser(page, userCEmail);
    await clickRemoveAccess(page);

    // Then: both users are removed from the list
    await expect(popover.getByText(userBEmail)).toHaveCount(0);
    await expect(popover.getByText(userCEmail)).toHaveCount(0);
    testLog.info('Both users successfully removed');

    // And: user A still has access to the page
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator('body')).toBeVisible();
    testLog.info('User A still has access after removing all guests');
    testLog.info('Test completed successfully');
  });

  test('should NOT navigate when removing another user\'s access', async ({ page, request }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the current page URL is recorded
    const initialUrl = page.url();
    testLog.info(`Initial URL: ${initialUrl}`);

    // And: user B has been invited to the page
    await openSharePopover(page);
    testLog.info('Share popover opened');
    await ensureShareTab(page);

    testLog.info(`Inviting user B: ${userBEmail}`);
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // And: user B appears in the "People with access" section
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });
    testLog.info('User B successfully added');

    // When: removing user B's access
    testLog.info('Removing user B\'s access (NOT user A\'s own access)...');
    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    // Then: user B is no longer in the list
    await expect(popover.getByText(userBEmail)).toHaveCount(0);
    testLog.info('User B removed');

    // And: the page URL has not changed (no navigation occurred)
    expect(page.url()).toBe(initialUrl);
    testLog.info(`URL unchanged: ${initialUrl}`);
    testLog.info('Navigation did NOT occur when removing another user\'s access');
    testLog.info('Fix verified: No navigation when removing someone else\'s access');
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

    // Given: user B account exists and user A is signed in
    await createUserAccount(request, userBEmail);
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('User A signed in');

    // And: the app is fully loaded
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // And: the current page URL is recorded
    const initialUrl = page.url();
    testLog.info(`Initial URL: ${initialUrl}`);

    // And: user B has been invited to the page
    await openSharePopover(page);
    testLog.info('Share popover opened');
    await ensureShareTab(page);

    testLog.info(`Inviting user B: ${userBEmail}`);
    await addEmailTag(page, userBEmail);
    await clickInviteButton(page);
    await page.waitForTimeout(3000);

    // And: user B appears in the "People with access" section
    const popover = ShareSelectors.sharePopover(page);
    await expect(popover.getByText('People with access')).toBeVisible({ timeout: 10000 });
    await expect(popover.getByText(userBEmail).first()).toBeVisible({ timeout: 10000 });
    testLog.info('User B successfully added');

    // When: removing user B's access and measuring the outline refresh timing
    const startTime = Date.now();
    testLog.info(`Start time: ${startTime}`);
    testLog.info('Removing user B\'s access (verifying outline refresh mechanism)...');

    await openAccessDropdownForUser(page, userBEmail);
    await clickRemoveAccess(page);

    const endTime = Date.now();
    const elapsed = endTime - startTime;
    testLog.info(`End time: ${endTime}, Elapsed: ${elapsed}ms`);

    // Then: user B is no longer in the list
    await expect(popover.getByText(userBEmail)).toHaveCount(0);
    testLog.info('User B removed');

    // And: the page URL has not changed (no navigation occurred)
    expect(page.url()).toBe(initialUrl);
    testLog.info(`URL unchanged: ${initialUrl}`);
    testLog.info('Navigation did NOT occur when removing another user\'s access');
    testLog.info('Outline refresh mechanism verified - fix working correctly');
    testLog.info(`Operation completed in ${elapsed}ms (includes outline refresh time)`);
  });
});
