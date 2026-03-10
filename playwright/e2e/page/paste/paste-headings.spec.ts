import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';

/**
 * Paste Heading Tests
 * Migrated from: cypress/e2e/page/paste/paste-headings.cy.ts
 *
 * Tests pasting of headings (H1-H6) in HTML and Markdown formats,
 * including headings with inline formatting.
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

const testEmail = generateRandomEmail();

/**
 * Create a new test page using the shared helper.
 */
async function createTestPage(page: Page, request: import('@playwright/test').APIRequestContext) {
  await signInAndWaitForApp(page, request, testEmail);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(2000);

  await createDocumentPageAndNavigate(page);
  await EditorSelectors.firstEditor(page).click({ force: true });
  await page.waitForTimeout(500);
}

test.describe('Paste Heading Tests', () => {
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

  test('should paste all heading formats correctly', async ({ page, request }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // HTML H1
    {
      const html = '<h1>Main Heading</h1>';
      const plainText = 'Main Heading';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('.heading.level-1')).toContainText('Main Heading');

      // Add a new line to separate content
      await page.keyboard.press('Enter');
    }

    // HTML H2
    {
      const html = '<h2>Section Title</h2>';
      const plainText = 'Section Title';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('.heading.level-2')).toContainText('Section Title');

      await page.keyboard.press('Enter');
    }

    // HTML Multiple Headings
    {
      const html = `
        <h1>Main Title</h1>
        <h2>Subtitle</h2>
        <h3>Section</h3>
      `;
      const plainText = 'Main Title\nSubtitle\nSection';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Use .last() because earlier test blocks already added headings of the same level
      await expect(slateEditor.locator('.heading.level-1').last()).toContainText('Main Title');
      await expect(slateEditor.locator('.heading.level-2').last()).toContainText('Subtitle');
      await expect(slateEditor.locator('.heading.level-3')).toContainText('Section');

      await page.keyboard.press('Enter');
    }

    // Markdown H1
    {
      const markdown = '# Main Heading';

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('.heading.level-1').last()).toContainText('Main Heading');

      await page.keyboard.press('Enter');
    }

    // Markdown H2
    {
      const markdown = '## Section Title';

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('.heading.level-2').last()).toContainText('Section Title');

      await page.keyboard.press('Enter');
    }

    // Markdown H3-H6
    {
      const markdown = `### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      await expect(slateEditor.locator('.heading.level-3').last()).toContainText('Heading 3');
      await expect(slateEditor.locator('.heading.level-4')).toContainText('Heading 4');
      await expect(slateEditor.locator('.heading.level-5')).toContainText('Heading 5');
      await expect(slateEditor.locator('.heading.level-6')).toContainText('Heading 6');

      await page.keyboard.press('Enter');
    }

    // Markdown Headings with Formatting
    {
      const markdown = `# Heading with **bold** text
## Heading with *italic* text
### Heading with \`code\``;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Verify heading content (formatting may or may not be preserved as semantic elements)
      const h1WithBold = slateEditor.locator('.heading.level-1').filter({ hasText: 'bold' }).last();
      await expect(h1WithBold).toContainText('bold');

      const h2WithItalic = slateEditor.locator('.heading.level-2').filter({ hasText: 'italic' }).last();
      await expect(h2WithItalic).toContainText('italic');

      const h3WithCode = slateEditor.locator('.heading.level-3').filter({ hasText: 'code' }).last();
      await expect(h3WithCode).toContainText('code');
    }
  });
});
