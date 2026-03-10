import { test, expect, Page } from '@playwright/test';
import { EditorSelectors, AddPageSelectors, DropdownSelectors, ModalSelectors, PageSelectors, SpaceSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../../support/test-helpers';

/**
 * Paste Formatting Tests
 * Migrated from: cypress/e2e/page/paste/paste-formatting.cy.ts
 *
 * Tests pasting of inline formatting: bold, italic, underline, strikethrough,
 * code, links, and nested/mixed formatting in both HTML and Markdown.
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
 * Clear the editor content by selecting all and deleting.
 */
async function clearEditor(page: Page) {
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

  await editors.nth(targetIndex).click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
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

test.describe('Paste Formatting Tests', () => {
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

  test('should paste HTML inline formatting (Bold, Italic, Underline, Strikethrough)', async ({
    page,
    request,
  }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // HTML Bold
    await pasteContent(page, '<p>This is <strong>bold</strong> text</p>', 'This is bold text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold');

    await clearEditor(page);

    // HTML Italic
    await pasteContent(page, '<p>This is <em>italic</em> text</p>', 'This is italic text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('em')).toContainText('italic');

    await clearEditor(page);

    // HTML Underline
    await pasteContent(page, '<p>This is <u>underlined</u> text</p>', 'This is underlined text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('u')).toContainText('underlined');

    await clearEditor(page);

    // HTML Strikethrough
    await pasteContent(
      page,
      '<p>This is <s>strikethrough</s> text</p>',
      'This is strikethrough text'
    );
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('s')).toContainText('strikethrough');
  });

  test('should paste HTML special formatting (Code, Link, Mixed, Nested)', async ({
    page,
    request,
  }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // HTML Inline Code
    await pasteContent(
      page,
      '<p>Use the <code>console.log()</code> function</p>',
      'Use the console.log() function'
    );
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('console.log()');

    await clearEditor(page);

    // HTML Mixed Formatting
    await pasteContent(
      page,
      '<p>Text with <strong>bold</strong>, <em>italic</em>, and <u>underline</u></p>',
      'Text with bold, italic, and underline'
    );
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold');
    await expect(slateEditor.locator('em')).toContainText('italic');
    await expect(slateEditor.locator('u')).toContainText('underline');

    await clearEditor(page);

    // HTML Link
    await pasteContent(
      page,
      '<p>Visit <a href="https://appflowy.io">AppFlowy</a> website</p>',
      'Visit AppFlowy website'
    );
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('span.cursor-pointer.underline')).toContainText('AppFlowy');

    await clearEditor(page);

    // HTML Nested Formatting
    await pasteContent(
      page,
      '<p>Text with <strong>bold and <em>italic</em> nested</strong></p>',
      'Text with bold and italic nested'
    );
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold and');
    await expect(slateEditor.locator('strong').locator('em')).toContainText('italic');

    await clearEditor(page);

    // HTML Complex Nested Formatting
    await pasteContent(
      page,
      '<p><strong><em><u>Bold, italic, and underlined</u></em></strong> text</p>',
      'Bold, italic, and underlined text'
    );
    await page.waitForTimeout(500);
    await expect(
      slateEditor.locator('strong').locator('em').locator('u')
    ).toContainText('Bold, italic, and underlined');
  });

  test('should paste Markdown inline formatting (Bold, Italic, Strikethrough, Code)', async ({
    page,
    request,
  }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // Markdown Bold (asterisk)
    await pasteContent(page, '', 'This is **bold** text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold');

    await clearEditor(page);

    // Markdown Bold (underscore)
    await pasteContent(page, '', 'This is __bold__ text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold');

    await clearEditor(page);

    // Markdown Italic (asterisk)
    await pasteContent(page, '', 'This is *italic* text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('em')).toContainText('italic');

    await clearEditor(page);

    // Markdown Italic (underscore)
    await pasteContent(page, '', 'This is _italic_ text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('em')).toContainText('italic');

    await clearEditor(page);

    // Markdown Strikethrough
    await pasteContent(page, '', 'This is ~~strikethrough~~ text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('s')).toContainText('strikethrough');

    await clearEditor(page);

    // Markdown Inline Code
    await pasteContent(page, '', 'Use the `console.log()` function');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('console.log()');
  });

  test('should paste Markdown complex/mixed formatting (Mixed, Link, Nested)', async ({
    page,
    request,
  }) => {
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // Markdown Mixed Formatting
    await pasteContent(page, '', 'Text with **bold**, *italic*, ~~strikethrough~~, and `code`');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold');
    await expect(slateEditor.locator('em')).toContainText('italic');
    await expect(slateEditor.locator('s')).toContainText('strikethrough');
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('code');

    await clearEditor(page);

    // Markdown Link
    await pasteContent(page, '', 'Visit [AppFlowy](https://appflowy.io) website');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('span.cursor-pointer.underline')).toContainText('AppFlowy');

    await clearEditor(page);

    // Markdown Nested Formatting
    await pasteContent(page, '', 'Text with **bold and *italic* nested**');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong')).toContainText('bold and');
    await expect(slateEditor.locator('strong').locator('em')).toContainText('italic');

    await clearEditor(page);

    // Markdown Complex Nested (bold AND italic)
    await pasteContent(page, '', '***Bold and italic*** text');
    await page.waitForTimeout(500);
    await expect(slateEditor.locator('strong').locator('em')).toContainText('Bold and italic');

    await clearEditor(page);

    // Markdown Link with Formatting
    await pasteContent(page, '', 'Visit [**AppFlowy** website](https://appflowy.io) for more');
    await page.waitForTimeout(500);
    await expect(
      slateEditor.locator('span.cursor-pointer.underline').locator('strong')
    ).toContainText('AppFlowy');

    await clearEditor(page);

    // Markdown Multiple Inline Code
    await pasteContent(page, '', 'Compare `const` vs `let` vs `var` in JavaScript');
    await page.waitForTimeout(500);
    expect(
      await slateEditor.locator('span.bg-border-primary').count()
    ).toBeGreaterThanOrEqual(3);
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('const');
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('let');
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('var');
  });
});
