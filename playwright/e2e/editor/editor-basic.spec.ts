import { test, expect } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';

/**
 * Editor - Drag and Drop Blocks Tests
 * Migrated from: cypress/e2e/editor/drag_drop_blocks.cy.ts
 *
 * Note: The editor uses @atlaskit/pragmatic-drag-and-drop which maintains internal state
 * that is updated via native HTML5 drag events. Playwright drag events work for
 * special blocks (callout) but not for regular text blocks.
 */
test.describe('Editor - Drag and Drop Blocks', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        err.message.includes('Cannot resolve a Slate point from DOM point') ||
        err.message.includes('Cannot resolve a Slate node from DOM node') ||
        err.message.includes("Cannot read properties of undefined (reading '_dEH')") ||
        err.message.includes('unobserveDeep')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Drag a block from source to target position.
   */
  async function dragBlock(
    page: import('@playwright/test').Page,
    sourceText: string,
    targetText: string,
    edge: 'top' | 'bottom'
  ) {
    const slateEditor = EditorSelectors.slateEditor(page);

    // Get the source block element
    const sourceBlock = sourceText.startsWith('[')
      ? slateEditor.locator(sourceText).first()
      : slateEditor.locator('[data-block-type]').filter({ hasText: sourceText }).first();

    // Hover over the source block to reveal the drag handle
    await sourceBlock.scrollIntoViewIfNeeded();
    await expect(sourceBlock).toBeVisible();
    await sourceBlock.hover({ force: true });

    // Force visibility of hover controls
    await BlockSelectors.hoverControls(page).evaluate((el) => {
      (el as HTMLElement).style.opacity = '1';
    });

    // Get the drag handle
    const dragHandle = BlockSelectors.dragHandle(page);
    await expect(dragHandle).toBeVisible();

    // Get target block
    const targetBlock = slateEditor
      .locator('[data-block-type]')
      .filter({ hasText: targetText })
      .first();

    const targetBBox = await targetBlock.boundingBox();
    const handleBBox = await dragHandle.boundingBox();

    if (!targetBBox || !handleBBox) {
      throw new Error('Could not get bounding boxes for drag operation');
    }

    const startX = handleBBox.x + handleBBox.width / 2;
    const startY = handleBBox.y + handleBBox.height / 2;
    const endX = targetBBox.x + targetBBox.width / 2;
    const endY =
      edge === 'top'
        ? targetBBox.y + targetBBox.height * 0.15
        : targetBBox.y + targetBBox.height * 0.85;

    // Perform the drag operation using Playwright's built-in drag
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(150);

    // Move to target with intermediate steps for edge detection
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.waitForTimeout(300);

    await page.mouse.up();
    await page.waitForTimeout(1000);
  }

  /**
   * Close the view modal dialog that appears after creating certain block types.
   */
  async function closeViewModal(page: import('@playwright/test').Page) {
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    const dialogText = await dialog.textContent();
    const isErrorDialog =
      dialogText?.includes('Something went wrong') ||
      dialogText?.includes('error') ||
      (await dialog.locator('button:has-text("Reload")').count()) > 0;

    if (isErrorDialog) {
      // Close error dialog by clicking the first visible button
      await dialog.locator('button').filter({ hasNotText: '' }).first().click({ force: true });
    } else {
      // Normal view modal - close with Escape
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(800);

    // Check if dialog is still open, if so try pressing Escape again
    const stillOpen = await page.locator('[role="dialog"]:visible').count();
    if (stillOpen > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }

  test('should reorder Callout block', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(2000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);

    // Create text blocks first
    await page.keyboard.type('Top Text');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bottom Text');
    await page.waitForTimeout(500);

    // Move cursor back to Top Text to insert callout after it
    await page.getByText('Top Text').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Create Callout Block
    await page.keyboard.type('/callout');
    await page.waitForTimeout(1000);
    await page.getByTestId('slash-menu-callout').click();
    await page.waitForTimeout(1000);

    await page.keyboard.type('Callout Content');
    await page.waitForTimeout(500);

    // Verify callout block exists
    await expect(BlockSelectors.blockByType(page, 'callout')).toBeVisible();

    // Initial State: Top Text, Callout, Bottom Text
    // Action: Drag Callout below Bottom Text
    await dragBlock(page, '[data-block-type="callout"]', 'Bottom Text', 'bottom');

    // Verify: Top Text, Bottom Text, Callout
    const allBlocks = BlockSelectors.allBlocks(page);
    const blockTexts: string[] = [];
    const blockCount = await allBlocks.count();
    for (let i = 0; i < blockCount; i++) {
      const text = await allBlocks.nth(i).textContent();
      if (
        text?.includes('Top Text') ||
        text?.includes('Bottom Text') ||
        text?.includes('Callout Content')
      ) {
        blockTexts.push(text);
      }
    }

    expect(blockTexts[0]).toContain('Top Text');
    expect(blockTexts[1]).toContain('Bottom Text');
    expect(blockTexts[2]).toContain('Callout Content');
  });

  test('should create and verify grid block with drag handle', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(2000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);

    // Create text blocks
    await page.keyboard.type('Top Text');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bottom Text');
    await page.keyboard.press('Enter');

    // Create Grid Block
    await page.keyboard.type('/grid');
    await page.waitForTimeout(1000);
    await expect(BlockSelectors.slashMenuGrid(page)).toBeVisible();
    await BlockSelectors.slashMenuGrid(page).click();
    await page.waitForTimeout(2000);

    // Grid creation opens a view modal; close it before interacting with the document editor.
    await closeViewModal(page);

    // Wait for editor to stabilize after modal close
    await page.waitForTimeout(1500);

    // Click on document to ensure focus
    await page.locator('[data-slate-editor="true"]').click();
    await page.waitForTimeout(500);

    // Verify grid block exists and has correct structure
    const gridBlock = BlockSelectors.blockByType(page, 'grid');
    await expect(gridBlock).toBeVisible();

    // Verify drag handle appears on hover
    await gridBlock.scrollIntoViewIfNeeded();
    await gridBlock.hover({ force: true });

    // Force visibility and verify drag handle exists
    await BlockSelectors.hoverControls(page).evaluate((el) => {
      (el as HTMLElement).style.opacity = '1';
    });
    await expect(BlockSelectors.dragHandle(page)).toBeVisible();

    // Verify all blocks are present in the document
    await expect(page.getByText('Top Text')).toBeVisible();
    await expect(page.getByText('Bottom Text')).toBeVisible();
    expect(await BlockSelectors.blockByType(page, 'grid').count()).toBeGreaterThanOrEqual(1);
  });
});
