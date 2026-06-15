import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { testLog } from '../../../support/test-helpers';

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
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting an HTML H1 heading
    {
      const html = '<h1>Main Heading</h1>';
      const plainText = 'Main Heading';

      testLog.info('=== Pasting HTML H1 ===');
      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: H1 heading is rendered
      await expect(
        slateEditor.locator('.heading.level-1').filter({ hasText: 'Main Heading' }).first()
      ).toBeVisible();
      testLog.info('✓ HTML H1 pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting an HTML H2 heading
    {
      const html = '<h2>Section Title</h2>';
      const plainText = 'Section Title';

      testLog.info('=== Pasting HTML H2 ===');
      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: H2 heading is rendered
      await expect(
        slateEditor.locator('.heading.level-2').filter({ hasText: 'Section Title' }).first()
      ).toBeVisible();
      testLog.info('✓ HTML H2 pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting multiple HTML headings (H1, H2, H3) together
    {
      const html = `
        <h1>Main Title</h1>
        <h2>Subtitle</h2>
        <h3>Section</h3>
      `;
      const plainText = 'Main Title\nSubtitle\nSection';

      testLog.info('=== Pasting HTML Multiple Headings ===');
      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: all three heading levels are rendered
      await expect(
        slateEditor.locator('.heading.level-1').filter({ hasText: 'Main Title' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.heading.level-2').filter({ hasText: 'Subtitle' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.heading.level-3').filter({ hasText: 'Section' }).first()
      ).toBeVisible();
      testLog.info('✓ HTML multiple headings pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting a markdown H1 heading
    {
      const markdown = '# Main Heading';

      testLog.info('=== Pasting Markdown H1 ===');
      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: markdown H1 is parsed and rendered as heading level 1
      await expect(
        slateEditor.locator('.heading.level-1').filter({ hasText: 'Main Heading' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown H1 pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting a markdown H2 heading
    {
      const markdown = '## Section Title';

      testLog.info('=== Pasting Markdown H2 ===');
      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: markdown H2 is parsed and rendered as heading level 2
      await expect(
        slateEditor.locator('.heading.level-2').filter({ hasText: 'Section Title' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown H2 pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting markdown headings H3 through H6
    {
      const markdown = `### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

      testLog.info('=== Pasting Markdown H3-H6 ===');
      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: all four heading levels (3-6) are rendered
      await expect(
        slateEditor.locator('.heading.level-3').filter({ hasText: 'Heading 3' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.heading.level-4').filter({ hasText: 'Heading 4' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.heading.level-5').filter({ hasText: 'Heading 5' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.heading.level-6').filter({ hasText: 'Heading 6' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown H3-H6 pasted successfully');

      await page.keyboard.press('Enter');
    }

    // When: pasting markdown headings containing inline formatting (bold, italic, code)
    {
      const markdown = `# Heading with **bold** text
## Heading with *italic* text
### Heading with \`code\``;

      testLog.info('=== Pasting Markdown Headings with Formatting ===');
      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: headings contain the formatted text content
      const h1WithBold = slateEditor.locator('.heading.level-1').filter({ hasText: 'bold' }).last();
      await expect(h1WithBold).toContainText('bold');

      const h2WithItalic = slateEditor.locator('.heading.level-2').filter({ hasText: 'italic' }).last();
      await expect(h2WithItalic).toContainText('italic');

      const h3WithCode = slateEditor.locator('.heading.level-3').filter({ hasText: 'code' }).last();
      await expect(h3WithCode).toContainText('code');
      testLog.info('✓ Markdown headings with formatting pasted successfully');
    }
  });
});
