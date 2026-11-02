import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { HeaderSelectors, ModalSelectors, ViewActionSelectors } from '../../support/selectors';

const { When, Then, After } = createBdd();

type HtmlImport = {
  workspaceId: string;
  parentId: string;
  taskRequests: string[];
  name: string;
  startedAt: number;
  viewId?: string;
};
const imports = new WeakMap<Page, HtmlImport>();
const ARTICLE_TITLE = 'Saved article: an HTML import should finish';
const ARTICLE_END = 'Article ending: this sentence must survive import and reload exactly once.';

function imported(page: Page): HtmlImport {
  const state = imports.get(page);

  if (!state) throw new Error('Import the saved HTML fixture before checking its result');
  return state;
}

When('I import the saved HTML web page through the import dialog', async ({ page, $testInfo }) => {
  if (process.env.DOCUMENT_IMPORT_WORKSPACE_ID) {
    await page.goto(`/app/${process.env.DOCUMENT_IMPORT_WORKSPACE_ID}`);
  }

  const space = page.getByTestId('space-item').first();
  const spaceRow = space.locator('[data-testid^="space-"][data-expanded]').last();

  await spaceRow.hover();
  await spaceRow.getByTestId('inline-add-page').click();
  await page.getByTestId('add-import-button').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();

  const fixtureDir = path.resolve('playwright/fixtures/document-import');
  const [source, image] = await Promise.all([
    readFile(path.join(fixtureDir, 'saved_web_page.html'), 'utf8'),
    readFile(path.join(fixtureDir, 'feature_matrix.png')),
  ]);
  // Saved news pages often contain hundreds of KB of analytics scripts. Use synthetic data,
  // preserving that input shape without committing a publisher's article or tracking identifiers.
  const html = source
    .replace('__SAVED_SCRIPT_PAYLOAD__', 'saved-analytics-data;'.repeat(13000))
    .replace('__EMBEDDED_IMAGE__', `data:image/png;base64,${image.toString('base64')}`);
  const name = `BDD saved HTML ${Date.now()}`;
  const startedAt = Date.now();
  const parentId = (await spaceRow.getAttribute('data-testid'))?.slice(6);

  expect(parentId).toBeTruthy();
  const state: HtmlImport = {
    workspaceId: new URL(page.url()).pathname.split('/')[2],
    parentId: parentId!,
    taskRequests: [],
    name,
    startedAt,
  };

  imports.set(page, state);
  page.on('request', (request) => {
    if (/\/api\/import\/[^/]+\/document(?:\/|$)/.test(new URL(request.url()).pathname)) {
      state.taskRequests.push(request.url());
    }
  });

  await page.getByTestId('import-html-input').setInputFiles({
    name: `${name}.html`,
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  await $testInfo.attach('html-import-input', {
    body: JSON.stringify({ bytes: Buffer.byteLength(html), ...imported(page) }),
    contentType: 'application/json',
  });
});

Then('the HTML import completes and opens its page', async ({ page, $testInfo }) => {
  const state = imported(page);

  await expect(page.getByTestId('import-dialog')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByTestId('page-title-input')).toHaveText(state.name);
  state.viewId = new URL(page.url()).pathname.split('/')[3];

  expect(state.viewId).toBeTruthy();
  expect(state.taskRequests, 'HTML should save directly without the asynchronous import worker').toEqual([]);

  await $testInfo.attach('html-import-result', {
    body: JSON.stringify({ ...state, elapsedMs: Date.now() - state.startedAt }),
    contentType: 'application/json',
  });
  await expect(page).toHaveURL(new RegExp(`/${state.viewId}(?:[?#]|$)`));
});

Then('the saved HTML article is rendered without executing its scripts', async ({ page, $testInfo }) => {
  const editor = page.locator('[data-slate-editor="true"]').last();

  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-block-type="heading"]').filter({ hasText: ARTICLE_TITLE })).toHaveCount(1);
  for (const text of [
    'Article opening: Chinese technology companies and research teams.',
    '中文 — café.',
    ARTICLE_END,
  ]) {
    await expect(editor).toContainText(text);
  }

  expect((await editor.innerText()).split(ARTICLE_END).length - 1).toBe(1);
  await expect(editor.locator('strong').filter({ hasText: 'bold emphasis' })).toHaveCount(1);
  await expect(editor.locator('em').filter({ hasText: 'italic emphasis' })).toHaveCount(1);
  await expect(editor).not.toContainText('saved-analytics-data');
  expect(
    await page.evaluate(
      () => (window as Window & { __savedHtmlImportScriptExecuted?: boolean }).__savedHtmlImportScriptExecuted
    )
  ).toBeUndefined();
  const image = editor.locator('[data-block-type="image"] img');

  await expect(image).toHaveCount(1);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
    .toEqual([960, 240]);
  await $testInfo.attach('saved-html-article', { body: await editor.screenshot(), contentType: 'image/png' });
});

When('I reload and reopen the HTML import from the sidebar', async ({ page }) => {
  const state = imported(page);

  await page.goto(`/app/${state.workspaceId}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const space = page.getByTestId(`space-${state.parentId}`);

  await expect(space).toBeVisible();
  if ((await space.getAttribute('data-expanded')) !== 'true') await space.click();
  const entry = page.getByTestId(`page-${state.viewId}`);

  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/${state.viewId}(?:[?#]|$)`));
});

After({ tags: '@html-document-import' }, async ({ page }) => {
  const state = imports.get(page);

  if (!state) return;
  if (!state.viewId) {
    // Stop any remaining files if a regression leaves the import dialog open.
    const cancel = page.getByTestId('import-dialog').getByRole('button', { name: 'Cancel import', exact: true });

    if (await cancel.isVisible()) await cancel.click();
    return;
  }

  if (process.env.DOCUMENT_IMPORT_KEEP_PAGES === '1') return;
  await page.goto(`/app/${state.workspaceId}/${state.viewId}`, { waitUntil: 'domcontentloaded' });
  await HeaderSelectors.moreActionsButton(page).click();
  await ViewActionSelectors.deleteButton(page).click();
  const confirmation = ModalSelectors.confirmDeleteButton(page);

  if (await confirmation.isVisible()) await confirmation.click();
  await expect(page.getByTestId(`page-${state.viewId}`)).toHaveCount(0);
});
