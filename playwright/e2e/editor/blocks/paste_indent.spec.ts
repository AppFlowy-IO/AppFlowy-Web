import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Repro: type "1","2","3","4" on separate lines, select all, copy,
 * then paste on a new line. The pasted blocks should NOT be indented
 * (i.e. should appear as siblings of the original blocks at the same
 * indent level), but a bug causes them to be nested under the last block.
 */
test.describe('Editor - Paste Indentation', () => {
  const testEmail = generateRandomEmail();
  const isMac = process.platform === 'darwin';
  const cmdKey = isMac ? 'Meta' : 'Control';

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  async function setupEditor(
    page: Page,
    request: import('@playwright/test').APIRequestContext
  ) {
    await signInAndWaitForApp(page, request, testEmail);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
    await page.waitForTimeout(1000);

    await createDocumentPageAndNavigate(page);
    await EditorSelectors.firstEditor(page).click({ force: true });
    await page.waitForTimeout(500);
  }

  test('pasting copied lines on a new line should not indent the pasted blocks', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);

    // Type 1\n2\n3\n4
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('4');
    await page.waitForTimeout(300);

    // Select all and copy
    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${cmdKey}+c`);
    await page.waitForTimeout(300);

    // Move to end and create a new empty line, then paste
    await page.keyboard.press(`${cmdKey}+End`);
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await page.keyboard.press(`${cmdKey}+v`);
    await page.waitForTimeout(800);

    // Collect text blocks with their indent depth (number of parent
    // [data-block-type] ancestors inside the editor).
    const editor = EditorSelectors.slateEditor(page);
    const blocks = await editor.locator('[data-block-type]').evaluateAll((els) =>
      els.map((el) => {
        let depth = 0;
        let parent: HTMLElement | null = el.parentElement;
        while (parent) {
          if (parent.hasAttribute('data-block-type')) depth += 1;
          parent = parent.parentElement;
        }
        return {
          text: (el as HTMLElement).innerText.trim(),
          depth,
        };
      })
    );

    // Keep only the leaf text blocks for the values we typed/pasted
    const numeric = blocks.filter((b) => /^[1-4]$/.test(b.text));

    // Expect 8 entries: original 1,2,3,4 and pasted 1,2,3,4
    expect(numeric.length).toBe(8);

    // All numeric blocks should be at the same depth (no indentation
    // introduced by paste). If the bug is present, the pasted blocks
    // will have greater depth than the originals.
    const depths = numeric.map((b) => b.depth);
    const minDepth = Math.min(...depths);
    const maxDepth = Math.max(...depths);
    expect(maxDepth).toBe(minDepth);

    // Strict assertion on paste position. The empty placeholder block created
    // by Enter must be REPLACED by the pasted content, so the top-level
    // sequence (in document order) must be exactly:
    //   "1","2","3","4","1","2","3","4"
    // optionally followed by a single trailing empty block that the editor
    // maintains for the cursor — but NO empty block between the original "4"
    // and the first pasted "1".
    const topLevel = blocks
      .filter((b) => b.depth === minDepth)
      .map((b) => b.text);

    // Drop only a final trailing empty block (cursor-tail), not interior ones.
    const trimmed = topLevel.length > 0 && topLevel[topLevel.length - 1] === ''
      ? topLevel.slice(0, -1)
      : topLevel;

    expect(trimmed).toEqual(['1', '2', '3', '4', '1', '2', '3', '4']);

    // No empty placeholder should remain anywhere between non-empty entries.
    expect(trimmed.every((t) => t !== '')).toBe(true);
  });

  test('after deleting the last source line, Backspace should still remove blocks', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);

    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('4');
    await page.waitForTimeout(300);

    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(150);
    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(150);
    await page.keyboard.press(`${cmdKey}+c`);
    await page.waitForTimeout(300);

    await page.keyboard.press(`${cmdKey}+End`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.keyboard.press(`${cmdKey}+v`);
    await page.waitForTimeout(800);

    const editor = EditorSelectors.slateEditor(page);

    // Delete the "4" on the source line: navigate to it and remove the char.
    // After paste cursor is at end of pasted content; move back to original "4".
    // Easiest: just press Backspace until "4" is gone, then one more Backspace
    // and assert something actually changed in the document.
    const before = await editor.innerText();

    // Click on the original "4" block at depth 0
    const originalFour = editor
      .locator('[data-block-type]')
      .filter({ hasText: /^4$/ })
      .first();

    await originalFour.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace'); // remove '4'
    await page.waitForTimeout(150);

    // Now the original block is empty. Backspace again must delete/merge —
    // the document text must change again.
    const afterDelete4 = await editor.innerText();

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const afterSecondBackspace = await editor.innerText();

    expect(afterSecondBackspace).not.toBe(afterDelete4);
    expect(before).not.toBe(afterSecondBackspace);
  });

  test('pasting over an expanded selection replaces the selected range', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);

    // Source: 1,2,3,4
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('4');
    await page.waitForTimeout(300);

    // Select all → copy
    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(150);
    await page.keyboard.press(`${cmdKey}+a`);
    await page.waitForTimeout(150);
    await page.keyboard.press(`${cmdKey}+c`);
    await page.waitForTimeout(300);

    // Now paste back OVER the same selection (still selected after copy).
    // Mirrors Slate's `Transforms.insertFragment` semantics: the expanded
    // range must be deleted first, then the pasted blocks inserted in its
    // place — so the document should contain exactly one copy of 1..4.
    await page.keyboard.press(`${cmdKey}+v`);
    await page.waitForTimeout(800);

    const editor = EditorSelectors.slateEditor(page);
    const topLevelBlocks = await editor.locator('[data-block-type]').evaluateAll((els) =>
      els.map((el) => {
        let depth = 0;
        let parent: HTMLElement | null = el.parentElement;
        while (parent) {
          if (parent.hasAttribute('data-block-type')) depth += 1;
          parent = parent.parentElement;
        }
        return { text: (el as HTMLElement).innerText.trim(), depth };
      })
    );

    const minDepth = Math.min(...topLevelBlocks.map((b) => b.depth));
    const top = topLevelBlocks.filter((b) => b.depth === minDepth).map((b) => b.text);
    const trimmed = top.length > 0 && top[top.length - 1] === '' ? top.slice(0, -1) : top;

    // Exactly one copy of the source — not duplicated.
    expect(trimmed).toEqual(['1', '2', '3', '4']);
  });
});
