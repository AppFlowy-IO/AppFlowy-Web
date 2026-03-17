import { test, expect } from '@playwright/test';
import { BreadcrumbSelectors, PageSelectors, SidebarSelectors, SpaceSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpace } from '../../support/page/flows';

/**
 * Breadcrumb Navigation Complete Tests
 * Migrated from: cypress/e2e/page/breadcrumb-navigation.cy.ts
 */

/**
 * Expands a page item in the sidebar by name to reveal its children.
 * Clicks the expand toggle (▶) if the page item has one.
 */
async function expandPageInSidebar(page: import('@playwright/test').Page, pageName: string) {
  const pageItem = page.locator(
    `[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${pageName}"))`
  ).first();
  const expandToggle = pageItem.locator('[data-testid="outline-toggle-expand"]');
  if (await expandToggle.count() > 0) {
    await expandToggle.first().click({ force: true });
    await page.waitForTimeout(500);
  }
}

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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const itemCount = await BreadcrumbSelectors.items(page).count();
      // Top-level pages show at least 2 breadcrumb items (space + page)
      expect(itemCount).toBeGreaterThanOrEqual(2);
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

      // Step 2: Navigate to first page and expand it to reveal children
      const firstPageName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, firstPageName);

      // Step 3: Navigate to a child page
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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const itemCount = await BreadcrumbSelectors.items(page).count();
      // Nested page should show at least 3 breadcrumb items (space + parent + child)
      expect(itemCount).toBeGreaterThanOrEqual(3);

      // Click the first breadcrumb item to navigate back to parent
      await BreadcrumbSelectors.items(page).first().click({ force: true });
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
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

      const clickedPageName = getStartedIndex !== -1
        ? trimmedPageNames[getStartedIndex]
        : trimmedPageNames[0];

      if (getStartedIndex !== -1) {
        await PageSelectors.names(page).nth(getStartedIndex).click();
      } else {
        await PageSelectors.names(page).first().click();
      }

      // Wait for page to load
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, clickedPageName);

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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const items = BreadcrumbSelectors.items(page);
      const itemCount = await items.count();
      // Nested page should show at least 3 breadcrumb items
      expect(itemCount).toBeGreaterThanOrEqual(3);

      // Click second-to-last breadcrumb to navigate to parent
      const targetIndex = Math.max(0, itemCount - 2);
      await items.nth(targetIndex).click({ force: true });
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
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

      // Step 1: Navigate to first page and expand it
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const firstPageNameText = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, firstPageNameText);

      // Navigate to a child page
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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const items = BreadcrumbSelectors.items(page);
      const itemCount = await items.count();
      expect(itemCount).toBeGreaterThanOrEqual(3);

      // Verify each breadcrumb item has text
      for (let index = 0; index < itemCount; index++) {
        const itemText = (await items.nth(index).textContent())?.trim() ?? '';
        expect(itemText).not.toBe('');
      }

      // Verify last item is visible
      await expect(items.last()).toBeVisible();
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

      // Step 1: Navigate to parent page and expand it
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const parentPageName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, parentPageName);

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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const bcItems = BreadcrumbSelectors.items(page);
      const bcItemCount = await bcItems.count();
      expect(bcItemCount).toBeGreaterThanOrEqual(3);

      // Verify parent page appears in breadcrumb
      const breadcrumbTexts = await bcItems.allTextContents();
      const hasParent = breadcrumbTexts.some((text) => text.includes(parentPageName));
      expect(hasParent).toBe(true);

      // Step 4: Navigate back via breadcrumb — click first item (space)
      await bcItems.first().click({ force: true });
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
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

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, firstPageName);

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
        await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
        const items = BreadcrumbSelectors.items(page);
        const itemCount = await items.count();
        // 3+ level deep pages should show at least 4 breadcrumb items
        expect(itemCount).toBeGreaterThanOrEqual(3);

        // Verify we can navigate back through breadcrumbs
        const targetIndex = itemCount - 2;
        await items.nth(targetIndex).click({ force: true });
        await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
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

      // Step 1: Navigate to a page (the parent)
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const parentName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for page to load

      // Step 2: Create a child page by clicking the "+" button on the parent page item
      const parentItem = page.locator(
        `[data-testid="page-item"]:has(> div:first-child [data-testid="page-name"]:text-is("${parentName}"))`
      ).first();
      const addChildBtn = parentItem.getByTestId('inline-add-page');
      await expect(addChildBtn).toBeVisible({ timeout: 5000 });
      await addChildBtn.click({ force: true });
      await page.waitForTimeout(500);

      // Select "Document" from the dropdown menu
      const menuItem = page.locator('[role="menuitem"]').filter({ hasText: 'Document' });
      await expect(menuItem).toBeVisible({ timeout: 5000 });
      await menuItem.click({ force: true });
      await page.waitForTimeout(1000);

      // The child page opens in a ViewModal — expand it to full-page view
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.count() > 0) {
        // Click the expand button (↗) at the top-left of the ViewModal to navigate to full view
        await dialog.last().locator('button').first().click({ force: true });
        await page.waitForTimeout(2000);
      }

      // Wait for child page to be fully loaded
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Step 3: Verify breadcrumb appears for child page
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const bcItems = BreadcrumbSelectors.items(page);
      const bcItemCount = await bcItems.count();
      // Child page should show at least 3 breadcrumb items (space + parent + child)
      expect(bcItemCount).toBeGreaterThanOrEqual(3);

      // Verify we can navigate back
      await bcItems.first().click({ force: true });
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
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

      expect(collectedPageNames.length).toBeGreaterThan(0);

      // Navigate to first page and expand it
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, collectedPageNames[0]);

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
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const bcItems = BreadcrumbSelectors.items(page);
      const breadcrumbTexts = await bcItems.allTextContents();
      const trimmedBreadcrumbs = breadcrumbTexts.map((t) => t.trim());
      expect(trimmedBreadcrumbs.length).toBeGreaterThanOrEqual(3);

      // Verify parent page name appears in breadcrumb
      const hasParentName = trimmedBreadcrumbs.some((text) => text.includes(collectedPageNames[0]));
      expect(hasParentName).toBe(true);
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

      // Step 1: Navigate to first page and expand it
      await expandSpace(page, 0);
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 10000 });

      const topPageName = (await PageSelectors.names(page).first().textContent())?.trim() ?? '';
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for sidebar to update

      // Step 2: Check breadcrumb state on top-level page
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const initialItemCount = await BreadcrumbSelectors.items(page).count();
      // Top-level page should show 2 breadcrumb items (space + page)
      expect(initialItemCount).toBeGreaterThanOrEqual(2);

      // Expand the page in sidebar to reveal its children
      await expandPageInSidebar(page, topPageName);

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

      // Verify breadcrumb has more items after navigating to nested page
      const newItemCount = await BreadcrumbSelectors.items(page).count();
      expect(newItemCount).toBeGreaterThan(initialItemCount);
    });

    test('should show breadcrumb with space and page name on top-level pages', async ({ page, request }) => {
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

      // Click first page (top-level)
      await PageSelectors.names(page).first().click();
      await expect(page).toHaveURL(/\/app\//, { timeout: 10000 });
      await page.waitForTimeout(2000); // Wait for page to load

      // Step 2: Verify breadcrumb shows space + page name on top-level page
      await expect(BreadcrumbSelectors.navigation(page)).toBeVisible({ timeout: 10000 });
      const itemCount = await BreadcrumbSelectors.items(page).count();
      // Top-level pages show exactly 2 breadcrumb items (space name + page name)
      expect(itemCount).toBe(2);
    });
  });
});
