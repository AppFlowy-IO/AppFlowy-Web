import { test, expect } from '@playwright/test';
import {
  BreadcrumbSelectors,
  PageSelectors,
  SpaceSelectors,
  SidebarSelectors,
  TrashSelectors,
  byTestId,
} from '../../support/selectors';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { logTestEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import { expandSpaceByName, expandPageByName } from '../../support/page/flows';

/**
 * Folder API & Trash Permission Tests (Snapshot Accounts)
 * Migrated from: cypress/e2e/folder/folder-permission.cy.ts
 */

// Snapshot accounts from backup/README.md
const OWNER_EMAIL = 'cc_group_owner@appflowy.io';
const MEMBER_1_EMAIL = 'cc_group_mem_1@appflowy.io';
const MEMBER_2_EMAIL = 'cc_group_mem_2@appflowy.io';
const GUEST_EMAIL = 'cc_group_guest@appflowy.io';

/**
 * Asserts that a space with the given name exists in the sidebar.
 */
async function assertSpaceVisible(page: import('@playwright/test').Page, spaceName: string) {
  const allNames = await SpaceSelectors.names(page).allTextContents();
  const found = allNames.some((n) => n.includes(spaceName));
  expect(found).toBe(true);
}

/**
 * Asserts that a space with the given name does NOT exist in the sidebar.
 */
async function assertSpaceNotVisible(page: import('@playwright/test').Page, spaceName: string) {
  const allNames = await SpaceSelectors.names(page).allTextContents();
  const found = allNames.some((n) => n.includes(spaceName));
  expect(found).toBe(false);
}

/**
 * Asserts the exact set of direct children (page names) under a given space.
 * Checks both inclusion and exact count of direct children.
 */
async function assertSpaceHasExactChildren(
  page: import('@playwright/test').Page,
  spaceName: string,
  expectedChildren: string[]
) {
  const spaceItem = SpaceSelectors.itemByName(page, spaceName);
  // Space DOM: space-item > [space-expanded, renderItem div, renderChildren div]
  // renderChildren div contains direct page-item children
  const childrenContainer = spaceItem.locator('> div').last();
  // Use :scope > to match only direct children (parity with Cypress .children())
  const pageItems = childrenContainer.locator(`:scope > ${byTestId('page-item')}`);
  await expect(pageItems).toHaveCount(expectedChildren.length);

  const count = await pageItems.count();
  for (let i = 0; i < count; i++) {
    // Use .first() to get only this page-item's own page-name, not nested children's
    const nameText = await pageItems.nth(i).locator(byTestId('page-name')).first().textContent();
    const trimmed = (nameText ?? '').trim();
    expect(expectedChildren).toContain(trimmed);
  }
}

/**
 * Asserts the exact set of direct children under a given page (after expanding).
 */
async function assertPageHasExactChildren(
  page: import('@playwright/test').Page,
  pageName: string,
  expectedChildren: string[]
) {
  const pageItem = PageSelectors.itemByName(page, pageName);
  const childrenContainer = pageItem.locator('> div').last();
  // Use :scope > to match only direct children (parity with Cypress .children())
  const childPageItems = childrenContainer.locator(`:scope > ${byTestId('page-item')}`);
  await expect(childPageItems).toHaveCount(expectedChildren.length);

  const count = await childPageItems.count();
  for (let i = 0; i < count; i++) {
    // Use .first() to get only this page-item's own page-name, not nested children's
    const nameText = await childPageItems.nth(i).locator(byTestId('page-name')).first().textContent();
    const trimmed = (nameText ?? '').trim();
    expect(expectedChildren).toContain(trimmed);
  }
}

/**
 * Gets the set of trash item names visible in the trash view.
 */
async function getTrashNames(page: import('@playwright/test').Page): Promise<string[]> {
  const rows = page.locator(byTestId('trash-table-row'));
  const count = await rows.count();

  if (count === 0) {
    return [];
  }

  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const firstCell = rows.nth(i).locator('td').first();
    const text = await firstCell.textContent();
    names.push((text ?? '').trim());
  }
  return names;
}

