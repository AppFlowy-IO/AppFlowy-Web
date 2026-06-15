/**
 * Publish/Unpublish Panel State Test
 *
 * After unpublishing and refreshing the page, the publish panel should
 * show the unpublished state (Publish button), not the stale published state.
 */
import { test, expect, Page } from '@playwright/test';
import {
  ShareSelectors,
  SidebarSelectors,
  PageSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { testLog } from '../../support/test-helpers';

function suppressBenignErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('No workspace or service found') ||
      err.message.includes('createThemeNoVars_default is not a function') ||
      err.message.includes('View not found') ||
      err.message.includes('Record not found') ||
      err.message.includes('ResizeObserver loop')
    ) {
      return;
    }
  });
}

async function openSharePopover(page: Page) {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);
}

test.describe('Publish/Unpublish Panel State', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('after unpublish and page refresh, panel should show Publish button', async ({
    page,
    request,
  }) => {
    suppressBenignErrors(page);

    // Given: signed in with app loaded
    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('Signed in');
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // When: opening the share popover and publishing
    await openSharePopover(page);
    const popover = ShareSelectors.sharePopover(page);

    await expect(popover).toBeVisible({ timeout: 5000 });
    await popover.getByText('Publish', { exact: true }).click({ force: true });
    await page.waitForTimeout(1000);

    await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible();
    await ShareSelectors.publishConfirmButton(page).click({ force: true });
    await page.waitForTimeout(5000);
    testLog.info('Page published');

    // Then: the panel shows published state (Unpublish button visible)
    await expect(popover.getByText('Unpublish')).toBeVisible({ timeout: 10000 });
    testLog.info('Published state confirmed');

    // When: clicking Unpublish
    await popover.getByText('Unpublish').click({ force: true });
    await page.waitForTimeout(3000);
    testLog.info('Unpublished');

    // Then: the panel shows the Publish button (unpublished state)
    await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 10000 });
    testLog.info('Panel shows Publish button after unpublish');

    // When: closing the popover and refreshing the page
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(5000);
    testLog.info('Page refreshed');

    // And: reopening the share popover
    await openSharePopover(page);
    const popoverAfter = ShareSelectors.sharePopover(page);

    await expect(popoverAfter).toBeVisible({ timeout: 5000 });
    await popoverAfter.getByText('Publish', { exact: true }).click({ force: true });
    await page.waitForTimeout(2000);

    // Then: the panel should show Publish button (NOT Unpublish/Visit site)
    await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 10000 });
    testLog.info('After refresh, panel correctly shows Publish button');

    // And: Unpublish button should NOT be visible
    await expect(popoverAfter.getByText('Unpublish')).not.toBeVisible();
    testLog.info('Unpublish button is not visible — correct unpublished state');
  });
});
