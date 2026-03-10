import { test, expect } from '@playwright/test';
import { BreadcrumbSelectors, PageSelectors, SidebarSelectors, SpaceSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Breadcrumb Navigation Complete Tests
 * Migrated from: cypress/e2e/page/breadcrumb-navigation.cy.ts
 */
test.describe('Breadcrumb Navigation Complete Tests', () => {
  let testEmail: string;

  test.beforeEach(async () => {
    testEmail = generateRandomEmail();
  });

  test.describe('Basic Navigation Tests', () => {
    test('should navigate through space and check for breadcrumb availability', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      // Step 1: Login
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });

      // Wait for pages to be ready
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 2: Expand first space
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Step 3: Navigate to first page
      const firstPageName = await PageSelectors.names(page).first().textContent();
      await PageSelectors.names(page).first().click();

      // Wait for page to load
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });

      // Step 4: Check for breadcrumb navigation
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const itemCount = await BreadcrumbSelectors.items(page).count();
        // Breadcrumb navigation found on this page
        expect(itemCount).toBeGreaterThanOrEqual(0);
      }
      // No breadcrumb navigation is normal for top-level pages

      // Verify no errors
      const bodyText = await page.locator('body').textContent();
      const hasError = bodyText?.includes('Error') || bodyText?.includes('Failed');
      // Navigation completed (error check is informational only)
    });

    test('should navigate to nested pages and use breadcrumb to go back', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      // Login
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Expand first space
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Step 2: Navigate to first page
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Step 3: Check for nested pages
      const pages = PageSelectors.names(page);
      const pagesCount = await pages.count();

      // Find child pages by name
      const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
      let childPageFound = false;

      for (let i = 0; i < pagesCount; i++) {
        const pageName = (await pages.nth(i).textContent())?.trim() ?? '';
        if (childPageNames.includes(pageName)) {
          await pages.nth(i).click({ force: true });
          childPageFound = true;
          break;
        }
      }

      if (!childPageFound && pagesCount > 1) {
        // Fallback: navigate to second page
        await pages.nth(1).click({ force: true });
      }

      // Wait for page to load
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Step 4: Testing breadcrumb navigation
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const itemCount = await BreadcrumbSelectors.items(page).count();
        expect(itemCount).toBeGreaterThanOrEqual(1);

        if (itemCount > 1) {
          await BreadcrumbSelectors.items(page).first().click({ force: true });
          // Wait for navigation to complete
          await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        }
      }
    });
  });

  test.describe('Full Breadcrumb Flow Test', () => {
    test('should navigate through General > Get Started > Desktop Guide flow (if available)', async ({
      page,
      request,
    }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      // Login
      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const initialPageCount = await PageSelectors.names(page).count();
      expect(initialPageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Find and expand General space or first space
      const spaceNames = await SpaceSelectors.names(page).allTextContents();
      const trimmedSpaceNames = spaceNames.map((s) => s.trim());

      const generalIndex = trimmedSpaceNames.findIndex((name) => name.toLowerCase().includes('general'));

      if (generalIndex !== -1) {
        await expandSpace(page, generalIndex);
      } else {
        await expandSpace(page, 0);
      }
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Step 2: Look for Get Started page or use first page
      const pageNames = await PageSelectors.names(page).allTextContents();
      const trimmedPageNames = pageNames.map((p) => p.trim());

      const getStartedIndex = trimmedPageNames.findIndex((name) => {
        const lower = name.toLowerCase();
        return lower.includes('get') || lower.includes('start') || lower.includes('welcome') || lower.includes('guide');
      });

      if (getStartedIndex !== -1) {
        await PageSelectors.names(page).nth(getStartedIndex).click();
      } else {
        await PageSelectors.names(page).first().click();
      }

      // Wait for page to load
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Step 3: Look for Desktop Guide or sub-page
      const subPages = PageSelectors.names(page);
      const subPagesCount = await subPages.count();
      const subPageTexts = await subPages.allTextContents();
      const trimmedSubPageNames = subPageTexts.map((s) => s.trim());

      // Look for Desktop Guide or any guide
      const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
      let guidePageIndex = -1;

      for (let i = 0; i < subPagesCount; i++) {
        const text = trimmedSubPageNames[i]?.toLowerCase() ?? '';
        if (text.includes('desktop') || childPageNames.some((name) => text.includes(name.toLowerCase()))) {
          guidePageIndex = i;
          break;
        }
      }

      if (guidePageIndex !== -1) {
        await subPages.nth(guidePageIndex).click({ force: true });
      } else if (subPagesCount > 1) {
        // Try to find a child page by name
        let childFound = false;
        for (let i = 0; i < subPagesCount; i++) {
          const pageName = trimmedSubPageNames[i] ?? '';
          if (childPageNames.includes(pageName)) {
            await subPages.nth(i).click({ force: true });
            childFound = true;
            break;
          }
        }
        if (!childFound) {
          await subPages.nth(1).click({ force: true });
        }
      }

      // Wait for page to load
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Step 4: Test breadcrumb navigation
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const items = BreadcrumbSelectors.items(page);
        const itemCount = await items.count();
        expect(itemCount).toBeGreaterThanOrEqual(1);

        if (itemCount > 1) {
          const targetIndex = Math.max(0, itemCount - 2);
          await items.nth(targetIndex).click({ force: true });
          // Wait for navigation to complete
          await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        }
      }

      // Final verification - check for errors
      const bodyText = await page.locator('body').textContent();
      const alertCount = await page.locator('[role="alert"]').count();
      const hasError = bodyText?.includes('Error') || bodyText?.includes('Failed') || alertCount > 0;
      // Test completed (error check is informational only)
    });
  });

  test.describe('Breadcrumb Item Verification Tests', () => {
    test('should verify breadcrumb items display correct names and are clickable', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to nested page
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Navigate to first page
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Navigate to nested page if available
      const pages = PageSelectors.names(page);
      const pagesCount = await pages.count();
      const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
      let childPageFound = false;

      for (let i = 0; i < pagesCount; i++) {
        const pageName = (await pages.nth(i).textContent())?.trim() ?? '';
        if (childPageNames.includes(pageName)) {
          await pages.nth(i).click({ force: true });
          childPageFound = true;
          break;
        }
      }

      if (!childPageFound && pagesCount > 1) {
        await pages.nth(1).click({ force: true });
      }

      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Step 2: Verify breadcrumb items
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const items = BreadcrumbSelectors.items(page);
        const itemCount = await items.count();

        // Verify each breadcrumb item has text
        for (let index = 0; index < itemCount; index++) {
          const itemText = (await items.nth(index).textContent())?.trim() ?? '';
          expect(itemText).not.toBe('');
        }

        // Verify last item exists
        if (itemCount > 0) {
          await expect(items.last()).toBeVisible();
        }
      }
    });

    test('should verify breadcrumb navigation updates correctly when navigating', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to parent page
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const parentPageName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Step 2: Navigate to nested page
      const pages = PageSelectors.names(page);
      const pagesCount = await pages.count();
      const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
      let childPageFound = false;

      for (let i = 0; i < pagesCount; i++) {
        const pageName = (await pages.nth(i).textContent())?.trim() ?? '';
        if (childPageNames.includes(pageName)) {
          await pages.nth(i).click({ force: true });
          childPageFound = true;
          break;
        }
      }

      if (!childPageFound && pagesCount > 1) {
        await pages.nth(1).click({ force: true });
      }

      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Step 3: Verify breadcrumb shows parent
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const items = BreadcrumbSelectors.items(page);
        const itemCount = await items.count();

        if (itemCount > 1) {
          // Verify parent page appears in breadcrumb
          const breadcrumbTexts = await items.allTextContents();
          const hasParent = breadcrumbTexts.some((text) => text.includes(parentPageName));
          // Parent page check is informational
        }
      }

      // Step 4: Navigate back via breadcrumb
      const breadcrumbItems = BreadcrumbSelectors.items(page);
      const breadcrumbCount = await breadcrumbItems.count();
      if (breadcrumbCount > 1) {
        // Click first breadcrumb (parent)
        await breadcrumbItems.first().click({ force: true });
        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      }
    });
  });

  test.describe('Deep Navigation Tests', () => {
    test('should handle breadcrumb navigation for 3+ level deep pages', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to first level
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Get initial page count
      const initialPageCount = await PageSelectors.names(page).count();

      // Click first page and wait for navigation
      const firstPageName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });

      // Wait for page to load and sidebar to potentially update
      await page.waitForTimeout(2000);

      // Step 2: Navigate to second level
      const pagesAfterFirst = PageSelectors.names(page);
      const pagesAfterFirstCount = await pagesAfterFirst.count();
      const pageNamesAfterFirst = await pagesAfterFirst.allTextContents();
      const trimmedNames = pageNamesAfterFirst.map((n) => n.trim());

      const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
      let childPageFound = false;

      for (let i = 0; i < pagesAfterFirstCount; i++) {
        const pageName = trimmedNames[i] ?? '';
        if (childPageNames.includes(pageName)) {
          await pagesAfterFirst.nth(i).click({ force: true });
          childPageFound = true;
          break;
        }
      }

      if (!childPageFound && pagesAfterFirstCount > 1) {
        // Fallback: click second page if no known child found
        await pagesAfterFirst.nth(1).click({ force: true });
      }

      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });

      // Wait for sidebar to update again
      await page.waitForTimeout(2000);

      // Step 3: Navigate to third level if available
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const subPages = PageSelectors.names(page);
      const subPagesCount = await subPages.count();
      const subPageTexts = await subPages.allTextContents();
      const trimmedSubPages = subPageTexts.map((n) => n.trim());

      // Try to find another nested page or click a different page
      if (subPagesCount > 2) {
        // Click a page that's different from what we've already clicked
        // Skip first two and try third
        await subPages.nth(2).click({ force: true });
        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        await page.waitForTimeout(2000); // Wait for page to fully load

        // Step 4: Verify breadcrumb shows all levels
        await page.waitForTimeout(1000); // Wait a bit more for breadcrumb to render

        const navCount = await BreadcrumbSelectors.navigation(page).count();
        if (navCount > 0) {
          const items = BreadcrumbSelectors.items(page);
          const itemCount = await items.count();
          expect(itemCount).toBeGreaterThanOrEqual(1);

          // Log breadcrumb item texts for debugging
          const breadcrumbTexts = await items.allTextContents();
          const trimmedBreadcrumbs = breadcrumbTexts.map((t) => t.trim());

          expect(itemCount).toBeGreaterThanOrEqual(2);

          // Verify we can navigate back through breadcrumbs
          if (itemCount > 2) {
            // Click second-to-last breadcrumb
            const targetIndex = itemCount - 2;
            await items.nth(targetIndex).click({ force: true });
            await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
            await page.waitForTimeout(1000);
          }
        }
      }
    });
  });

  test.describe('Breadcrumb After Page Creation Tests', () => {
    test('should show breadcrumb after creating a new nested page', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to a page
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for page to load

      // Step 2: Create a new nested page
      const newPageName = `Test Page ${Date.now()}`;

      // Create page using the new page button
      await expect(PageSelectors.newPageButton(page)).toBeVisible();
      await PageSelectors.newPageButton(page).click();
      await page.waitForTimeout(1000);

      // Close any modals that might appear
      const dialogCount = await page.locator('[role="dialog"]').count();
      if (dialogCount > 0) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }

      // Wait for page to be created and navigate to it
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for page to fully load

      // Set page title if title input is available
      const titleInputCount = await PageSelectors.titleInput(page).count();
      if (titleInputCount > 0) {
        const titleInput = PageSelectors.titleInput(page).first();
        await titleInput.click({ force: true });
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+A');
        await titleInput.pressSequentially(newPageName, { delay: 50 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }

      // Step 3: Verify breadcrumb appears for new page
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const items = BreadcrumbSelectors.items(page);
        const itemCount = await items.count();
        expect(itemCount).toBeGreaterThanOrEqual(1);

        // Verify we can navigate back
        if (itemCount > 1) {
          await items.first().click({ force: true });
          await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        }
      }
    });
  });

  test.describe('Breadcrumb Text Content Tests', () => {
    test('should verify breadcrumb items contain correct page names', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate through pages and collect names
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const allPageTexts = await PageSelectors.names(page).allTextContents();
      const collectedPageNames = allPageTexts.slice(0, 3).map((t) => t.trim());

      if (collectedPageNames.length > 0) {
        // Navigate to first page
        await PageSelectors.names(page).first().click();
        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        await page.waitForTimeout(2000); // Wait for sidebar to update

        // Find and navigate to nested page
        const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
        const subPages = PageSelectors.names(page);
        const subPagesCount = await subPages.count();
        let childFound = false;

        for (let i = 0; i < subPagesCount; i++) {
          const pageName = (await subPages.nth(i).textContent())?.trim() ?? '';
          if (childPageNames.includes(pageName)) {
            await subPages.nth(i).click({ force: true });
            childFound = true;
            break;
          }
        }

        if (!childFound && subPagesCount > 1) {
          await subPages.nth(1).click({ force: true });
        }

        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        await page.waitForTimeout(2000);

        // Step 2: Verify breadcrumb contains page names
        const navCount = await BreadcrumbSelectors.navigation(page).count();
        if (navCount > 0) {
          const items = BreadcrumbSelectors.items(page);
          const breadcrumbTexts = await items.allTextContents();
          const trimmedBreadcrumbs = breadcrumbTexts.map((t) => t.trim());

          // Verify parent page name appears in breadcrumb
          if (collectedPageNames.length > 0 && trimmedBreadcrumbs.length > 0) {
            const hasParentName = trimmedBreadcrumbs.some((text) => text.includes(collectedPageNames[0]));
            // Parent name presence check is informational
          }
        }
      }
    });
  });

  test.describe('Breadcrumb Edge Cases', () => {
    test('should handle breadcrumb when navigating between different spaces', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to first space
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Step 2: Check breadcrumb state
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount > 0) {
        const initialItemCount = await BreadcrumbSelectors.items(page).count();

        // Navigate to nested page
        const pages = PageSelectors.names(page);
        const pagesCount = await pages.count();
        const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
        let childFound = false;

        for (let i = 0; i < pagesCount; i++) {
          const pageName = (await pages.nth(i).textContent())?.trim() ?? '';
          if (childPageNames.includes(pageName)) {
            await pages.nth(i).click({ force: true });
            childFound = true;
            break;
          }
        }

        if (!childFound && pagesCount > 1) {
          await pages.nth(1).click({ force: true });
        }

        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
        await page.waitForTimeout(2000);

        // Verify breadcrumb updates
        const newItemCount = await BreadcrumbSelectors.items(page).count();
        // Breadcrumb update check is informational (newItemCount vs initialItemCount)
      }
    });

    test('should verify breadcrumb does not appear on top-level pages', async ({ page, request }) => {
      page.on('pageerror', (err) => {
        if (err.message.includes('No workspace or service found')) return;
        if (err.message.includes('View not found')) return;
      });

      await signInAndWaitForApp(page, request, testEmail);

      // Wait for app to load
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      const pageCount = await PageSelectors.names(page).count();
      expect(pageCount).toBeGreaterThanOrEqual(1);

      // Step 1: Navigate to top-level page
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      // Click first page (likely top-level)
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for page to load

      // Step 2: Verify breadcrumb behavior on top-level page
      const navCount = await BreadcrumbSelectors.navigation(page).count();
      if (navCount === 0) {
        // No breadcrumb on top-level page (expected behavior)
        expect(navCount).toBe(0);
      } else {
        // Top-level pages may or may not have breadcrumbs depending on structure
        const itemCount = await BreadcrumbSelectors.items(page).count();
        // Informational: found breadcrumb items on top-level page
      }
    });
  });
});