// =============================================================================
// Tests
// =============================================================================

test.describe('Folder API & Trash Permission Tests (Snapshot Accounts)', () => {
  // ---------------------------------------------------------------------------
  // Owner folder structure tests
  // ---------------------------------------------------------------------------
  test.describe('Owner folder visibility', () => {
    test.beforeEach(async ({ page, request }) => {
      await signInAndWaitForApp(page, request, OWNER_EMAIL);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    test('should see exact spaces, General children, and Getting started children', async ({
      page,
    }) => {
      // Given: owner is signed in and sidebar is visible

      // Then: owner sees exactly 5 spaces
      testLog.step(1, 'Verify owner sees exactly 5 spaces');
      await assertSpaceVisible(page, 'General');
      await assertSpaceVisible(page, 'Shared');
      await assertSpaceVisible(page, 'Owner-shared-space');
      await assertSpaceVisible(page, 'member-1-public-space');
      await assertSpaceVisible(page, 'Owner-private-space');
      await expect(SpaceSelectors.items(page)).toHaveCount(5);

      // When: expanding the General space
      testLog.step(2, 'Expand General and verify children');
      await expandSpaceByName(page, 'General');
      await page.waitForTimeout(1000);
      // Then: General has exactly 3 children
      await assertSpaceHasExactChildren(page, 'General', [
        'Document 1',
        'Getting started',
        'To-dos',
      ]);

      // When: expanding Getting started page
      testLog.step(3, 'Expand Getting started and verify children');
      await expandPageByName(page, 'Getting started');
      // Then: Getting started has exactly 3 guide children
      await assertPageHasExactChildren(page, 'Getting started', [
        'Desktop guide',
        'Mobile guide',
        'Web guide',
      ]);
    });

    test('should see deep nesting under Document 1 and correct breadcrumbs', async ({
      page,
    }) => {
      // Given: owner is signed in and sidebar is visible

      // When: expanding General and Document 1
      testLog.step(1, 'Expand General -> Document 1');
      await expandSpaceByName(page, 'General');
      await page.waitForTimeout(1000);
      await expandPageByName(page, 'Document 1');

      // Then: Document 1 has exactly 2 children
      testLog.step(2, 'Verify exact Document 1 children');
      await assertPageHasExactChildren(page, 'Document 1', ['Document 1-1', 'Database 1-2']);

      // When: expanding Document 1-1
      testLog.step(3, 'Expand Document 1-1 and verify children');
      await expandPageByName(page, 'Document 1-1');
      // Then: Document 1-1 has exactly 2 children
      await assertPageHasExactChildren(page, 'Document 1-1', [
        'Document 1-1-1',
        'Document 1-1-2',
      ]);

      // When: expanding Document 1-1-1
      testLog.step(4, 'Expand Document 1-1-1 and verify children');
      await expandPageByName(page, 'Document 1-1-1');
      // Then: Document 1-1-1 has exactly 2 children
      await assertPageHasExactChildren(page, 'Document 1-1-1', [
        'Document 1-1-1-1',
        'Document 1-1-1-2',
      ]);

      // When: navigating to the deeply nested Document 1-1-1-1
      testLog.step(5, 'Click Document 1-1-1-1 and verify breadcrumbs');
      await PageSelectors.nameContaining(page, 'Document 1-1-1-1').first().click();
      await page.waitForTimeout(2000);

      // Then: breadcrumb shows collapsed path with first, last 2 items and ellipsis
      // Full path: General > Document 1 > Document 1-1 > Document 1-1-1 > Document 1-1-1-1
      // Visible:   General > ... > Document 1-1-1 > Document 1-1-1-1
      const breadcrumbNav = BreadcrumbSelectors.navigation(page);
      await expect(breadcrumbNav).toBeVisible();
      await expect(breadcrumbNav.locator(byTestId('breadcrumb-item-general'))).toBeVisible();
      await expect(
        breadcrumbNav.locator(byTestId('breadcrumb-item-document-1-1-1'))
      ).toBeVisible();
      await expect(
        breadcrumbNav.locator(byTestId('breadcrumb-item-document-1-1-1-1'))
      ).toBeVisible();
      // And: intermediate breadcrumb items are hidden
      await expect(
        breadcrumbNav.locator(byTestId('breadcrumb-item-document-1'))
      ).not.toBeVisible();
      await expect(
        breadcrumbNav.locator(byTestId('breadcrumb-item-document-1-1'))
      ).not.toBeVisible();
    });

    test('should see exact Owner-shared-space hierarchy', async ({ page }) => {
      // Given: owner is signed in and sidebar is visible

      // When: expanding Owner-shared-space
      testLog.step(1, 'Expand Owner-shared-space');
      await expandSpaceByName(page, 'Owner-shared-space');
      await page.waitForTimeout(1000);

      // Then: space has exactly 2 children
      testLog.step(2, 'Verify exact space children');
      await assertSpaceHasExactChildren(page, 'Owner-shared-space', [
        'Shared grid',
        'Shared document 2',
      ]);

      // When: expanding Shared document 2
      testLog.step(3, 'Expand Shared document 2 and verify children');
      await expandPageByName(page, 'Shared document 2');
      // Then: Shared document 2 has exactly 2 children
      await assertPageHasExactChildren(page, 'Shared document 2', [
        'Shared document 2-1',
        'Shared document 2-2',
      ]);
    });

    test('should see exact Owner-private-space hierarchy', async ({ page }) => {
      // Given: owner is signed in and sidebar is visible

      // When: expanding Owner-private-space
      testLog.step(1, 'Expand Owner-private-space');
      await expandSpaceByName(page, 'Owner-private-space');
      await page.waitForTimeout(1000);

      // Then: space has exactly 2 children
      testLog.step(2, 'Verify exact space children');
      await assertSpaceHasExactChildren(page, 'Owner-private-space', [
        'Private database 1',
        'Prviate document 1',
      ]);

      // When: expanding Prviate document 1
      testLog.step(3, 'Expand Prviate document 1 and verify children');
      await expandPageByName(page, 'Prviate document 1');
      // Then: Prviate document 1 has exactly 2 children
      await assertPageHasExactChildren(page, 'Prviate document 1', [
        'Private document 1-1',
        'Private gallery 1-2',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Member 1 folder visibility + trash
  // ---------------------------------------------------------------------------
  test.describe('Member 1 visibility', () => {
    test.beforeEach(async ({ page, request }) => {
      await signInAndWaitForApp(page, request, MEMBER_1_EMAIL);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    test('should see expected spaces with own children, but NOT Owner-private-space', async ({
      page,
    }) => {
      // Given: member 1 is signed in and sidebar is visible

      // Then: member 1 sees exactly 5 spaces, excluding Owner-private-space
      testLog.step(1, 'Verify member1 sees exactly 5 spaces');
      await assertSpaceVisible(page, 'General');
      await assertSpaceVisible(page, 'Shared');
      await assertSpaceVisible(page, 'Owner-shared-space');
      await assertSpaceVisible(page, 'member-1-public-space');
      await assertSpaceVisible(page, 'Member-1-private-space');
      await assertSpaceNotVisible(page, 'Owner-private-space');
      await expect(SpaceSelectors.items(page)).toHaveCount(5);

      // When: expanding member-1-public-space
      testLog.step(2, 'Expand member-1-public-space and verify children');
      await expandSpaceByName(page, 'member-1-public-space');
      await page.waitForTimeout(1000);
      // Then: space has exactly 1 child
      await assertSpaceHasExactChildren(page, 'member-1-public-space', [
        'mem-1-public-document1',
      ]);

      // When: expanding Member-1-private-space
      testLog.step(3, 'Expand Member-1-private-space and verify children');
      await expandSpaceByName(page, 'Member-1-private-space');
      await page.waitForTimeout(1000);
      // Then: space has exactly 2 children
      await assertSpaceHasExactChildren(page, 'Member-1-private-space', [
        'Mem-private document 2',
        'Mem-private document 1',
      ]);
    });

    test('should see shared and own trash but NOT owner private trash', async ({ page }) => {
      // Given: member 1 is signed in and sidebar is visible

      // When: navigating to trash
      testLog.step(1, 'Navigate to trash');
      await TrashSelectors.sidebarTrashButton(page).click();
      await page.waitForTimeout(2000);

      // Then: trash contains shared and own items but not owner's private items
      testLog.step(2, 'Verify trash contents');
      await expect(TrashSelectors.table(page)).toBeVisible();

      const names = await getTrashNames(page);
      testLog.info(`Member1 trash: ${names.join(', ')}`);
      expect(names).toContain('Shared document 1');
      expect(names).toContain('mem-1-public-document2');
      expect(names).toContain('Mem-private document 3');
      expect(names).not.toContain('Private document 2');
      expect(names).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Member 2 visibility + trash
  // ---------------------------------------------------------------------------
  test.describe('Member 2 visibility', () => {
    test.beforeEach(async ({ page, request }) => {
      await signInAndWaitForApp(page, request, MEMBER_2_EMAIL);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    test('should see exactly the expected spaces, NOT private ones', async ({ page }) => {
      // Given: member 2 is signed in and sidebar is visible

      // Then: member 2 sees exactly 4 spaces, excluding all private spaces
      testLog.step(1, 'Verify visible spaces');
      await assertSpaceVisible(page, 'General');
      await assertSpaceVisible(page, 'Shared');
      await assertSpaceVisible(page, 'Owner-shared-space');
      await assertSpaceVisible(page, 'member-1-public-space');
      await assertSpaceNotVisible(page, 'Owner-private-space');
      await assertSpaceNotVisible(page, 'Member-1-private-space');
      await expect(SpaceSelectors.items(page)).toHaveCount(4);
    });

    test('should see only shared trash items', async ({ page }) => {
      // Given: member 2 is signed in and sidebar is visible

      // When: navigating to trash
      testLog.step(1, 'Navigate to trash');
      await TrashSelectors.sidebarTrashButton(page).click();
      await page.waitForTimeout(2000);

      // Then: trash contains only shared items, not any private items
      testLog.step(2, 'Verify trash contents');
      await expect(TrashSelectors.table(page)).toBeVisible();

      const names = await getTrashNames(page);
      testLog.info(`Member2 trash: ${names.join(', ')}`);
      expect(names).toContain('Shared document 1');
      expect(names).toContain('mem-1-public-document2');
      expect(names).not.toContain('Private document 2');
      expect(names).not.toContain('Mem-private document 3');
      expect(names).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Owner trash visibility
  // ---------------------------------------------------------------------------
  test.describe('Owner trash visibility', () => {
    test.beforeEach(async ({ page, request }) => {
      await signInAndWaitForApp(page, request, OWNER_EMAIL);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    test('should see exactly the expected items in trash', async ({ page }) => {
      // Given: owner is signed in and sidebar is visible

      // When: navigating to trash
      testLog.step(1, 'Navigate to trash');
      await TrashSelectors.sidebarTrashButton(page).click();
      await page.waitForTimeout(2000);

      // Then: trash contains shared and own private items but not member's private items
      testLog.step(2, 'Verify trash contents');
      await expect(TrashSelectors.table(page)).toBeVisible();

      const names = await getTrashNames(page);
      testLog.info(`Owner trash: ${names.join(', ')}`);
      expect(names).toContain('Shared document 1');
      expect(names).toContain('Private document 2');
      expect(names).toContain('mem-1-public-document2');
      expect(names).not.toContain('Mem-private document 3');
      expect(names).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Guest visibility
  // ---------------------------------------------------------------------------
  test.describe('Guest visibility', () => {
    test.beforeEach(async ({ page, request }) => {
      await signInAndWaitForApp(page, request, GUEST_EMAIL);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
    });

    test('should not see trash button in sidebar', async ({ page }) => {
      // Given: guest is signed in and sidebar is visible

      // Then: trash button is not visible for guest role
      testLog.step(1, 'Verify trash button is NOT visible for guest');
      const trashButtonCount = await page.locator(byTestId('sidebar-trash-button')).count();
      expect(trashButtonCount).toBe(0);
    });
  });
});
