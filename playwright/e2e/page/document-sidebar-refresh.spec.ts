import { test, expect } from '@playwright/test';
import { PageSelectors, ViewActionSelectors, ModalSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page/flows';
import { closeModalsIfOpen } from '../../support/test-helpers';

/**
 * Document Sidebar Refresh via WebSocket Tests
 * Migrated from: cypress/e2e/page/document-sidebar-refresh.cy.ts
 *
 * These tests verify that the sidebar updates correctly via WebSocket notifications
 * when creating and renaming documents or creating AI chat pages.
 */

const SPACE_NAME = 'General';

test.describe('Document Sidebar Refresh via WebSocket', () => {
  test('should verify sidebar updates via WebSocket when creating and renaming documents', async ({
    page,
    request,
  }) => {
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

    // Expand the first page before baseline count so later checks
    // are not affected by local expansion revealing pre-existing children.
    const firstPageItem = PageSelectors.items(page).first();
    const expandBtn = firstPageItem.getByTestId('outline-toggle-expand');
    if ((await expandBtn.count()) > 0) {
      await expandBtn.first().click({ force: true });
      await page.waitForTimeout(500);
    }

    // Count existing pages (baseline)
    const initialPageCount = await PageSelectors.names(page).count();
    console.log(`[INFO] Initial page count: ${initialPageCount}`);

    // Step 4: Hover over the first page and click the inline add button
    await PageSelectors.items(page).first().hover();
    await page.waitForTimeout(500);

    await PageSelectors.items(page).first().getByTestId('inline-add-page').first().click({ force: true });
    await page.waitForTimeout(500);

    // Step 5: Select "Document" from the dropdown menu
    await expect(ViewActionSelectors.popover(page)).toBeVisible();
    await ViewActionSelectors.popover(page).locator('[role="menuitem"]').first().click();
    await page.waitForTimeout(3000);

    // Step 6: Verify sidebar page count increased (WebSocket notification worked!)
    await expandSpaceByName(page, SPACE_NAME);
    await page.waitForTimeout(1000);

    // Poll until page count increases (with collapse/re-expand to trigger lazy load)
    for (let attempt = 0; attempt < 30; attempt++) {
      // Try to expand parent page if needed
      const firstItem = PageSelectors.items(page).first();
      const expandToggle = firstItem.getByTestId('outline-toggle-expand');
      const collapseToggle = firstItem.getByTestId('outline-toggle-collapse');

      if ((await expandToggle.count()) > 0) {
        await expandToggle.first().click({ force: true });
        await page.waitForTimeout(500);
      } else if ((await collapseToggle.count()) > 0 && attempt > 0) {
        // Collapse and re-expand to trigger fresh lazy load
        await collapseToggle.first().click({ force: true });
        await page.waitForTimeout(300);
        const reExpand = firstItem.getByTestId('outline-toggle-expand');
        if ((await reExpand.count()) > 0) {
          await reExpand.first().click({ force: true });
          await page.waitForTimeout(500);
        }
      }

      const currentCount = await PageSelectors.names(page).count();
      console.log(`[INFO] Current page count: ${currentCount}, initial: ${initialPageCount}, attempt: ${attempt + 1}`);
      if (currentCount > initialPageCount) break;
      await page.waitForTimeout(1000);
      if (attempt === 29) throw new Error('Page count did not increase - WebSocket notification may not be working');
    }

    console.log('[SUCCESS] New document appeared in sidebar via WebSocket notification!');

    // Step 7: Close any dialog that may have opened
    const backToHomeBtn = page.getByRole('button', { name: 'Back to home' });
    if ((await backToHomeBtn.count()) > 0) {
      await backToHomeBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    } else {
      const closeModalBtn = page.getByTestId('close-modal-button');
      if ((await closeModalBtn.count()) > 0) {
        await closeModalBtn.first().click({ force: true });
        await page.waitForTimeout(1000);
      } else if ((await page.locator('.MuiDialog-root').count()) > 0) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
      }
    }

    // Wait for dialog to be completely gone
    await page.waitForTimeout(2000);

    // Retry closing if dialog is still there
    if ((await page.getByRole('button', { name: 'Back to home' }).count()) > 0) {
      await page.getByRole('button', { name: 'Back to home' }).first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Wait for MuiDialog to disappear
    await expect(page.locator('.MuiDialog-root')).toHaveCount(0, { timeout: 30000 });

    // Step 8: Expand the parent page to show the newly created child
    const parentItem = PageSelectors.items(page).first();
    const parentExpandBtn = parentItem.getByTestId('outline-toggle-expand');
    if ((await parentExpandBtn.count()) > 0) {
      await parentExpandBtn.first().click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Find the newly created "Untitled" page
    await expect(PageSelectors.nameContaining(page, 'Untitled').first()).toBeVisible({ timeout: 30000 });

    // Step 9: Open more actions on Untitled page and rename
    const untitledItem = PageSelectors.itemByName(page, 'Untitled');
    await untitledItem.hover({ force: true });
    await page.waitForTimeout(500);
    await PageSelectors.moreActionsButton(page, 'Untitled').click({ force: true });
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
    await expect(PageSelectors.nameContaining(page, renamedDocumentName).first()).toBeVisible({ timeout: 30000 });
    console.log(`[SUCCESS] Renamed document "${renamedDocumentName}" appeared in sidebar via WebSocket!`);

    // Step 11: Clean up - delete the test document
    const renamedItem = PageSelectors.itemByName(page, renamedDocumentName);
    await renamedItem.hover();
    await page.waitForTimeout(500);
    await PageSelectors.moreActionsButton(page, renamedDocumentName).click({ force: true });
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
    await expect(PageSelectors.nameContaining(page, renamedDocumentName)).toHaveCount(0, { timeout: 10000 });

    console.log('[TEST COMPLETE] Sidebar refresh via WebSocket notification verified successfully!');
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
