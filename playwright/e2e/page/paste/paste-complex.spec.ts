import { test, expect, Page } from '@playwright/test';
import { BlockSelectors, EditorSelectors, AddPageSelectors, DropdownSelectors, ModalSelectors, PageSelectors, SpaceSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../../support/test-helpers';

/**
 * Paste Complex Content Tests
 * Migrated from: cypress/e2e/page/paste/paste-complex.cy.ts
 *
 * Tests pasting of mixed-content documents including headings, lists,
 * code blocks, blockquotes, links, and markdown-like text.
 */

/**
 * Paste content into the Slate editor by calling insertData directly.
 */
async function pasteContent(page: Page, html: string, plainText: string) {
  await expect(EditorSelectors.slateEditor(page).first()).toBeVisible({ timeout: 10000 });

  const editors = EditorSelectors.slateEditor(page);
  const editorCount = await editors.count();

  let targetIndex = -1;
  for (let i = 0; i < editorCount; i++) {
    const testId = await editors.nth(i).getAttribute('data-testid');
    if (!testId?.includes('title')) {
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

  await editors.nth(targetIndex).click({ force: true });
  await page.waitForTimeout(300);

  await page.evaluate(
    ({ html, plainText, idx }) => {
      const allEditors = document.querySelectorAll('[data-slate-editor="true"]');
      const targetEditor = allEditors[idx];
      if (!targetEditor) throw new Error('Target editor not found in DOM');

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

  await page.waitForTimeout(1500);
}

/**
 * Verify content exists in the editor (non-title editors).
 */
async function verifyEditorContent(page: Page, expectedContent: string) {
  const editors = EditorSelectors.slateEditor(page);
  const editorCount = await editors.count();
  let found = false;

  for (let i = 0; i < editorCount; i++) {
    const testId = await editors.nth(i).getAttribute('data-testid');
    if (!testId?.includes('title')) {
      const innerHTML = await editors.nth(i).innerHTML();
      if (innerHTML.includes(expectedContent)) {
        found = true;
        break;
      }
    }
  }

  expect(found).toBe(true);
}

/**
 * Create a new test page.
 */
async function createTestPage(page: Page, request: import('@playwright/test').APIRequestContext) {
  const testEmail = generateRandomEmail();

  await signInAndWaitForApp(page, request, testEmail);

  await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);

  await SpaceSelectors.itemByName(page, 'General').first().click();
  await page.waitForTimeout(500);

  const generalSpace = SpaceSelectors.itemByName(page, 'General').first();
  const inlineAdd = generalSpace.getByTestId('inline-add-page').first();
  await expect(inlineAdd).toBeVisible();
  await inlineAdd.click();
  await page.waitForTimeout(1000);

  await DropdownSelectors.menuItem(page).first().click();
  await page.waitForTimeout(1000);

  const newPageModal = page.getByTestId('new-page-modal');
  if ((await newPageModal.count()) > 0) {
    await page.getByTestId('space-item').first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(3000);
  }

  await closeModalsIfOpen(page);

  await PageSelectors.itemByName(page, 'Untitled').click();
  await page.waitForTimeout(1000);
}

test.describe('Paste Complex Content Tests', () => {
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

  test('should paste all complex document types correctly', async ({ page, request }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // Mixed Content Document
    {
      const html = `
        <h1>Project Documentation</h1>
        <p>This is an introduction with <strong>bold</strong> and <em>italic</em> text.</p>
        <h2>Features</h2>
        <ul>
          <li>Feature one</li>
          <li>Feature two</li>
          <li>Feature three</li>
        </ul>
        <h2>Code Example</h2>
        <pre><code class="language-javascript">console.log("Hello World");</code></pre>
        <blockquote>Remember to test your code!</blockquote>
        <p>For more information, visit <a href="https://example.com">our website</a>.</p>
      `;
      const plainText =
        'Project Documentation\nThis is an introduction with bold and italic text.\nFeatures\nFeature one\nFeature two\nFeature three\nCode Example\nconsole.log("Hello World");\nRemember to test your code!\nFor more information, visit our website.';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(2000);

      // Verify structural elements
      await expect(slateEditor.locator('.heading.level-1')).toContainText('Project Documentation');
      expect(
        await slateEditor.locator('[data-block-type="bulleted_list"]').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(slateEditor.locator('pre code')).toContainText('console.log');
      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText('Remember to test');
      await expect(
        slateEditor.locator('span.cursor-pointer.underline')
      ).toContainText('our website');
    }

    // GitHub-style README
    {
      const html = `
        <h1>My Project</h1>
        <p>A description with <strong>important</strong> information.</p>
        <h2>Installation</h2>
        <pre><code class="language-bash">npm install my-package</code></pre>
        <h2>Usage</h2>
        <pre><code class="language-javascript">import { Something } from 'my-package';
  const result = Something.doThing();</code></pre>
        <h2>Features</h2>
        <ul>
          <li><input type="checkbox" checked> Feature 1</li>
          <li><input type="checkbox" checked> Feature 2</li>
          <li><input type="checkbox"> Planned feature</li>
        </ul>
        <p>Visit <a href="https://docs.example.com">documentation</a> for more info.</p>
      `;
      const plainText =
        "My Project\nA description with important information.\nInstallation\nnpm install my-package\nUsage\nimport { Something } from 'my-package';\nconst result = Something.doThing();\nFeatures\nFeature 1\nFeature 2\nPlanned feature\nVisit documentation for more info.";

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(2000);

      await expect(slateEditor.locator('.heading.level-1')).toContainText('My Project');
      await expect(slateEditor.locator('pre code')).toContainText('npm install');
      expect(
        await slateEditor.locator('[data-block-type="todo_list"]').count()
      ).toBeGreaterThanOrEqual(3);
    }

    // Markdown-like Plain Text
    {
      const plainText = `# Main Title

This is a paragraph with **bold** and *italic* text.

## Section

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const x = 10;
\`\`\`

> A quote

---`;

      await pasteContent(page, '', plainText);
      await page.waitForTimeout(2000);

      await expect(slateEditor.locator('.heading.level-1')).toContainText('Main Title');
      await expect(slateEditor.locator('strong')).toContainText('bold');
      await expect(
        slateEditor.locator('[data-block-type="bulleted_list"]')
      ).toContainText('List item 1');
      await expect(slateEditor.locator('pre code')).toContainText('const x = 10');
      await expect(
        slateEditor.locator('[data-block-type="quote"]')
      ).toContainText('A quote');
    }

    // DevTools Verification
    {
      const html = '<p>Test <strong>bold</strong> content</p>';
      const plainText = 'Test bold content';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await verifyEditorContent(page, 'bold');
    }

    // Complex Structure Verification
    {
      const html = `
        <h1>Title</h1>
        <p>Paragraph</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `;
      const plainText = 'Title\nParagraph\nItem 1\nItem 2';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1500);

      await expect(slateEditor.locator('.heading.level-1')).toContainText('Title');
      await expect(slateEditor.locator('div')).toContainText('Paragraph');
      await expect(
        slateEditor.locator('[data-block-type="bulleted_list"]')
      ).toContainText('Item 1');
    }
  });
});
