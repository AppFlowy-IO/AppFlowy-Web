import { test, expect } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page/flows';
import { PageSelectors, ViewActionSelectors, ModalSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Document Sidebar Refresh via WebSocket Tests
 * Migrated from: cypress/e2e/page/document-sidebar-refresh.cy.ts
 *
 * These tests verify that the sidebar updates correctly via WebSocket notifications
 * when creating and renaming documents or creating AI chat pages.
 */

const SPACE_NAME = 'General';

test.describe('Document Sidebar Refresh via WebSocket', () => {
  test('should verify sidebar updates via WebSocket when creating and renaming documents', async ({ page, request }) => {
    const renamedDocumentName = `Renamed-${Date.now()}`;

    await signInAndWaitForApp(page, request, generateRandomEmail());
    await expandSpaceByName(page, SPACE_NAME);
    const parentItem = PageSelectors.itemByName(page, 'Getting started');
    const expand = parentItem.getByTestId('outline-toggle-expand').first();

    await expect(parentItem).toBeVisible();
    if (await expand.isVisible()) await expand.click();
    await parentItem.hover();
    await parentItem.getByTestId('inline-add-page').first().click();
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/v2/page-view/document/default'));

    await page.getByTestId('add-document-button').click();
    const response = await created;
    const receipt = await response.json();

    expect(response.ok()).toBe(true);
    expect(receipt.code).toBe(0);
    const documentId = receipt.data.result.view_id as string;

    expect(documentId).toBe(response.request().postDataJSON().view_id);
    const modal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

    await expect(modal.locator(`[id="editor-${documentId}"]`)).toBeVisible();
    await modal.getByTestId('view-modal-close').click();
    await expect(modal).toHaveCount(0);

    // Opening a child can collapse a different branch (for example To-dos /
    // Board). The total row count can stay unchanged even when creation works.
    // Follow the server-confirmed document, without reloading the sidebar or
    // repeatedly collapsing/re-expanding it to force a fresh fetch.
    const sidebarPage = PageSelectors.pageByViewId(page, documentId);

    await expect(parentItem.getByTestId(`page-${documentId}`)).toBeVisible({ timeout: 30000 });
    await expect(sidebarPage.getByTestId('page-name')).toHaveText('Untitled');
    await sidebarPage.hover();
    await sidebarPage.getByTestId('page-more-actions').click();
    await ViewActionSelectors.renameButton(page).click();
    await ModalSelectors.renameInput(page).fill(renamedDocumentName);
    const renamed = page.waitForResponse((result) => result.request().method() === 'POST' &&
      new URL(result.url()).pathname.endsWith(`/page-view/${documentId}/update-name`));

    await ModalSelectors.renameSaveButton(page).click();
    expect((await (await renamed).json()).code).toBe(0);
    await expect(sidebarPage.getByTestId('page-name')).toHaveText(renamedDocumentName);

    await sidebarPage.hover();
    await sidebarPage.getByTestId('page-more-actions').click();
    const deleted = page.waitForResponse((result) => result.request().method() === 'POST' &&
      new URL(result.url()).pathname.endsWith(`/page-view/${documentId}/move-to-trash`));

    await ViewActionSelectors.deleteButton(page).click();
    expect((await (await deleted).json()).code).toBe(0);
    await expect(sidebarPage).toHaveCount(0);
  });

  test('should verify sidebar updates via WebSocket when creating AI chat', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Suppress known non-critical errors
    page.on('pageerror', (err) => {
      if (
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection') ||
        err.message.includes('cancelled') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('_dEH')
      ) {
        return;
      }
    });

    // Step 1: Sign in with test user
    await signInAndWaitForApp(page, request, testEmail);

    // Step 2: Wait for app to fully load
    await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    // Step 3: Expand the General space
    await expandSpaceByName(page, SPACE_NAME);
    await page.waitForTimeout(1000);

    // Count existing pages (baseline)
    const initialPageCount = await PageSelectors.names(page).count();

    console.log(`[INFO] Initial page count: ${initialPageCount}`);

    // Step 4: Hover over the first page and click the inline add button
    await PageSelectors.items(page).first().hover();
    await page.waitForTimeout(500);

    await PageSelectors.items(page).first().getByTestId('inline-add-page').first().click({ force: true });
    await page.waitForTimeout(500);

    // Step 5: Select "AI Chat" from the dropdown menu
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    await page.getByTestId('add-ai-chat-button').click();
    await page.waitForTimeout(3000);

    // Step 6: Verify sidebar page count increased (WebSocket notification worked!)
    await expandSpaceByName(page, SPACE_NAME);
    await page.waitForTimeout(1000);

    // Poll until page count increases
    for (let attempt = 0; attempt < 30; attempt++) {
      // Try to expand parent page if needed
      const firstItem = PageSelectors.items(page).first();
      const expandToggle = firstItem.getByTestId('outline-toggle-expand');

      if ((await expandToggle.count()) > 0) {
        await expandToggle.first().click({ force: true });
        await page.waitForTimeout(500);
      }

      const currentCount = await PageSelectors.names(page).count();

      console.log(`[INFO] Current page count: ${currentCount}, initial: ${initialPageCount}, attempt: ${attempt + 1}`);
      if (currentCount > initialPageCount) break;
      await page.waitForTimeout(1000);
      if (attempt === 29) throw new Error('Page count did not increase - WebSocket notification may not be working for AI chat');
    }

    console.log('[SUCCESS] New AI chat appeared in sidebar via WebSocket notification!');

    // Step 7: Expand the parent page to show the newly created AI chat
    const parentItem = PageSelectors.items(page).first();
    const parentExpandBtn = parentItem.getByTestId('outline-toggle-expand');

    if ((await parentExpandBtn.count()) > 0) {
      await parentExpandBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Step 8: Clean up - delete the AI chat
    await expect(PageSelectors.nameContaining(page, 'Untitled').first()).toBeVisible({ timeout: 30000 });
    const untitledItem = PageSelectors.itemByName(page, 'Untitled');

    await untitledItem.hover({ force: true });
    await page.waitForTimeout(500);
    await PageSelectors.moreActionsButton(page, 'Untitled').click({ force: true });
    await page.waitForTimeout(500);

    await expect(ViewActionSelectors.deleteButton(page)).toBeVisible();
    await ViewActionSelectors.deleteButton(page).click();
    await page.waitForTimeout(500);

    // Confirm deletion if dialog appears
    const confirmDeleteBtn = ModalSelectors.confirmDeleteButton(page);

    if ((await confirmDeleteBtn.count()) > 0) {
      await confirmDeleteBtn.click({ force: true });
    } else {
      const deleteBtn = page.getByRole('button', { name: 'Delete' });

      if ((await deleteBtn.count()) > 0) {
        await deleteBtn.first().click({ force: true });
      }
    }

    await page.waitForTimeout(2000);

    console.log('[TEST COMPLETE] AI chat sidebar refresh via WebSocket notification verified successfully!');
  });
});
