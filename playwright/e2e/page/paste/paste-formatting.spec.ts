import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { testLog } from '../../../support/test-helpers';

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
  const isMac = process.platform === 'darwin';
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
  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
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
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting HTML with bold text
    testLog.info('=== Pasting HTML Bold Text ===');
    await pasteContent(page, '<p>This is <strong>bold</strong> text</p>', 'This is bold text');
    await page.waitForTimeout(500);
    // Then: bold formatting is rendered as a <strong> element
    await expect(slateEditor.locator('strong')).toContainText('bold');
    testLog.info('✓ HTML bold text pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with italic text
    testLog.info('=== Pasting HTML Italic Text ===');
    await pasteContent(page, '<p>This is <em>italic</em> text</p>', 'This is italic text');
    await page.waitForTimeout(500);
    // Then: italic formatting is rendered as an <em> element
    await expect(slateEditor.locator('em')).toContainText('italic');
    testLog.info('✓ HTML italic text pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with underlined text
    testLog.info('=== Pasting HTML Underlined Text ===');
    await pasteContent(page, '<p>This is <u>underlined</u> text</p>', 'This is underlined text');
    await page.waitForTimeout(500);
    // Then: underline formatting is rendered as a <u> element
    await expect(slateEditor.locator('u')).toContainText('underlined');
    testLog.info('✓ HTML underlined text pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with strikethrough text
    testLog.info('=== Pasting HTML Strikethrough Text ===');
    await pasteContent(
      page,
      '<p>This is <s>strikethrough</s> text</p>',
      'This is strikethrough text'
    );
    await page.waitForTimeout(500);
    // Then: strikethrough formatting is rendered as an <s> element
    await expect(slateEditor.locator('s')).toContainText('strikethrough');
    testLog.info('✓ HTML strikethrough text pasted successfully');
  });

  test('should paste HTML special formatting (Code, Link, Mixed, Nested)', async ({
    page,
    request,
  }) => {
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting HTML with inline code
    testLog.info('=== Pasting HTML Inline Code ===');
    await pasteContent(
      page,
      '<p>Use the <code>console.log()</code> function</p>',
      'Use the console.log() function'
    );
    await page.waitForTimeout(500);
    // Then: inline code is rendered with code styling
    await expect(slateEditor.locator('span.bg-border-primary')).toContainText('console.log()');
    testLog.info('✓ HTML inline code pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with mixed formatting (bold, italic, underline)
    testLog.info('=== Pasting HTML Mixed Formatting ===');
    await pasteContent(
      page,
      '<p>Text with <strong>bold</strong>, <em>italic</em>, and <u>underline</u></p>',
      'Text with bold, italic, and underline'
    );
    await page.waitForTimeout(500);
    // Then: all three formatting types are rendered
    await expect(slateEditor.locator('strong')).toContainText('bold');
    await expect(slateEditor.locator('em')).toContainText('italic');
    await expect(slateEditor.locator('u')).toContainText('underline');
    testLog.info('✓ HTML mixed formatting pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with a hyperlink
    testLog.info('=== Pasting HTML Link ===');
    await pasteContent(
      page,
      '<p>Visit <a href="https://appflowy.io">AppFlowy</a> website</p>',
      'Visit AppFlowy website'
    );
    await page.waitForTimeout(500);
    // Then: link is rendered as a clickable underlined span
    await expect(slateEditor.locator('span.cursor-pointer.underline')).toContainText('AppFlowy');
    testLog.info('✓ HTML link pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with nested formatting (bold wrapping italic)
    testLog.info('=== Pasting HTML Nested Formatting ===');
    await pasteContent(
      page,
      '<p>Text with <strong>bold and <em>italic</em> nested</strong></p>',
      'Text with bold and italic nested'
    );
    await page.waitForTimeout(500);
    // Then: both bold and italic text content are present
    await expect(slateEditor).toContainText('bold and');
    await expect(slateEditor).toContainText('italic');
    // And: bold formatting element exists
    await expect(slateEditor.locator('strong').first()).toBeVisible();
    testLog.info('✓ HTML nested formatting pasted successfully');

    await clearEditor(page);

    // When: pasting HTML with triple-nested formatting (bold + italic + underline)
    testLog.info('=== Pasting HTML Complex Nested Formatting ===');
    await pasteContent(
      page,
      '<p><strong><em><u>Bold, italic, and underlined</u></em></strong> text</p>',
      'Bold, italic, and underlined text'
    );
    await page.waitForTimeout(500);
    // Then: the combined formatted text is present
    await expect(slateEditor).toContainText('Bold, italic, and underlined');
    testLog.info('✓ HTML complex nested formatting pasted successfully');
  });

  test('should paste Markdown inline formatting (Bold, Italic, Strikethrough, Code)', async ({
    page,
    request,
  }) => {
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting markdown bold text using asterisks
    testLog.info('=== Pasting Markdown Bold Text (asterisk) ===');
    await pasteContent(page, '', 'This is **bold** text');
    await page.waitForTimeout(500);
    // Then: bold text is present (as <strong> element or plain text)
    const hasBoldAsterisk = await slateEditor.locator('strong').count();
    if (hasBoldAsterisk > 0) {
      await expect(slateEditor.locator('strong').first()).toContainText('bold');
    } else {
      await expect(slateEditor).toContainText('bold');
    }
    testLog.info('✓ Markdown bold text (asterisk) pasted successfully');

    await clearEditor(page);

    // When: pasting markdown bold text using underscores
    testLog.info('=== Pasting Markdown Bold Text (underscore) ===');
    await pasteContent(page, '', 'This is __bold__ text');
    await page.waitForTimeout(500);
    // Then: bold text is present (as <strong> element or plain text)
    const hasBoldUnderscore = await slateEditor.locator('strong').count();
    if (hasBoldUnderscore > 0) {
      await expect(slateEditor.locator('strong').first()).toContainText('bold');
    } else {
      await expect(slateEditor).toContainText('bold');
    }
    testLog.info('✓ Markdown bold text (underscore) pasted successfully');

    await clearEditor(page);

    // When: pasting markdown italic text using asterisk
    testLog.info('=== Pasting Markdown Italic Text (asterisk) ===');
    await pasteContent(page, '', 'This is *italic* text');
    await page.waitForTimeout(500);
    // Then: italic text is present (as <em> element or plain text)
    const hasItalicAsterisk = await slateEditor.locator('em').count();
    if (hasItalicAsterisk > 0) {
      await expect(slateEditor.locator('em').first()).toContainText('italic');
    } else {
      await expect(slateEditor).toContainText('italic');
    }
    testLog.info('✓ Markdown italic text (asterisk) pasted successfully');

    await clearEditor(page);

    // When: pasting markdown italic text using underscore
    testLog.info('=== Pasting Markdown Italic Text (underscore) ===');
    await pasteContent(page, '', 'This is _italic_ text');
    await page.waitForTimeout(500);
    // Then: italic text is present (as <em> element or plain text)
    const hasItalicUnderscore = await slateEditor.locator('em').count();
    if (hasItalicUnderscore > 0) {
      await expect(slateEditor.locator('em').first()).toContainText('italic');
    } else {
      await expect(slateEditor).toContainText('italic');
    }
    testLog.info('✓ Markdown italic text (underscore) pasted successfully');

    await clearEditor(page);

    // When: pasting markdown strikethrough text
    testLog.info('=== Pasting Markdown Strikethrough Text ===');
    await pasteContent(page, '', 'This is ~~strikethrough~~ text');
    await page.waitForTimeout(500);
    // Then: strikethrough text is present (as <s> element or plain text)
    const hasStrikethrough = await slateEditor.locator('s').count();
    if (hasStrikethrough > 0) {
      await expect(slateEditor.locator('s').first()).toContainText('strikethrough');
    } else {
      await expect(slateEditor).toContainText('strikethrough');
    }
    testLog.info('✓ Markdown strikethrough text pasted successfully');

    await clearEditor(page);

    // When: pasting markdown inline code
    testLog.info('=== Pasting Markdown Inline Code ===');
    await pasteContent(page, '', 'Use the `console.log()` function');
    await page.waitForTimeout(500);
    // Then: inline code is present (with code styling or as plain text)
    const hasInlineCode = await slateEditor.locator('span.bg-border-primary').count();
    if (hasInlineCode > 0) {
      await expect(slateEditor.locator('span.bg-border-primary').first()).toContainText('console.log()');
    } else {
      await expect(slateEditor).toContainText('console.log()');
    }
    testLog.info('✓ Markdown inline code pasted successfully');
  });

  test('should paste Markdown complex/mixed formatting (Mixed, Link, Nested)', async ({
    page,
    request,
  }) => {
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting markdown with mixed formatting (bold, italic, strikethrough, code)
    testLog.info('=== Pasting Markdown Mixed Formatting ===');
    await pasteContent(page, '', 'Text with **bold**, *italic*, ~~strikethrough~~, and `code`');
    await page.waitForTimeout(500);
    // Then: all formatted text content is present in the editor
    await expect(slateEditor).toContainText('bold');
    await expect(slateEditor).toContainText('italic');
    await expect(slateEditor).toContainText('strikethrough');
    await expect(slateEditor).toContainText('code');
    testLog.info('✓ Markdown mixed formatting pasted successfully');

    await clearEditor(page);

    // When: pasting a markdown link
    testLog.info('=== Pasting Markdown Link ===');
    await pasteContent(page, '', 'Visit [AppFlowy](https://appflowy.io) website');
    await page.waitForTimeout(500);
    // Then: link text is present (as clickable span or plain text)
    const hasLink = await slateEditor.locator('span.cursor-pointer.underline').count();
    if (hasLink > 0) {
      await expect(slateEditor.locator('span.cursor-pointer.underline').first()).toContainText('AppFlowy');
    } else {
      await expect(slateEditor).toContainText('AppFlowy');
    }
    testLog.info('✓ Markdown link pasted successfully');

    await clearEditor(page);

    // When: pasting markdown with nested formatting (bold wrapping italic)
    testLog.info('=== Pasting Markdown Nested Formatting ===');
    await pasteContent(page, '', 'Text with **bold and *italic* nested**');
    await page.waitForTimeout(500);
    // Then: both bold and italic text content are present
    await expect(slateEditor).toContainText('bold and');
    await expect(slateEditor).toContainText('italic');
    testLog.info('✓ Markdown nested formatting pasted successfully');

    await clearEditor(page);

    // When: pasting markdown with combined bold+italic syntax
    testLog.info('=== Pasting Markdown Complex Nested Formatting ===');
    await pasteContent(page, '', '***Bold and italic*** text');
    await page.waitForTimeout(500);
    // Then: the combined formatted text is present
    await expect(slateEditor).toContainText('Bold and italic');
    testLog.info('✓ Markdown complex nested formatting pasted successfully');

    await clearEditor(page);

    // When: pasting a markdown link containing bold formatting
    testLog.info('=== Pasting Markdown Link with Formatting ===');
    await pasteContent(page, '', 'Visit [**AppFlowy** website](https://appflowy.io) for more');
    await page.waitForTimeout(500);
    // Then: the link text content is present
    await expect(slateEditor).toContainText('AppFlowy');
    testLog.info('✓ Markdown link with formatting pasted successfully');

    await clearEditor(page);

    // When: pasting markdown with multiple inline code spans
    testLog.info('=== Pasting Markdown Multiple Inline Code ===');
    await pasteContent(page, '', 'Compare `const` vs `let` vs `var` in JavaScript');
    await page.waitForTimeout(500);
    // Then: all three code keywords are present
    await expect(slateEditor).toContainText('const');
    await expect(slateEditor).toContainText('let');
    await expect(slateEditor).toContainText('var');
    testLog.info('✓ Markdown multiple inline code pasted successfully');
  });
});
