import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { setupPageErrorHandling } from '../../support/test-config';

const { When, Then, Before, After } = createBdd();
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

type DatabaseRowMentionState = {
  rowPageUrl: string;
  rowId: string;
  routeViewId: string;
  databaseViewId: string;
  expectedMentionPageId: string;
  peerContext?: BrowserContext;
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
  selection?: {
    anchor: { path: number[]; offset: number };
    focus: { path: number[]; offset: number };
  } | null;
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

async function flushPendingSync(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const flush = (window as typeof window & { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> })
            .__TEST_FLUSH_ALL_SYNC__;

          return flush ? flush() : false;
        }),
      {
        message: 'the document client should flush its collaboration updates',
        timeout: 30000,
        intervals: [250, 500, 1000],
      }
    )
    .toBe(true);
}

Before({ tags: '@database-row-page-mention' }, async ({ page }) => {
  stateByPage.delete(page);
});

After({ tags: '@database-row-page-mention' }, async ({ page }) => {
  await stateByPage.get(page)?.peerContext?.close();
  stateByPage.delete(page);
});

When('I remember the current database row page link', async ({ page }) => {
  const rowPageUrl = page.url();
  const url = new URL(rowPageUrl);
  const rowId = url.searchParams.get('r');
  const routeViewId = url.pathname.split('/').filter(Boolean).at(-1);
  const databaseViewId = url.searchParams.get('v') || routeViewId;

  if (!rowId || !routeViewId || !databaseViewId) {
    throw new Error(`Expected a database row page URL, got ${rowPageUrl}`);
  }

  stateByPage.set(page, {
    rowPageUrl,
    rowId,
    routeViewId,
    databaseViewId,
    expectedMentionPageId: databaseViewId,
  });
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
  async ({ page, browser }, title: string) => {
    const state = requireState(page);
    const { routeViewId, rowId } = state;

    await flushPendingSync(page);

    const peerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: await page.context().storageState({ indexedDB: true }),
      viewport: { width: 1440, height: 900 },
    });
    const peerPage = await peerContext.newPage();

    state.peerContext = peerContext;
    state.expectedMentionPageId = routeViewId;
    setupPageErrorHandling(peerPage);

    await peerPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await expect(peerPage.locator('[data-slate-editor="true"]').first()).toBeVisible({ timeout: 30000 });
    await expect
      .poll(
        () =>
          peerPage.evaluate(() => {
            const testWindow = window as Window & { __TEST_EDITOR__?: TestSlateEditor };

            return Boolean(testWindow.__TEST_EDITOR__?.insertNode);
          }),
        { timeout: 30000 }
      )
      .toBe(true);

    await peerPage.evaluate(
      ({ routeViewId, rowId, title }) => {
        const testWindow = window as Window & {
          __TEST_EDITOR__?: TestSlateEditor;
        };
        const editor = testWindow.__TEST_EDITOR__;

        if (!editor?.insertNode) {
          throw new Error('No active test editor with insertNode() found');
        }

        const findLastTextPoint = (
          nodes: TestSlateNode[],
          parentPath: number[] = []
        ): { path: number[]; offset: number } | null => {
          for (let index = nodes.length - 1; index >= 0; index -= 1) {
            const node = nodes[index];
            const path = [...parentPath, index];

            if (typeof node.text === 'string') return { path, offset: node.text.length };

            const nested = node.children ? findLastTextPoint(node.children, path) : null;

            if (nested) return nested;
          }

          return null;
        };
        const insertAt = findLastTextPoint(editor.children);

        if (!insertAt) throw new Error('No text position found in the peer editor');

        editor.selection = { anchor: insertAt, focus: insertAt };

        // Match the current desktop producer: row references use the route view
        // as both page_id and database_view_id and include database_row_id, but
        // intentionally have no database_id.
        editor.insertNode({
          text: '$',
          mention: {
            type: 'page',
            page_id: routeViewId,
            block_id: rowId,
            row_id: rowId,
            database_view_id: routeViewId,
            database_row_id: rowId,
            data: { title },
          },
        });
      },
      { routeViewId, rowId, title }
    );

    await flushPendingSync(peerPage);
    await expect(page.locator(`.mention-inline[data-mention-id="${rowId}"] .mention-content`)).toHaveText(title, {
      timeout: 30000,
    });

    // Recreate the renderer from persisted collaboration state. This prevents
    // a locally inserted JavaScript object from masquerading as a sync test.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible({ timeout: 30000 });
  }
);

Then('the database row mention is styled and labeled {string}', async ({ page }, title: string) => {
  const { expectedMentionPageId, rowId, rowPageUrl } = requireState(page);
  const mention = page.locator(`.mention-inline[data-mention-id="${rowId}"]`);

  await expect(mention).toBeVisible({ timeout: 15000 });
  await expect(mention.locator('.mention-content')).toHaveText(title, { timeout: 15000 });
  await expect(mention.locator('.mention-icon svg')).toBeVisible();
  await expect(mention).toHaveCSS('text-decoration-line', /underline/);
  await expect(page.locator('[data-slate-editor="true"]').first()).not.toContainText(rowPageUrl);

  const slateMention = await getStoredMention(page, rowId);

  expect(slateMention).toMatchObject({
    type: 'page',
    page_id: expectedMentionPageId,
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
