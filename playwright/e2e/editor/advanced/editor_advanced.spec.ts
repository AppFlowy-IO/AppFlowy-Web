import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Advanced Editor Features Tests
 * Migrated from: cypress/e2e/editor/advanced/editor_advanced.cy.ts
 */
test.describe('Advanced Editor Features', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes("Cannot set properties of undefined (setting 'class-name')")
      ) {
        return;
      }
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

    // Ensure any open menus are closed
    await page.keyboard.press('Escape');

    await EditorSelectors.slateEditor(page).click({ force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
  }

  test.describe('Slash Commands', () => {
    test('should insert Callout block', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/callout');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await expect(BlockSelectors.blockByType(page, 'callout')).toBeVisible();
      await page.keyboard.type('Callout Content');
      await expect(page.getByText('Callout Content')).toBeVisible();
    });

    test('should insert Code block', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/code');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await expect(BlockSelectors.blockByType(page, 'code')).toBeVisible();
      await page.keyboard.type('console.log("Hello");');
      await expect(page.getByText('console.log("Hello");')).toBeVisible();
    });

    test('should insert Divider', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/divider');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await expect(BlockSelectors.blockByType(page, 'divider')).toBeVisible();
    });

    test('should insert Toggle List', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/toggle');
      await page.waitForTimeout(1000);
      await page.getByText('Toggle list').click();
      await page.waitForTimeout(500);
      await expect(BlockSelectors.blockByType(page, 'toggle_list')).toBeVisible();
      await page.keyboard.type('Toggle Header');
      await expect(page.getByText('Toggle Header')).toBeVisible();
    });

    test('should insert Math Equation', async ({ page, request }) => {
      await setupEditor(page, request);

      await page.keyboard.type('/math');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await expect(BlockSelectors.blockByType(page, 'math_equation')).toBeVisible();
    });
  });

  test.describe('Slash Menu Interaction', () => {
    test('should trigger slash menu when typing / and display menu options', async ({ page, request }) => {
      await setupEditor(page, request);

      // Ensure focus and clean state
      await EditorSelectors.slateEditor(page).click({ position: { x: 5, y: 5 }, force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      // Type slash to open menu
      await page.keyboard.type('/', { delay: 100 });
      await page.waitForTimeout(1000);

      // Verify main menu items are visible
      await expect(page.getByTestId('slash-menu-askAIAnything')).toBeAttached();
      await expect(page.getByTestId('slash-menu-text')).toBeVisible();
      await expect(page.getByTestId('slash-menu-heading1')).toBeVisible();
      await expect(page.getByTestId('slash-menu-image')).toBeVisible();
      await expect(page.getByTestId('slash-menu-bulletedList')).toBeVisible();

      await page.keyboard.press('Escape');
    });

    test('should show media options in slash menu', async ({ page, request }) => {
      await setupEditor(page, request);

      await EditorSelectors.slateEditor(page).click({ position: { x: 5, y: 5 }, force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      await page.keyboard.type('/', { delay: 100 });
      await page.waitForTimeout(1000);

      await expect(page.getByTestId('slash-menu-image')).toBeVisible();
      await expect(page.getByTestId('slash-menu-video')).toBeVisible();

      await page.keyboard.press('Escape');
    });

    test('should allow selecting Image from slash menu', async ({ page, request }) => {
      await setupEditor(page, request);

      await EditorSelectors.slateEditor(page).click({ position: { x: 5, y: 5 }, force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      await page.keyboard.type('/', { delay: 100 });
      await page.waitForTimeout(1000);

      await page.getByTestId('slash-menu-image').click();
      await page.waitForTimeout(1000);

      // Verify image block inserted
      await expect(BlockSelectors.blockByType(page, 'image')).toBeVisible();
    });
  });
});
