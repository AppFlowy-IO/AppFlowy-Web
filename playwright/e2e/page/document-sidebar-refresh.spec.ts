import { test, expect } from '@playwright/test';

import { ViewLayout } from '../../../src/application/types';
import { waitForAtomicCreationCompletion } from '../../support/atomic-creation-helpers';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page/flows';
import { PageSelectors, ViewActionSelectors, ModalSelectors } from '../../support/selectors';
import { mockServerInfo } from '../../support/server-info-helpers';
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
    const uniqueId = Date.now();
    const renamedDocumentName = `Renamed-${uniqueId}`;
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

    // Keep the parent identity stable while its lazy children change.
    const firstPageItem = PageSelectors.items(page).first();
    const parentTestId = await firstPageItem
      .locator(':scope > [data-testid^="page-"]')
      .first()
      .getAttribute('data-testid');

    expect(parentTestId).toBeTruthy();
    const parentRow = page.getByTestId(parentTestId!);
    const expandBtn = parentRow.getByTestId('outline-toggle-expand');

    if ((await expandBtn.count()) > 0) {
      await expandBtn.first().click({ force: true });
      await page.waitForTimeout(500);
    }

    // Step 4: Hover over the first page and click the inline add button
    await parentRow.hover();
    await page.waitForTimeout(500);

    await parentRow.getByTestId('inline-add-page').click({ force: true });
    await page.waitForTimeout(500);

    // Step 5: Select "Document" from the dropdown menu
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const [creation] = await Promise.all([
      waitForAtomicCreationCompletion(page, '/v2/page-view/document/default'),
      ViewActionSelectors.popover(page).locator('[role="menuitem"]').first().click(),
    ]);
    const receipt = await creation.json();
    const createdPage = PageSelectors.pageByViewId(page, receipt.data.result.view_id);

    // Step 6: Verify this exact new child. The global count can stay unchanged
    // when unrelated lazy sidebar entries are replaced or collapsed.
    await expect(createdPage).toBeVisible({ timeout: 30000 });
    await expect(createdPage.getByTestId('page-name')).toHaveText('Untitled');

    console.log('[SUCCESS] New document appeared in sidebar via WebSocket notification!');

    // Step 7: Creation activates a preview after hydration, which can finish
    // after the sidebar update. Wait for that preview before closing it.
    const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

    await expect(viewModal.locator(`[id="editor-${receipt.data.result.view_id}"]`)).toBeVisible();
    await viewModal.getByTestId('view-modal-close').click();
    await expect(viewModal).toHaveCount(0);

    // Step 8: Expand the parent page to show the newly created child
    const parentExpandBtn = parentRow.getByTestId('outline-toggle-expand');

    if ((await parentExpandBtn.count()) > 0) {
      await parentExpandBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Find the newly created "Untitled" page
    await expect(createdPage.getByTestId('page-name')).toHaveText('Untitled', { timeout: 30000 });

    // Step 9: Open more actions on Untitled page and rename
    await createdPage.hover({ force: true });
    await page.waitForTimeout(500);
    await createdPage.getByTestId('page-more-actions').click({ force: true });
    await page.waitForTimeout(500);

    // Click rename
    await expect(ViewActionSelectors.renameButton(page)).toBeVisible();
    await ViewActionSelectors.renameButton(page).click();
    await page.waitForTimeout(500);

    // Enter new name
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await page.waitForTimeout(300);
    await ModalSelectors.renameInput(page).fill(renamedDocumentName);
    await page.waitForTimeout(500);

    // Save the rename
    await expect(ModalSelectors.renameSaveButton(page)).toBeVisible();
    await ModalSelectors.renameSaveButton(page).click();
    await page.waitForTimeout(2000);

    // Step 10: Verify renamed document appears in sidebar via WebSocket
    await expect(createdPage.getByTestId('page-name')).toHaveText(renamedDocumentName, { timeout: 30000 });
    console.log(`[SUCCESS] Renamed document "${renamedDocumentName}" appeared in sidebar via WebSocket!`);

    // Step 11: Clean up - delete the test document
    await createdPage.hover();
    await page.waitForTimeout(500);
    await createdPage.getByTestId('page-more-actions').click({ force: true });
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

    // Step 12: Verify document is removed from sidebar
    await expect(createdPage).toHaveCount(0, { timeout: 10000 });

    console.log('[TEST COMPLETE] Sidebar refresh via WebSocket notification verified successfully!');
  });

  test('should verify sidebar updates via WebSocket when creating AI chat', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // This scenario exercises AI-enabled navigation; disabled AI intentionally
    // hides existing chat pages from the outline.
    await mockServerInfo(page, { ai_enabled: true });

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

    const firstPage = PageSelectors.items(page).first();
    const parentTestId = await firstPage.locator(':scope > [data-testid^="page-"]').first().getAttribute('data-testid');

    expect(parentTestId).toBeTruthy();
    const parentRow = page.getByTestId(parentTestId!);
    const expand = parentRow.getByTestId('outline-toggle-expand');

    if (await expand.count()) await expand.click();
    await parentRow.hover();
    await parentRow.getByTestId('inline-add-page').click();
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    const [response] = await Promise.all([
      page.waitForResponse(
        (result) =>
          result.request().method() === 'POST' &&
          new URL(result.url()).pathname.endsWith('/page-view') &&
          result.request().postDataJSON()?.layout === ViewLayout.AIChat
      ),
      page.getByTestId('add-ai-chat-button').click(),
    ]);
    const body = await response.json();

    expect(response.ok()).toBe(true);
    expect(body.code, body.message).toBe(0);
    expect(body.data.view_id).toBeTruthy();
    const createdPage = PageSelectors.pageByViewId(page, body.data.view_id);

    await expect(createdPage).toBeVisible({ timeout: 30000 });
    await expect(createdPage.getByTestId('page-name')).toHaveText('Untitled');
    await createdPage.hover({ force: true });
    await createdPage.getByTestId('page-more-actions').click({ force: true });
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

    await expect(createdPage).toHaveCount(0, { timeout: 10000 });
    console.log('[TEST COMPLETE] AI chat sidebar refresh via WebSocket notification verified successfully!');
  });
});
