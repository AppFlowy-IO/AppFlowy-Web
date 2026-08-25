import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then, Before } = createBdd();
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

type DatabaseRowMentionState = {
  rowPageUrl: string;
  rowId: string;
  databaseViewId: string;
};

type TestSlateNode = {
  children?: TestSlateNode[];
  mention?: {
    type?: string;
    page_id?: string;
    row_id?: string;
    database_id?: string;
    database_view_id?: string;
    database_row_id?: string;
  };
};

type TestSlateEditor = {
  children: TestSlateNode[];
};

const stateByPage = new WeakMap<Page, DatabaseRowMentionState>();

function requireState(page: Page): DatabaseRowMentionState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Database row mention state was not initialized');
  return state;
}

Before({ tags: '@database-row-page-mention' }, async ({ page }) => {
  stateByPage.delete(page);
});

When('I remember the current database row page link', async ({ page }) => {
  const rowPageUrl = page.url();
  const url = new URL(rowPageUrl);
  const rowId = url.searchParams.get('r');
  const databaseViewId = url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1);

  if (!rowId || !databaseViewId) throw new Error(`Expected a database row page URL, got ${rowPageUrl}`);
  stateByPage.set(page, { rowPageUrl, rowId, databaseViewId });
});

When('I paste the remembered database row page link', async ({ page }) => {
  const { rowPageUrl } = requireState(page);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (url) => navigator.clipboard.writeText(url), rowPageUrl);
  await page.keyboard.press(`${modKey}+V`);
});

Then('the Paste as menu is visible', async ({ page }) => {
  await expect(page.getByTestId('paste-as-panel')).toBeVisible({ timeout: 15000 });
});

When('I choose Mention from the Paste as menu', async ({ page }) => {
  await page.getByTestId('paste-as-mention').click({ force: true });
});

Then('the pasted database row mention is styled and labeled {string}', async ({ page }, title: string) => {
  const { databaseViewId, rowId, rowPageUrl } = requireState(page);
  const mention = page.locator(`.mention-inline[data-mention-id="${rowId}"]`);

  await expect(mention).toBeVisible({ timeout: 15000 });
  await expect(mention.locator('.mention-content')).toHaveText(title, { timeout: 15000 });
  await expect(mention.locator('.mention-icon svg')).toBeVisible();
  await expect(mention).toHaveCSS('text-decoration-line', /underline/);
  await expect(page.locator('[data-slate-editor="true"]').first()).not.toContainText(rowPageUrl);

  const slateMention = await page.evaluate((expectedRowId) => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editors = [testWindow.__TEST_EDITOR__, ...Object.values(testWindow.__TEST_EDITORS__ ?? {})].filter(
      (editor): editor is TestSlateEditor => Boolean(editor)
    );

    const findMention = (nodes: TestSlateNode[]): TestSlateNode['mention'] | null => {
      for (const node of nodes) {
        if (node.mention?.row_id === expectedRowId) return node.mention;

        const nested = node.children ? findMention(node.children) : null;

        if (nested) return nested;
      }

      return null;
    };

    for (const editor of editors) {
      const found = findMention(editor.children);

      if (found) return found;
    }

    return null;
  }, rowId);

  expect(slateMention).toMatchObject({
    type: 'page',
    page_id: databaseViewId,
    row_id: rowId,
    database_view_id: databaseViewId,
    database_row_id: rowId,
  });
  expect(slateMention?.database_id).toBeTruthy();
});
