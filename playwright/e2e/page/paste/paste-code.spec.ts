import { test, expect, Page } from '@playwright/test';
import { BlockSelectors, EditorSelectors, AddPageSelectors, DropdownSelectors, ModalSelectors, PageSelectors, SpaceSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../../support/test-helpers';

/**
 * Paste Code Block Tests
 * Migrated from: cypress/e2e/page/paste/paste-code.cy.ts
 *
 * Uses Slate editor's insertData method via page.evaluate to bypass
 * the browser clipboard/event system for reliable paste testing.
 */

/**
 * Paste content into the Slate editor by calling insertData directly.
 * This mirrors the Cypress pasteContent helper from paste-utils.ts.
 */
async function pasteContent(page: Page, html: string, plainText: string) {
  // Wait for editors to be available
  await expect(EditorSelectors.slateEditor(page).first()).toBeVisible({ timeout: 10000 });

  // Find and click the main content editor (not the title)
  const editors = EditorSelectors.slateEditor(page);
  const editorCount = await editors.count();

  let targetIndex = -1;
  for (let i = 0; i < editorCount; i++) {
    const testId = await editors.nth(i).getAttribute('data-testid');
    const hasTitle = testId?.includes('title');
    if (!hasTitle) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1 && editorCount > 0) {
    targetIndex = editorCount - 1;
  }

  if (targetIndex === -1) {
    throw new Error('No editor found');
  }

  // Click the editor to ensure it is active
  await editors.nth(targetIndex).click({ force: true });
  await page.waitForTimeout(300);

  // Use page.evaluate to call Slate's insertData directly
  await page.evaluate(
    ({ html, plainText, idx }) => {
      const allEditors = document.querySelectorAll('[data-slate-editor="true"]');
      const targetEditor = allEditors[idx];
      if (!targetEditor) throw new Error('Target editor not found in DOM');

      // Find the React fiber to get the Slate editor instance
      const editorKey = Object.keys(targetEditor).find(
        (key) => key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
      );

      let slateEditor: any = null;

      if (editorKey) {
        let currentFiber = (targetEditor as any)[editorKey];
        let depth = 0;
        while (currentFiber && !slateEditor && depth < 50) {
          if (currentFiber.memoizedProps?.editor) {
            slateEditor = currentFiber.memoizedProps.editor;
          } else if (currentFiber.stateNode?.editor) {
            slateEditor = currentFiber.stateNode.editor;
          }
          currentFiber = currentFiber.return;
          depth++;
        }
      }

      if (slateEditor && typeof slateEditor.insertData === 'function') {
        const dataTransfer = new DataTransfer();
        if (html) dataTransfer.setData('text/html', html);
        if (plainText) dataTransfer.setData('text/plain', plainText);
        else if (!html) dataTransfer.setData('text/plain', '');
        slateEditor.insertData(dataTransfer);
      } else {
        // Fallback: dispatch a paste event
        const clipboardData = new DataTransfer();
        if (html) clipboardData.setData('text/html', html);
        if (plainText) clipboardData.setData('text/plain', plainText);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboardData,
        });
        targetEditor.dispatchEvent(pasteEvent);
      }
    },
    { html, plainText, idx: targetIndex }
  );

  // Wait for paste to process
  await page.waitForTimeout(1500);
}

/**
 * Create a new test page: sign in, expand General space, create an Untitled page.
 */
async function createTestPage(page: Page, request: import('@playwright/test').APIRequestContext) {
  const testEmail = generateRandomEmail();

  await signInAndWaitForApp(page, request, testEmail);

  // Wait for sidebar
  await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);

  // Expand General space
  await SpaceSelectors.itemByName(page, 'General').first().click();
  await page.waitForTimeout(500);

  // Use inline add button on General space
  const generalSpace = SpaceSelectors.itemByName(page, 'General').first();
  const inlineAdd = generalSpace.getByTestId('inline-add-page').first();
  await expect(inlineAdd).toBeVisible();
  await inlineAdd.click();
  await page.waitForTimeout(1000);

  // Select first item (Page) from the menu
  await DropdownSelectors.menuItem(page).first().click();
  await page.waitForTimeout(1000);

  // Handle the new page modal if it appears
  const newPageModal = page.getByTestId('new-page-modal');
  if ((await newPageModal.count()) > 0) {
    await page.getByTestId('space-item').first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(3000);
  }

  // Close any remaining modal dialogs
  await closeModalsIfOpen(page);

  // Select the new Untitled page
  await PageSelectors.itemByName(page, 'Untitled').click();
  await page.waitForTimeout(1000);
}

