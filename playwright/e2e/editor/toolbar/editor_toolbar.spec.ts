import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Toolbar Interaction Tests
 * Migrated from: cypress/e2e/editor/toolbar/editor_toolbar.cy.ts
 */
test.describe('Toolbar Interaction', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {
      // Suppress all uncaught exceptions
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: sign in, navigate to Getting started, clear editor.
   */
  async function setupEditor(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
    await page.waitForTimeout(2000);

    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
  }

  /**
   * Helper: select all text to trigger the selection toolbar.
   */
  async function showToolbar(page: import('@playwright/test').Page) {
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(500);
    await expect(EditorSelectors.selectionToolbar(page)).toBeVisible();
  }

  test('should open Link popover via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Link text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="link-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('.MuiPopover-root')).toBeVisible();
    await expect(page.locator('.MuiPopover-root input')).toBeAttached();
  });

  test('should open Text Color picker via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Colored text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="text-color-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();
    expect(divCount).toBeGreaterThan(0);
  });

  test('should open Background Color picker via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Highlighted text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="bg-color-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    const divCount = await page.locator('[data-slot="popover-content"] div').count();
    expect(divCount).toBeGreaterThan(0);
  });

  test('should allow converting block type via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Convert me');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page).locator('[data-testid="heading-button"]').click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('.MuiPopover-root')).toBeVisible();
    await expect(EditorSelectors.heading1Button(page)).toBeAttached();
  });

  test('should apply Bulleted List via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('List Item');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page)
      .locator('button[aria-label*="Bulleted list"], button[title*="Bulleted list"]')
      .click({ force: true });

    await page.waitForTimeout(200);
    await expect(EditorSelectors.slateEditor(page)).toContainText('List Item');
    await expect(BlockSelectors.blockByType(page, 'bulleted_list')).toBeVisible();
  });

  test('should apply Numbered List via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Numbered Item');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page)
      .locator('button[aria-label*="Numbered list"], button[title*="Numbered list"]')
      .click({ force: true });

    await page.waitForTimeout(200);
    await expect(BlockSelectors.blockByType(page, 'numbered_list')).toBeVisible();
  });

  test('should apply Quote via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Quote Text');
    await showToolbar(page);

    await EditorSelectors.selectionToolbar(page)
      .locator('button[aria-label*="Quote"], button[title*="Quote"]')
      .click({ force: true });

    await page.waitForTimeout(200);
    await expect(BlockSelectors.blockByType(page, 'quote')).toBeVisible();
  });

  test('should apply Inline Code via toolbar', async ({ page, request }) => {
    await setupEditor(page, request);

    await page.keyboard.type('Code Text');
    await showToolbar(page);

    // Use defined selector for code button
    await EditorSelectors.codeButton(page).click({ force: true });

    await page.waitForTimeout(200);
    await expect(page.locator('span.bg-border-primary')).toContainText('Code Text');
  });
});
