/**
 * Test for Person Cell in Published/Template Pages
 *
 * Verifies that:
 * 1. Person cells render correctly in published (read-only) views
 * 2. No React context errors occur when viewing templates
 * 3. The useMentionableUsers hook handles publish mode gracefully
 *
 * Migrated from: cypress/e2e/database/person-cell-publish.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  FieldType,
  PageSelectors,
  PersonSelectors,
  PropertyMenuSelectors,
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

test.describe('Person Cell in Published Pages', () => {
  test.beforeEach(async ({ page }) => {
    // Monitor for context errors that should FAIL the test
    page.on('pageerror', (err) => {
      if (
        err.message.includes('useCurrentWorkspaceId must be used within an AppProvider') ||
        err.message.includes('useAppHandlers must be used within an AppProvider') ||
        err.message.includes('Invalid hook call') ||
        err.message.includes('Minified React error #321')
      ) {
        throw err; // Fail the test on context errors
      }

      // Suppress known benign errors
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes('Record not found') ||
        err.message.includes('Request failed') ||
        err.message.includes("Failed to execute 'writeText' on 'Clipboard'") ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should render Person cell without errors in published database view', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Step 1: Login
    await signInAndWaitForApp(page, request, testEmail);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 2: Create a Grid database
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    // Step 3: Add a Person field
    await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
    await PropertyMenuSelectors.newPropertyButton(page).first().click({ force: true });
    await page.waitForTimeout(3000);

    const trigger = PropertyMenuSelectors.propertyTypeTrigger(page);
    if ((await trigger.count()) > 0) {
      await trigger.first().click({ force: true });
      await page.waitForTimeout(1000);
      await PropertyMenuSelectors.propertyTypeOption(page, FieldType.Person).click({ force: true });
      await page.waitForTimeout(2000);
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Verify Person cells exist
    await expect(PersonSelectors.allPersonCells(page).first()).toBeVisible({ timeout: 10000 });

    // Step 4: Publish the database
    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
    await ShareSelectors.shareButton(page).click({ force: true });
    await page.waitForTimeout(1000);

    await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
    await page.waitForTimeout(1000);

    await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible();
    await ShareSelectors.publishConfirmButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    // Get the published URL
    await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });

    const namespace = (await ShareSelectors.publishNamespace(page).innerText()).trim();
    const publishName = await ShareSelectors.publishNameInput(page).inputValue();
    const origin = new URL(page.url()).origin;
    const publishedUrl = `${origin}/${namespace}/${publishName.trim()}`;

    // Close share popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Step 5: Visit the published page
    await page.goto(publishedUrl, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // Step 6: Verify the page rendered without errors
    await expect(page.locator('body')).toBeVisible();

    // Check for regression errors
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('useCurrentWorkspaceId must be used within');
    expect(bodyText).not.toContain('Minified React error #321');

    // Verify database structure is visible
    await expect(page.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
  });

  test('should not throw context errors when viewing published page with Person cells', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const contextErrors: string[] = [];

    // Set up error monitoring - collect but don't throw immediately
    page.on('pageerror', (err) => {
      if (
        err.message.includes('useCurrentWorkspaceId must be used within') ||
        err.message.includes('useAppHandlers must be used within') ||
        err.message.includes('Minified React error #321') ||
        err.message.includes('Invalid hook call')
      ) {
        contextErrors.push(err.message);
      }
    });

    await signInAndWaitForApp(page, request, testEmail);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Create a grid
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    // Add Person field
    await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
    await PropertyMenuSelectors.newPropertyButton(page).first().click({ force: true });
    await page.waitForTimeout(3000);

    const trigger = PropertyMenuSelectors.propertyTypeTrigger(page);
    if ((await trigger.count()) > 0) {
      await trigger.first().click({ force: true });
      await page.waitForTimeout(1000);
      await PropertyMenuSelectors.propertyTypeOption(page, FieldType.Person).click({ force: true });
      await page.waitForTimeout(2000);
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Publish
    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
    await ShareSelectors.shareButton(page).click({ force: true });
    await page.waitForTimeout(1000);
    await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
    await page.waitForTimeout(1000);
    await ShareSelectors.publishConfirmButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });

    const namespace = (await ShareSelectors.publishNamespace(page).innerText()).trim();
    const publishName = await ShareSelectors.publishNameInput(page).inputValue();
    const origin = new URL(page.url()).origin;
    const publishedUrl = `${origin}/${namespace}/${publishName.trim()}`;

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Visit published page
    await page.goto(publishedUrl, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // Wait for potential errors to occur
    await page.waitForTimeout(3000);

    // Verify no context errors were caught
    expect(contextErrors).toHaveLength(0);
  });
});
