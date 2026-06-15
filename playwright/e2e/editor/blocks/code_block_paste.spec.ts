import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Code Block Paste Tests
 * Regression test for: https://github.com/AppFlowy-IO/AppFlowy-Web/issues/261
 *
 * Pasting content into a code block should insert the text inside the block,
 * not below it. The slash menu should also not open when typing "/" inside
 * a code block.
 */
test.describe('Code Block Paste', () => {
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

  /**
   * Helper: insert a code block via the slash menu and wait for it to appear.
   */
  async function insertCodeBlock(page: Page) {
    await page.keyboard.type('/', { delay: 50 });
    await page.waitForTimeout(1000);

    const slashPanel = page.getByTestId('slash-panel');
    await expect(slashPanel).toBeVisible({ timeout: 10000 });

    await page.keyboard.type('code', { delay: 50 });
    await page.waitForTimeout(500);

    await page.getByTestId('slash-menu-code').click({ force: true });
    await page.waitForTimeout(1000);

    await expect(page.locator('[data-block-type="code"]')).toBeVisible({ timeout: 5000 });
  }

  test('pasting plain text into a code block should insert inside, not below', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);
    await insertCodeBlock(page);

    // Focus the code block
    const codeBlock = page.locator('[data-block-type="code"]');
    await codeBlock.click({ force: true });
    await page.waitForTimeout(300);

    // Copy multi-line text to clipboard and paste it
    const pasteText = 'const a = 1;\nconst b = 2;\nconst c = a + b;';

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, pasteText);

    await page.keyboard.press(`${cmdKey}+v`);
    await page.waitForTimeout(500);

    // The text should appear INSIDE the code block, not below it
    const codeBlockText = await codeBlock.innerText();
    expect(codeBlockText).toContain('const a = 1;');
    expect(codeBlockText).toContain('const b = 2;');
    expect(codeBlockText).toContain('const c = a + b;');
  });

  test('pasting HTML-formatted code into a code block should insert as plain text inside', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);
    await insertCodeBlock(page);

    const codeBlock = page.locator('[data-block-type="code"]');
    await codeBlock.click({ force: true });
    await page.waitForTimeout(300);

    // Simulate pasting HTML (e.g. from ChatGPT) that contains code
    // The code block should receive the plain text, not create new blocks
    const htmlContent = '<pre><code>function hello() {\n  return "world";\n}</code></pre>';
    const plainContent = 'function hello() {\n  return "world";\n}';

    await page.evaluate(
      async ({ html, plain }) => {
        const clipboardItem = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });

        await navigator.clipboard.write([clipboardItem]);
      },
      { html: htmlContent, plain: plainContent }
    );

    await page.keyboard.press(`${cmdKey}+v`);
    await page.waitForTimeout(500);

    // All pasted text should be inside the code block
    const codeBlockText = await codeBlock.innerText();
    expect(codeBlockText).toContain('function hello()');
    expect(codeBlockText).toContain('return "world"');

    // No new blocks should have been created below the code block
    const allBlocks = page.locator('[data-block-type]');
    const blockTypes = await allBlocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-type'))
    );
    const codeBlockCount = blockTypes.filter((t) => t === 'code').length;
    expect(codeBlockCount).toBe(1);
  });

  test('typing "/" inside a code block should not open the slash menu', async ({
    page,
    request,
  }) => {
    await setupEditor(page, request);
    await insertCodeBlock(page);

    const codeBlock = page.locator('[data-block-type="code"]');
    await codeBlock.click({ force: true });
    await page.waitForTimeout(300);

    // Type a "/" inside the code block
    await page.keyboard.type('/', { delay: 50 });
    await page.waitForTimeout(1000);

    // The slash panel should NOT appear
    const slashPanel = page.getByTestId('slash-panel');
    await expect(slashPanel).not.toBeVisible();

    // The "/" should be typed into the code block
    const codeBlockText = await codeBlock.innerText();
    expect(codeBlockText).toContain('/');
  });
});
