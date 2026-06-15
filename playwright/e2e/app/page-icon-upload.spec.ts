import { test, expect } from '@playwright/test';
import { AddPageSelectors, PageIconSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';

/**
 * Tests for page icon upload functionality.
 * Migrated from: cypress/e2e/app/page-icon-upload.cy.ts
 */
test.describe('Page Icon Upload', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    testEmail = generateRandomEmail();

    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Failed to fetch dynamically imported module')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.fixme('should upload page icon image and display after refresh', async ({ page, request }) => {
    // Set up route handler for file upload BEFORE navigating
    let fileUploadDetected = false;
    await page.route('**/api/file_storage/**', async (route) => {
      if (route.request().method() === 'PUT') {
        fileUploadDetected = true;
      }
      await route.continue();
    });

    // 1. Sign in
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Create a new page
    await AddPageSelectors.inlineAddButton(page).first().click();
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"]').first().click(); // Create Doc
    await page.waitForTimeout(1000);

    // 3. Click "Add icon" button (force click since it's hidden until hover)
    await PageIconSelectors.addIconButton(page).first().click({ force: true });
    await page.waitForTimeout(500);

    // 4. Click Upload tab
    await PageIconSelectors.iconPopoverTabUpload(page).click();
    await page.waitForTimeout(500);

    // 5. Upload image via file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('playwright/fixtures/test-icon.png');

    // Wait for upload to complete
    await expect(async () => {
      expect(fileUploadDetected).toBe(true);
    }).toPass({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // 6. Verify icon changed to uploaded image in sidebar
    await expect(PageIconSelectors.pageIconImage(page)).toBeVisible();
    const src = await PageIconSelectors.pageIconImage(page).getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toMatch(/^blob:|file_storage/);

    // 7. Refresh the page
    await page.reload();
    await page.waitForTimeout(3000);

    // 8. Verify uploaded image icon persists after refresh
    await expect(PageIconSelectors.pageIconImage(page)).toBeVisible();
    const srcAfterReload = await PageIconSelectors.pageIconImage(page).getAttribute('src');
    expect(srcAfterReload).toMatch(/^blob:/);
  });

  test('should display emoji icon correctly', async ({ page, request }) => {
    // 1. Sign in
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Create a new page
    await AddPageSelectors.inlineAddButton(page).first().click();
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"]').first().click();
    await page.waitForTimeout(1000);

    // 3. Click "Add icon" button (force click since it's hidden until hover)
    await PageIconSelectors.addIconButton(page).first().click({ force: true });
    await page.waitForTimeout(500);

    // 4. Emoji tab should be default, click on emoji tab
    await PageIconSelectors.iconPopoverTabEmoji(page).click();
    await page.waitForTimeout(300);

    // 5. Click on any emoji in the picker
    await page.locator('button.text-xl').first().click({ force: true });
    await page.waitForTimeout(500);

    // 6. Verify emoji is displayed in sidebar (not an image)
    await expect(PageIconSelectors.pageIconImage(page)).not.toBeVisible();
    await expect(PageIconSelectors.pageIcon(page).first()).toBeVisible();

    // 7. Refresh the page
    await page.reload();
    await page.waitForTimeout(2000);

    // 8. Verify emoji icon persists after refresh (not an image)
    await expect(PageIconSelectors.pageIconImage(page)).not.toBeVisible();
    await expect(PageIconSelectors.pageIcon(page).first()).toBeVisible();
  });
});
