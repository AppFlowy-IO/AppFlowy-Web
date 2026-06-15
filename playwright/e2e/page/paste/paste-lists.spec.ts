import { test, expect, Page } from '@playwright/test';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { testLog } from '../../../support/test-helpers';

/**
 * Paste List Tests
 * Migrated from: cypress/e2e/page/paste/paste-lists.cy.ts
 *
 * Tests pasting of various list formats: unordered, ordered, todo/task lists,
 * nested lists, lists with formatting, and special bullet characters.
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
 * Exit list mode by pressing Enter twice.
 */
async function exitListMode(page: Page) {
  const editors = EditorSelectors.slateEditor(page);
  await editors.last().click({ force: true });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
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

test.describe('Paste List Tests', () => {
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

  test('should paste all list formats correctly', async ({ page, request }) => {
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    // When: pasting an HTML unordered list
    {
      testLog.info('=== Pasting HTML Unordered List ===');
      const html = `
        <ul>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ul>
      `;
      const plainText = 'First item\nSecond item\nThird item';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: three bulleted list items are created
      expect(
        await BlockSelectors.blockByType(page, 'bulleted_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('First item').first()).toBeVisible();
      await expect(page.getByText('Second item').first()).toBeVisible();
      await expect(page.getByText('Third item').first()).toBeVisible();
      testLog.info('✓ HTML unordered list pasted successfully');

      await exitListMode(page);
    }

    // When: pasting an HTML ordered list
    {
      testLog.info('=== Pasting HTML Ordered List ===');
      const html = `
        <ol>
          <li>Step one</li>
          <li>Step two</li>
          <li>Step three</li>
        </ol>
      `;
      const plainText = 'Step one\nStep two\nStep three';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: three numbered list items are created
      expect(
        await BlockSelectors.blockByType(page, 'numbered_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('Step one')).toBeVisible();
      await expect(page.getByText('Step two')).toBeVisible();
      await expect(page.getByText('Step three')).toBeVisible();
      testLog.info('✓ HTML ordered list pasted successfully');

      await exitListMode(page);
    }

    // When: pasting an HTML todo list with checkboxes
    {
      testLog.info('=== Pasting HTML Todo List ===');
      const html = `
        <ul>
          <li><input type="checkbox" checked> Completed task</li>
          <li><input type="checkbox"> Incomplete task</li>
        </ul>
      `;
      const plainText = 'Completed task\nIncomplete task';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: todo list items are created from checkbox inputs
      expect(
        await BlockSelectors.blockByType(page, 'todo_list').count()
      ).toBeGreaterThanOrEqual(2);
      await expect(page.getByText('Completed task').first()).toBeVisible();
      await expect(page.getByText('Incomplete task').first()).toBeVisible();
      testLog.info('✓ HTML todo list pasted successfully');

      await exitListMode(page);
    }

    // When: pasting a markdown unordered list using dashes
    {
      testLog.info('=== Pasting Markdown Unordered List (dash) ===');
      const markdown = `- First item
- Second item
- Third item`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: dash-prefixed items become bulleted list blocks
      expect(
        await BlockSelectors.blockByType(page, 'bulleted_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('First item').first()).toBeVisible();
      testLog.info('✓ Markdown unordered list (dash) pasted successfully');

      await exitListMode(page);
    }

    // When: pasting a markdown unordered list using asterisks
    {
      testLog.info('=== Pasting Markdown Unordered List (asterisk) ===');
      const markdown = `* Apple
* Banana
* Orange`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: asterisk-prefixed items become bulleted list blocks
      expect(
        await BlockSelectors.blockByType(page, 'bulleted_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('Apple')).toBeVisible();
      testLog.info('✓ Markdown unordered list (asterisk) pasted successfully');

      await exitListMode(page);
    }

    // When: pasting a markdown ordered list
    {
      testLog.info('=== Pasting Markdown Ordered List ===');
      const markdown = `1. First step
2. Second step
3. Third step`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: numbered items become numbered list blocks
      expect(
        await BlockSelectors.blockByType(page, 'numbered_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('First step')).toBeVisible();
      testLog.info('✓ Markdown ordered list pasted successfully');

      await exitListMode(page);
    }

    // When: pasting a markdown task list with checked and unchecked items
    {
      testLog.info('=== Pasting Markdown Task List ===');
      const markdown = `- [x] Completed task
- [ ] Incomplete task
- [x] Another completed task`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: task list items become todo list blocks
      expect(
        await BlockSelectors.blockByType(page, 'todo_list').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('Completed task').first()).toBeVisible();
      await expect(page.getByText('Incomplete task').first()).toBeVisible();
      testLog.info('✓ Markdown task list pasted successfully');

      await exitListMode(page);
    }

    // When: pasting markdown nested lists with parent and child items
    {
      testLog.info('=== Pasting Markdown Nested Lists ===');
      const markdown = `- Parent item 1
  - Child item 1.1
  - Child item 1.2
- Parent item 2
  - Child item 2.1`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: parent and child items are rendered as bulleted list blocks
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Parent item 1' }).first()
      ).toBeVisible();
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Child item 1.1' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown nested lists pasted successfully');

      await exitListMode(page);
    }

    // When: pasting a markdown list with inline formatting (bold, italic, code, link)
    {
      testLog.info('=== Pasting Markdown List with Formatting ===');
      const markdown = `- **Bold item**
- *Italic item*
- \`Code item\`
- [Link item](https://example.com)`;

      await pasteContent(page, '', markdown);
      await page.waitForTimeout(1000);

      // Then: list items with formatted text are visible
      await expect(page.getByText('Bold item')).toBeVisible();
      await expect(page.getByText('Italic item')).toBeVisible();
      await expect(page.getByText('Code item')).toBeVisible();
      testLog.info('✓ Markdown list with formatting pasted successfully');

      await exitListMode(page);
    }

    // When: pasting plain text with unicode bullet characters
    {
      testLog.info('=== Pasting Generic Text with Special Bullets ===');
      const text = `Project Launch

We are excited to announce the new features. This update includes:
\t\u2022\tFast performance
\t\u2022\tSecure encryption
\t\u2022\tOffline mode

Please let us know your feedback.`;

      await pasteContent(page, '', text);
      await page.waitForTimeout(1000);

      // Then: paragraph text is visible
      await expect(page.getByText('Project Launch')).toBeVisible();
      await expect(page.getByText('We are excited to announce')).toBeVisible();

      // And: unicode bullet items are converted to bulleted list blocks
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Fast performance' }).first()
      ).toBeVisible();
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Secure encryption' }).first()
      ).toBeVisible();
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Offline mode' }).first()
      ).toBeVisible();
      testLog.info('✓ Generic text with special bullets pasted successfully');

      await exitListMode(page);
    }

    // When: pasting an HTML list where items contain inner paragraph elements
    {
      testLog.info('=== Pasting HTML List with Inner Newlines ===');
      const html = `
        <ul><li>
        <p class="p1">Private</p>
        </li><li>
        <p class="p1">Customizable</p>
        </li><li>
        <p class="p1">Self-hostable</p>
        </li></ul>
      `;
      const plainText = 'Private\nCustomizable\nSelf-hostable';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1000);

      // Then: each list item is rendered as a separate bulleted list block
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Private' })
      ).toBeVisible();
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Customizable' })
      ).toBeVisible();
      await expect(
        BlockSelectors.blockByType(page, 'bulleted_list').filter({ hasText: 'Self-hostable' })
      ).toBeVisible();
      testLog.info('✓ HTML list with inner newlines pasted successfully');
    }
  });
});
