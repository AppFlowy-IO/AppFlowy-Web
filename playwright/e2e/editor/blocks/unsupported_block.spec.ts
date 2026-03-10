import { test, expect } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';

/**
 * Unsupported Block Display Tests
 * Migrated from: cypress/e2e/editor/blocks/unsupported_block.cy.ts
 *
 * Note: These tests require __TEST_DOC__ which is only exposed in dev mode.
 * Tests will be skipped in CI where production builds are used.
 */
test.describe('Unsupported Block Display', () => {
  const testEmail = generateRandomEmail();

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        err.message.includes('Invalid hook call')
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

  /**
   * Helper: check if test utilities (__TEST_DOC__ and Y) are available on the window.
   */
  async function areTestUtilitiesAvailable(page: import('@playwright/test').Page): Promise<boolean> {
    return page.evaluate(() => {
      const win = window as any;
      return !!(win.__TEST_DOC__ && win.Y);
    });
  }

  /**
   * Helper: inject an unsupported block via Y.Doc transact.
   */
  async function injectUnsupportedBlock(page: import('@playwright/test').Page, blockType: string, blockIdSuffix: string) {
    await page.evaluate(({ blockType, blockIdSuffix }) => {
      const win = window as any;
      const doc = win.__TEST_DOC__;
      const Y = win.Y;

      const sharedRoot = doc.getMap('data');
      const document = sharedRoot.get('document');
      const blocks = document.get('blocks');
      const meta = document.get('meta');
      const pageId = document.get('page_id');
      const childrenMap = meta.get('children_map');
      const textMap = meta.get('text_map');

      const blockId = `test_${blockIdSuffix}_${Date.now()}`;

      doc.transact(() => {
        const block = new Y.Map();
        block.set('id', blockId);
        block.set('ty', blockType);
        block.set('children', blockId);
        block.set('external_id', blockId);
        block.set('external_type', 'text');
        block.set('parent', pageId);
        block.set('data', '{}');

        blocks.set(blockId, block);

        const pageChildren = childrenMap.get(pageId);
        if (pageChildren) {
          pageChildren.push([blockId]);
        }

        const blockText = new Y.Text();
        textMap.set(blockId, blockText);

        const blockChildren = new Y.Array();
        childrenMap.set(blockId, blockChildren);
      });
    }, { blockType, blockIdSuffix });
  }

  test.describe('Unsupported Block Rendering', () => {
    test('should display unsupported block message for unknown block types', async ({ page, request }) => {
      await setupEditor(page, request);
      await page.waitForTimeout(500);

      const available = await areTestUtilitiesAvailable(page);
      if (!available) {
        test.skip(true, 'Test utilities not available (expected in CI/production builds)');
        return;
      }

      await injectUnsupportedBlock(page, 'future_block_type_not_yet_implemented', 'unsupported');
      await page.waitForTimeout(1000);

      const unsupportedBlock = page.getByTestId('unsupported-block');
      await expect(unsupportedBlock).toBeVisible();
      await expect(unsupportedBlock).toContainText('not supported yet');
      await expect(unsupportedBlock).toContainText('future_block_type_not_yet_implemented');
    });

    test('should display warning icon and block type name', async ({ page, request }) => {
      await setupEditor(page, request);

      const available = await areTestUtilitiesAvailable(page);
      if (!available) {
        test.skip(true, 'Test utilities not available (expected in CI/production builds)');
        return;
      }

      const testBlockType = 'my_custom_unknown_block';
      await injectUnsupportedBlock(page, testBlockType, 'icon');
      await page.waitForTimeout(1000);

      const unsupportedBlock = page.getByTestId('unsupported-block');
      await expect(unsupportedBlock).toBeVisible();
      await expect(unsupportedBlock).toContainText(testBlockType);

      // Verify SVG icon exists
      await expect(unsupportedBlock.locator('svg')).toBeAttached();
    });

    test('should be non-editable', async ({ page, request }) => {
      await setupEditor(page, request);

      const available = await areTestUtilitiesAvailable(page);
      if (!available) {
        test.skip(true, 'Test utilities not available (expected in CI/production builds)');
        return;
      }

      await injectUnsupportedBlock(page, 'readonly_test_block', 'readonly');
      await page.waitForTimeout(1000);

      const unsupportedBlock = page.getByTestId('unsupported-block');
      await expect(unsupportedBlock).toHaveAttribute('contenteditable', 'false');
    });
  });
});
