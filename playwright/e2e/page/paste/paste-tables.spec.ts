import { test, expect, Page } from '@playwright/test';
import { EditorSelectors, DropdownSelectors, PageSelectors, SpaceSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';
import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { closeModalsIfOpen } from '../../../support/test-helpers';

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
    await createTestPage(page, request);

    const slateEditor = EditorSelectors.slateEditor(page);

    // HTML Table
    {
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

      await expect(slateEditor.locator('.simple-table table')).toBeVisible();
      expect(
        await slateEditor.locator('.simple-table tr').count()
      ).toBeGreaterThanOrEqual(3);
      await expect(slateEditor.locator('.simple-table')).toContainText('Name');
      await expect(slateEditor.locator('.simple-table')).toContainText('John');
    }

    // HTML Table with Formatting
    {
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

      await expect(slateEditor.locator('.simple-table strong')).toContainText('Authentication');
      await expect(slateEditor.locator('.simple-table em')).toContainText('Complete');
    }

    // Markdown Table
    {
      const markdownTable = `| Product | Price |
|---------|-------|
| Apple   | $1.50 |
| Banana  | $0.75 |
| Orange  | $2.00 |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      await expect(slateEditor.locator('.simple-table')).toContainText('Product');
      await expect(slateEditor.locator('.simple-table')).toContainText('Apple');
      await expect(slateEditor.locator('.simple-table')).toContainText('Banana');
    }

    // Markdown Table with Alignment
    {
      const markdownTable = `| Left Align | Center Align | Right Align |
|:-----------|:------------:|------------:|
| Left       | Center       | Right       |
| Data       | More         | Info        |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      await expect(slateEditor.locator('.simple-table')).toContainText('Left Align');
      await expect(slateEditor.locator('.simple-table')).toContainText('Center Align');
    }

    // Markdown Table with Inline Formatting
    {
      const markdownTable = `| Feature | Status |
|---------|--------|
| **Bold Feature** | *In Progress* |
| \`Code Feature\` | ~~Deprecated~~ |`;

      await pasteContent(page, '', markdownTable);
      await page.waitForTimeout(1500);

      await expect(slateEditor.locator('.simple-table strong')).toContainText('Bold Feature');
      await expect(slateEditor.locator('.simple-table em')).toContainText('In Progress');
    }

    // TSV Data
    {
      const tsvData = `Name\tEmail\tPhone
Alice\talice@example.com\t555-1234
Bob\tbob@example.com\t555-5678`;

      await pasteContent(page, '', tsvData);
      await page.waitForTimeout(1500);

      await expect(slateEditor.locator('.simple-table')).toBeVisible();
      await expect(slateEditor.locator('.simple-table')).toContainText('Alice');
      await expect(slateEditor.locator('.simple-table')).toContainText('alice@example.com');
    }
  });
});
