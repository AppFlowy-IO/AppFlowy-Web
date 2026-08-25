import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then, Before } = createBdd();
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

type DatabaseRowMentionState = {
  rowPageUrl: string;
  rowId: string;
  databaseViewId: string;
};

type TestMention = {
  type?: string;
  page_id?: string;
  block_id?: string;
  row_id?: string;
  database_id?: string;
  database_view_id?: string;
  database_row_id?: string;
  data?: {
    title?: string;
  };
};

type TestSlateNode = {
  text?: string;
  children?: TestSlateNode[];
  mention?: TestMention;
};

type TestSlateEditor = {
  children: TestSlateNode[];
  insertNode?: (node: TestSlateNode) => void;
};

const stateByPage = new WeakMap<Page, DatabaseRowMentionState>();

function requireState(page: Page): DatabaseRowMentionState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Database row mention state was not initialized');
  return state;
}

async function getStoredMention(page: Page, rowId: string): Promise<TestMention | null> {
  return page.evaluate((expectedRowId) => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editors = [testWindow.__TEST_EDITOR__, ...Object.values(testWindow.__TEST_EDITORS__ ?? {})].filter(
      (editor): editor is TestSlateEditor => Boolean(editor)
    );

    const findMention = (nodes: TestSlateNode[]): TestMention | null => {
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

When(
  'the document receives a desktop-authored database row mention labeled {string}',
  async ({ page }, title: string) => {
    const { databaseViewId, rowId } = requireState(page);

    await page.evaluate(
      ({ databaseViewId, rowId, title }) => {
        const testWindow = window as Window & {
          __TEST_EDITOR__?: TestSlateEditor;
        };
        const editor = testWindow.__TEST_EDITOR__;

        if (!editor?.insertNode) {
          throw new Error('No active test editor with insertNode() found');
        }

        // This is the exact legacy desktop wire shape that exposed the bug:
        // it identifies the database view through page_id and carries the row
        // title, but it does not include database_id.
        editor.insertNode({
          text: '$',
          mention: {
            type: 'page',
            page_id: databaseViewId,
            block_id: rowId,
            row_id: rowId,
            data: { title },
          },
        });
      },
      { databaseViewId, rowId, title }
    );
  }
);

Then('the database row mention is styled and labeled {string}', async ({ page }, title: string) => {
  const { databaseViewId, rowId, rowPageUrl } = requireState(page);
  const mention = page.locator(`.mention-inline[data-mention-id="${rowId}"]`);

  await expect(mention).toBeVisible({ timeout: 15000 });
  await expect(mention.locator('.mention-content')).toHaveText(title, { timeout: 15000 });
  await expect(mention.locator('.mention-icon svg')).toBeVisible();
  await expect(mention).toHaveCSS('text-decoration-line', /underline/);
  await expect(page.locator('[data-slate-editor="true"]').first()).not.toContainText(rowPageUrl);

  const slateMention = await getStoredMention(page, rowId);

  expect(slateMention).toMatchObject({
    type: 'page',
    page_id: databaseViewId,
    row_id: rowId,
  });
  expect(slateMention?.data?.title).toBe(title);
});

Then('the database row mention is not labeled {string}', async ({ page }, parentTitle: string) => {
  const { rowId } = requireState(page);
  const mentionContent = page.locator(`.mention-inline[data-mention-id="${rowId}"] .mention-content`);

  await expect(mentionContent).not.toHaveText(parentTitle);
});

Then('the stored database row mention includes its database id', async ({ page }) => {
  const { databaseViewId, rowId } = requireState(page);
  const slateMention = await getStoredMention(page, rowId);

  expect(slateMention).toMatchObject({
    database_view_id: databaseViewId,
    database_row_id: rowId,
  });
  expect(slateMention?.database_id).toBeTruthy();
});

Then('the stored database row mention omits its database id', async ({ page }) => {
  const { rowId } = requireState(page);
  const slateMention = await getStoredMention(page, rowId);

  expect(slateMention).not.toBeNull();
  expect(slateMention?.database_id).toBeUndefined();
});