test.describe('Paste Code Block Tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('Cannot resolve a DOM point from Slate point') ||
        err.message.includes('Cannot resolve a DOM node from Slate node') ||
        err.message.includes('Cannot resolve a Slate point from DOM point') ||
        err.message.includes('Cannot resolve a Slate node from DOM node')
      ) {
        return;
      }
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should paste all code block formats correctly', async ({ page, request }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // HTML Code Block
    {
      const html = '<pre><code>const x = 10;\nconsole.log(x);</code></pre>';
      const plainText = 'const x = 10;\nconsole.log(x);';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code').first()).toContainText('const x = 10');
    }

    // HTML Code Block with language
    {
      const html =
        '<pre><code class="language-javascript">function hello() {\n  console.log("Hello");\n}</code></pre>';
      const plainText = 'function hello() {\n  console.log("Hello");\n}';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code')).toContainText(['function hello']);
    }

    // HTML Multiple Language Code Blocks
    {
      const html = `
        <pre><code class="language-python">def greet():
    print("Hello")</code></pre>
        <pre><code class="language-typescript">const greeting: string = "Hello";</code></pre>
      `;
      const plainText =
        'def greet():\n    print("Hello")\nconst greeting: string = "Hello";';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code')).toContainText(['def greet']);
      await expect(slateEditor.locator('pre code')).toContainText(['const greeting']);
    }

    // HTML Blockquote
    {
      const html = '<blockquote>This is a quoted text</blockquote>';
      const plainText = 'This is a quoted text';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['This is a quoted text']);
    }

    // HTML Nested Blockquotes
    {
      const html = `
        <blockquote>
          First level quote
          <blockquote>Second level quote</blockquote>
        </blockquote>
      `;
      const plainText = 'First level quote\nSecond level quote';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['First level quote']);
      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['Second level quote']);
    }

    // Markdown Code Block with Language
    {
      const markdown = `\`\`\`javascript
const x = 10;
console.log(x);
\`\`\``;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code')).toContainText(['const x = 10']);
    }

    // Markdown Code Block without Language
    {
      const markdown = `\`\`\`
function hello() {
  console.log("Hello");
}
\`\`\``;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code')).toContainText(['function hello']);
    }

    // Markdown Inline Code
    {
      const markdown = 'Use the `console.log()` function to print output.';

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(
        slateEditor.locator('span.bg-border-primary')
      ).toContainText('console.log');
    }

    // Markdown Multiple Language Code Blocks
    {
      const markdown = `\`\`\`python
def greet():
    print("Hello")
\`\`\`

\`\`\`typescript
const greeting: string = "Hello";
\`\`\`

\`\`\`bash
echo "Hello World"
\`\`\``;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('pre code')).toContainText(['def greet']);
      await expect(slateEditor.locator('pre code')).toContainText(['const greeting']);
      await expect(slateEditor.locator('pre code')).toContainText(['echo']);
    }

    // Markdown Blockquote
    {
      const markdown = '> This is a quoted text';

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['This is a quoted text']);
    }

    // Markdown Nested Blockquotes
    {
      const markdown = `> First level quote
>> Second level quote
>>> Third level quote`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['First level quote']);
      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['Second level quote']);
      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText(['Third level quote']);
    }

    // Markdown Blockquote with Formatting
    {
      const markdown = '> **Important:** This is a *quoted* text with `code`';

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      const quoteBlock = slateEditor.locator('[data-block-type="quote"]').last();
      // Verify the quote block exists and contains some of the pasted text
      // Note: markdown inline formatting (bold/italic/code) may be stripped in blockquotes
      await expect(quoteBlock).toContainText('quoted text');
    }
  });
});
