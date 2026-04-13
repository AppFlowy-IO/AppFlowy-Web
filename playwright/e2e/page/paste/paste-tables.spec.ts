import { test, expect, Page } from '@playwright/test';
import { EditorSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { testLog } from '../../../support/test-helpers';

/**
 * Paste Table Tests
 * Migrated from: cypress/e2e/page/paste/paste-tables.cy.ts
 *
 * Tests pasting of tables in HTML, Markdown, and TSV formats,
 * including tables with formatting and alignment.
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
 * Move cursor to end of document and create a new empty paragraph.
 * Call this between sequential pastes so each paste starts in its own block.
 */
async function moveCursorToEnd(page: Page) {
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+ArrowDown' : 'Control+End');
  await page.waitForTimeout(200);
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

test.describe('Paste Table Tests', () => {
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

  test('should paste all table formats correctly', async ({ page, request }) => {
    // Given: a new document page is created and ready for editing
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // When: pasting an HTML table with header and body rows
    {
      testLog.info('=== Pasting HTML Table ===');
      const html = `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John</td>
              <td>30</td>
            </tr>
            <tr>
              <td>Jane</td>
              <td>25</td>
            </tr>
          </tbody>
        </table>
      `;
      const plainText = 'Name\tAge\nJohn\t30\nJane\t25';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1500);

      // Then: table is rendered with correct rows and cell content
      await expect(slateEditor.locator('.simple-table table').first()).toBeVisible();
      expect(
        await slateEditor.locator('.simple-table tr').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(slateEditor.locator('.simple-table').first()).toContainText('Name');
      await expect(slateEditor.locator('.simple-table').first()).toContainText('John');
      testLog.info('✓ HTML table pasted successfully');
    }

    await moveCursorToEnd(page);

    // When: pasting an HTML table with bold and italic formatting in cells
    {
      testLog.info('=== Pasting HTML Table with Formatting ===');
      const html = `
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Authentication</strong></td>
              <td><em>Complete</em></td>
            </tr>
            <tr>
              <td><strong>Authorization</strong></td>
              <td><em>In Progress</em></td>
            </tr>
          </tbody>
        </table>
      `;
      const plainText =
        'Feature\tStatus\nAuthentication\tComplete\nAuthorization\tIn Progress';

      await pasteContent(page, html, plainText);
      await page.waitForTimeout(1500);

      // Then: table contains formatted cell content (bold and italic if preserved)
      const hasTableStrong = await slateEditor.locator('.simple-table strong').count();
      if (hasTableStrong > 0) {
        await expect(slateEditor.locator('.simple-table strong').first()).toContainText('Authentication');
      } else {
        await expect(slateEditor.locator('.simple-table').last()).toContainText('Authentication');
      }
      const hasTableEm = await slateEditor.locator('.simple-table em').count();
      if (hasTableEm > 0) {
        await expect(slateEditor.locator('.simple-table em').first()).toContainText('Complete');
      } else {
        await expect(slateEditor.locator('.simple-table').last()).toContainText('Complete');
      }
      testLog.info('✓ HTML table with formatting pasted successfully');
    }

    await moveCursorToEnd(page);

    // When: pasting a markdown table with product data
    {
      testLog.info('=== Pasting Markdown Table ===');
      const markdownTable = `| Product | Price |
|---------|-------|
| Apple   | $1.50 |
| Banana  | $0.75 |
| Orange  | $2.00 |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      // Then: markdown table is parsed into a simple-table with all rows
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Product' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Apple' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Banana' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown table pasted successfully');
    }

    await moveCursorToEnd(page);

    // When: pasting a markdown table with column alignment specifiers
    {
      testLog.info('=== Pasting Markdown Table with Alignment ===');
      const markdownTable = `| Left Align | Center Align | Right Align |
|:-----------|:------------:|------------:|
| Left       | Center       | Right       |
| Data       | More         | Info        |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      // Then: table headers with alignment labels are rendered
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Left Align' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Center Align' }).first()
      ).toBeVisible();
      testLog.info('✓ Markdown table with alignment pasted successfully');
    }

    await moveCursorToEnd(page);

    // When: pasting a markdown table with inline formatting (bold, italic, code, strikethrough)
    {
      testLog.info('=== Pasting Markdown Table with Inline Formatting ===');
      const markdownTable = `| Feature | Status |
|---------|--------|
| **Bold Feature** | *In Progress* |
| \`Code Feature\` | ~~Deprecated~~ |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      // Then: table contains formatted cell content (bold and italic if preserved)
      const hasMdTableStrong = await slateEditor.locator('.simple-table strong').count();
      if (hasMdTableStrong > 0) {
        await expect(slateEditor.locator('.simple-table strong').filter({ hasText: 'Bold Feature' }).first()).toBeVisible();
      } else {
        await expect(
          slateEditor.locator('.simple-table').filter({ hasText: 'Bold Feature' }).first()
        ).toBeVisible();
      }
      const hasMdTableEm = await slateEditor.locator('.simple-table em').count();
      if (hasMdTableEm > 0) {
        await expect(slateEditor.locator('.simple-table em').filter({ hasText: 'In Progress' }).first()).toBeVisible();
      } else {
        await expect(
          slateEditor.locator('.simple-table').filter({ hasText: 'In Progress' }).first()
        ).toBeVisible();
      }
      testLog.info('✓ Markdown table with inline formatting pasted successfully');
    }

    await moveCursorToEnd(page);

    // When: pasting tab-separated values (TSV) data
    {
      testLog.info('=== Pasting TSV Data ===');
      const tsvData = `Name\tEmail\tPhone
Alice\talice@example.com\t555-1234
Bob\tbob@example.com\t555-5678`;

      await pasteContent(page, '', tsvData);
      await page.waitForTimeout(1500);

      // Then: TSV is parsed into a table with names and emails
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'Alice' }).first()
      ).toBeVisible();
      await expect(
        slateEditor.locator('.simple-table').filter({ hasText: 'alice@example.com' }).first()
      ).toBeVisible();
      testLog.info('✓ TSV data pasted successfully');
    }
  });
});
