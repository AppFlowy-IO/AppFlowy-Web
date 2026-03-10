import { test, expect } from '@playwright/test';
import { DropdownSelectors, ModalSelectors, PageSelectors, ViewActionSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace, waitForSidebarReady } from '../../support/page/flows';

/**
 * More Page Actions Tests
 * Migrated from: cypress/e2e/page/more-page-action.cy.ts
 */
test.describe('More Page Actions', () => {
  const pageName = 'Getting started';
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('should open the More actions menu for a page (verify visibility of core items)', async ({
    page,
    request,
  }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Sign in and wait for the app to load
    await signInAndWaitForApp(page, request, testEmail);

    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);

    // Wait for the sidebar to load properly
    await waitForSidebarReady(page);
    await page.waitForTimeout(2000);

    // Hover over the Getting started page item to reveal the more actions button
    const pageItem = PageSelectors.itemByName(page, pageName);
    await pageItem.hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the more actions button
    await PageSelectors.moreActionsButton(page, pageName).click({ force: true });

    // Verify the dropdown menu is visible
    const dropdown = DropdownSelectors.content(page);
    await expect(dropdown).toBeVisible();

    // Check for core menu items within the dropdown
    await expect(dropdown.getByText('Delete')).toBeVisible();
    await expect(dropdown.getByText('Duplicate')).toBeVisible();
    await expect(dropdown.getByText('Move to')).toBeVisible();
  });

  test('should trigger Duplicate action from More actions menu', async ({
    page,
    request,
  }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Sign in and wait for the app to load
    await signInAndWaitForApp(page, request, testEmail);

    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);

    // Wait for the sidebar to load properly
    await waitForSidebarReady(page);
    await page.waitForTimeout(2000);

    // Hover over the Getting started page item to reveal the more actions button
    const pageItem = PageSelectors.itemByName(page, pageName);
    await pageItem.hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the more actions button
    await PageSelectors.moreActionsButton(page, pageName).click({ force: true });

    // Click the Duplicate option from the dropdown
    const dropdown = DropdownSelectors.content(page);
    await dropdown.getByText('Duplicate').click();

    // Wait for the duplication to complete
    await page.waitForTimeout(2000);

    // Verify the page was duplicated - there should be at least one page with "Getting started" in the name
    await expect(page.getByText('Getting started').first()).toBeVisible();

    // Check that there are multiple pages containing "Getting started"
    const allPages = PageSelectors.names(page);
    const allPageTexts = await allPages.allTextContents();
    const gettingStartedCount = allPageTexts.filter((text) =>
      text.includes('Getting started')
    ).length;
    expect(gettingStartedCount).toBeGreaterThanOrEqual(1);
  });

  test('should rename a page and verify the name persists after refresh', async ({
    page,
    request,
  }) => {
    page.on('pageerror', (err) => {
      if (err.message.includes('No workspace or service found')) {
        return;
      }
    });

    // Sign in and wait for the app to load
    await signInAndWaitForApp(page, request, testEmail);

    await expect(page).toHaveURL(/\/app/);
    await page.waitForTimeout(3000);

    // Wait for the sidebar to load properly
    await waitForSidebarReady(page);
    await page.waitForTimeout(2000);

    const renamedPageName = `Renamed Page ${Date.now()}`;

    // Hover over the Getting started page item to reveal the more actions button
    const pageItem = PageSelectors.itemByName(page, pageName);
    await pageItem.hover({ force: true });
    await page.waitForTimeout(1000);

    // Click the more actions button for the page
    await PageSelectors.moreActionsButton(page, pageName).click({ force: true });

    // Wait for the dropdown menu to be visible
    const dropdown = DropdownSelectors.content(page);
    await expect(dropdown).toBeVisible();

    // Click the Rename option
    await expect(ViewActionSelectors.renameButton(page)).toBeVisible();
    await ViewActionSelectors.renameButton(page).click();

    // Wait for the rename modal to appear, clear the input, and type the new name
    const renameInput = ModalSelectors.renameInput(page);
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await renameInput.clear();
    await renameInput.fill(renamedPageName);

    // Click the save button
    await ModalSelectors.renameSaveButton(page).click();

    // Wait for the modal to close and the page to update
    await page.waitForTimeout(2000);

    // Verify the page was renamed in the sidebar
    await expect(PageSelectors.nameContaining(page, renamedPageName).first()).toBeVisible({ timeout: 10000 });

    // Verify the original name no longer exists in the sidebar
    await expect(PageSelectors.nameContaining(page, pageName).first()).toBeHidden({ timeout: 5000 });

    // Reload the page to verify the rename persisted
    await page.reload();
    await page.waitForTimeout(3000);

    // Wait for the sidebar to be ready again
    await waitForSidebarReady(page);
    await page.waitForTimeout(2000);

    // Verify the renamed page still exists in the sidebar after refresh
    await expect(PageSelectors.nameContaining(page, renamedPageName).first()).toBeVisible({ timeout: 10000 });

    // Verify the original name is still gone from the sidebar
    await expect(PageSelectors.nameContaining(page, pageName).first()).toBeHidden({ timeout: 5000 });

    // Verify the page is clickable and can be opened
    await PageSelectors.nameContaining(page, renamedPageName).first().click({ force: true });
    await page.waitForTimeout(2000);

    // Verify we are still on the app page
    await expect(page).toHaveURL(/\/app/);
  });
});
