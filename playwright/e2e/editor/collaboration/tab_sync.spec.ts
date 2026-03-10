import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Editor Tab Synchronization Tests
 * Migrated from: cypress/e2e/editor/collaboration/tab_sync.cy.ts
 *
 * Note: The original Cypress test used an iframe to simulate a second tab.
 * In Playwright, we can use browser contexts or multiple pages to simulate
 * multi-tab collaboration. This migration uses an iframe approach similar
 * to the original test to maintain parity.
 */
test.describe('Editor Tab Synchronization', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should sync changes between two "tabs" (iframe)', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(2000);

    // Capture current URL
    const testPageUrl = page.url();

    // Clear editor for clean state
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Inject an iframe pointing to the same URL to simulate a second tab
    await page.evaluate((url) => {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.id = 'collab-iframe';
      iframe.style.width = '50%';
      iframe.style.height = '500px';
      iframe.style.position = 'fixed';
      iframe.style.bottom = '0';
      iframe.style.right = '0';
      iframe.style.border = '2px solid red';
      iframe.style.zIndex = '9999';
      document.body.appendChild(iframe);
    }, testPageUrl);

    // Wait for iframe to load and the editor inside it to be visible
    const iframeElement = page.locator('#collab-iframe');
    await expect(iframeElement).toBeVisible();

    const iframe = page.frameLocator('#collab-iframe');
    const iframeEditor = iframe.locator('[data-slate-editor="true"]');
    await expect(iframeEditor).toBeVisible({ timeout: 30000 });

    // 1. Type in Main Window
    await EditorSelectors.slateEditor(page).first().click({ position: { x: 5, y: 5 }, force: true });
    await page.keyboard.type('Hello from Main');
    await page.waitForTimeout(2000); // Wait longer for sync

    // 2. Verify in Iframe with longer timeout
    await expect(iframeEditor).toContainText('Hello from Main', { timeout: 15000 });

    // 3. Type in Iframe
    await iframeEditor.click({ force: true });
    await page.waitForTimeout(500);

    // We need to use the iframe's keyboard context
    // Since Playwright sends keyboard events to the focused frame,
    // clicking the iframe editor should set focus there
    await iframeEditor.type(' and Iframe');
    await page.waitForTimeout(2000);

    // 4. Verify in Main Window with longer timeout
    await expect(EditorSelectors.slateEditor(page)).toContainText('Hello from Main and Iframe', { timeout: 15000 });
  });
});
