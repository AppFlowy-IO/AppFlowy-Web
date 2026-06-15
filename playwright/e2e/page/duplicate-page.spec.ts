import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DropdownSelectors,
  EditorSelectors,
  HeaderSelectors,
  PageSelectors,
  SpaceSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../support/test-helpers';

/**
 * Duplicate Page Tests
 * Migrated from: cypress/e2e/page/duplicate-page.cy.ts
 */
test.describe('Duplicate Page', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test('should create a document, type hello world, duplicate it, and verify content in duplicated document', async ({
    page,
    request,
  }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error')
      ) {
        return;
      }
    });

    // Step 1: Sign in
    await signInAndWaitForApp(page, request, testEmail);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 2: Create a new document page in General space
    await SpaceSelectors.itemByName(page, 'General').first().click();
    await page.waitForTimeout(500);

    const generalSpace = SpaceSelectors.itemByName(page, 'General').first();
    const inlineAdd = generalSpace.getByTestId('inline-add-page').first();
    await expect(inlineAdd).toBeVisible();
    await inlineAdd.click();
    await page.waitForTimeout(1000);

    await DropdownSelectors.menuItem(page).first().click();
    await page.waitForTimeout(2000);

    // Step 3: Exit modal mode by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Step 4: Open the created page from sidebar
    await PageSelectors.nameContaining(page, 'Untitled').first().click({ force: true });
    await page.waitForTimeout(2000);

    // Step 5: Type "hello world" in the document
    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.type('hello world');
    await page.waitForTimeout(2000);

    await expect(page.getByText('hello world')).toBeVisible();

    // Step 6: Duplicate the document from the header
    await HeaderSelectors.moreActionsButton(page).click({ force: true });
    await page.waitForTimeout(500);

    const dropdownContent = DropdownSelectors.content(page);
    await dropdownContent.getByText('Duplicate').click();

    // Verify blocking loader appears (duplication started)
    await expect(page.getByTestId('blocking-loader')).toBeVisible({ timeout: 5000 });

    // Wait for duplication to complete
    await expect(page.getByTestId('blocking-loader')).toBeHidden({ timeout: 30000 });

    // Step 7: Find and open the duplicated document
    const allPages = PageSelectors.names(page);
    const allPageTexts = await allPages.allTextContents();

    // Look for a page with "(copy)" suffix
    const copyPageIndex = allPageTexts.findIndex(
      (text) => text.includes('Untitled') && text.includes('(copy)')
    );

    if (copyPageIndex >= 0) {
      await allPages.nth(copyPageIndex).click({ force: true });
    } else {
      // Look for second Untitled page
      const untitledIndices = allPageTexts
        .map((text, i) => (text.includes('Untitled') ? i : -1))
        .filter((i) => i >= 0);

      if (untitledIndices.length > 1) {
        await allPages.nth(untitledIndices[1]).click({ force: true });
      } else {
        await PageSelectors.nameContaining(page, 'Untitled').first().click({ force: true });
      }
    }

    await page.waitForTimeout(2000);

    // Step 8: Verify the duplicated document contains "hello world"
    await expect(page.getByText('hello world')).toBeVisible({ timeout: 10000 });

    // Step 9: Modify the content in the duplicated document
    await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.type(' - modified in copy');
    await page.waitForTimeout(2000);

    await expect(page.getByText('hello world - modified in copy')).toBeVisible();
  });
});
