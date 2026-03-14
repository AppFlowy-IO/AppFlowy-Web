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
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { addPropertyColumn } from '../../support/database-ui-helpers';
import { testLog } from '../../support/test-helpers';

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
    // Given: a signed-in user with a grid database containing a Person field
    const testEmail = generateRandomEmail();
    testLog.info('[TEST START] Person cell in published database');

    await signInAndWaitForApp(page, request, testEmail);
    testLog.info('Signed in successfully');
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 2: Create a Grid database
    testLog.info('[STEP 2] Creating Grid database');
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });
    testLog.info('Grid database created');

    // Step 3: Add a Person field
    testLog.info('[STEP 3] Adding Person field');
    await addPropertyColumn(page, FieldType.Person);
    await expect(PersonSelectors.allPersonCells(page).first()).toBeAttached({ timeout: 15000 });
    testLog.info('Person field added');

    // Step 4: Publishing the database
    testLog.info('[STEP 4] Publishing the database');
    const dialogCount = await page.locator('[role="dialog"]').count();
    if (dialogCount > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
    await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(1000);

    await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 5000 });
    await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
    await page.waitForTimeout(1000);

    await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible();
    await ShareSelectors.publishConfirmButton(page).click({ force: true });
    testLog.info('Clicked Publish button');
    await page.waitForTimeout(5000);

    await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });
    testLog.info('Database published successfully');

    const namespace = (await ShareSelectors.publishNamespace(page).innerText()).trim();
    const publishName = await ShareSelectors.publishNameInput(page).inputValue();
    const origin = new URL(page.url()).origin;
    const publishedUrl = `${origin}/${namespace}/${publishName.trim()}`;
    testLog.info(`Published URL: ${publishedUrl}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Step 6: Visit the published page
    testLog.info('[STEP 6] Visiting published database page');
    await page.goto(publishedUrl, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // Step 7: Verify the page rendered without errors
    testLog.info('[STEP 7] Verifying page rendered correctly');
    // Then: the page renders without React context errors
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('useCurrentWorkspaceId must be used within');
    expect(bodyText).not.toContain('Minified React error #321');
    testLog.info('No critical errors detected on page');

    // And: the database structure is visible
    await expect(page.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
    testLog.info('Database container is visible');

    testLog.info('[TEST COMPLETE] Person cell rendered successfully in publish view');
  });

  test('should not throw context errors when viewing published page with Person cells', async ({
    page,
    request,
  }) => {
    testLog.info('[TEST START] Context error prevention test');

    // Given: a signed-in user with error monitoring enabled
    const testEmail = generateRandomEmail();
    const contextErrors: string[] = [];

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

    // And: a grid database with a Person field is created and published
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(1000);
    await AddPageSelectors.addGridButton(page).click({ force: true });
    await page.waitForTimeout(5000);

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    await addPropertyColumn(page, FieldType.Person);

    const dlgCount = await page.locator('[role="dialog"]').count();
    if (dlgCount > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
    await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(1000);
    await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 5000 });
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

    // When: visiting the published page
    await page.goto(publishedUrl, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // And: waiting for potential errors to surface
    await page.waitForTimeout(3000);

    // Then: no React context errors were thrown
    expect(contextErrors).toHaveLength(0);

    testLog.info('No context errors detected');
    testLog.info('[TEST COMPLETE] Context error prevention verified');
  });
});
