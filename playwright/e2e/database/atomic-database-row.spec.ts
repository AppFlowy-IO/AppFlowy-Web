import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { writeFile } from 'node:fs/promises';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

const rowRoute = (url: URL) => /\/v2\/database\/[^/]+\/row\/default$/.test(url.pathname);

test.beforeEach(async ({ page }) => {
  page.on('console', async (message) => {
    if (message.type() !== 'error' || !message.text().includes('action failed')) return;
    const detail = await message
      .args()
      .at(-1)
      ?.evaluate((value) => {
        const error = value?.error ?? value;

        return {
          message: error?.message,
          diagnosticMessage: error?.diagnosticMessage,
          code: error?.code,
          stack: error?.stack,
        };
      });

    console.log('Atomic template action diagnostic', detail);
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/v2/page-view/compound/')) return;
    const value = await response.json().catch(() => ({}));

    console.log('Compound result', new URL(response.url()).pathname.split('/').at(-1), value.code, value.message);
  });
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

async function createGrid(page: Page, request: APIRequestContext) {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' && new URL(item.url()).pathname.endsWith('/v2/page-view/database/default')
  );

  await createDatabaseView(page, 'Grid', 0);
  const created = await (await response).json();

  expect(created.code).toBe(0);
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  return created.data.result.database_id as string;
}

async function readCollab(page: Page, id: string, type: number) {
  const workspaceId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('token') || '{}').access_token);
  const response = await page.request.get(`${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/${id}`, {
    params: { collab_type: type },
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json();

  expect(result.code).toBe(0);
  const doc = new Y.Doc();

  Y.applyUpdate(doc, Uint8Array.from(result.data.doc_state));
  expect(doc.store.pendingDs).toBeNull();
  expect(doc.store.pendingStructs).toBeNull();
  return doc;
}

test('new row waits for one cloud command, is durable before editing, and survives reload', async ({
  page,
  request,
}, info) => {
  const databaseId = await createGrid(page, request);
  const held = barrier();
  const entered = barrier();
  const commands: string[] = [];
  let rowId = '';
  let requestMs = 0;
  const apiRequests: string[] = [];

  page.on('request', (item) => {
    const path = new URL(item.url()).pathname;

    if (path.startsWith('/api/workspace/')) apiRequests.push(`${item.method()} ${path}`);
  });

  await page.route(rowRoute, async (route) => {
    commands.push(route.request().postData()!);
    entered.release();
    await held.promise;
    const start = Date.now();
    const response = await route.fetch();

    requestMs = Date.now() - start;
    const receipt = await response.json();

    expect(receipt.code).toBe(0);
    rowId = receipt.data.result.row_id;
    const row = await readCollab(page, rowId, 4);
    const database = await readCollab(page, databaseId, 1);

    try {
      expect((row.getMap('data').get('data') as Y.Map<unknown>).get('database_id')).toBe(databaseId);
      const views = (database.getMap('data').get('database') as Y.Map<unknown>).get('views') as Y.Map<Y.Map<unknown>>;

      views.forEach((view) =>
        expect(
          (view.get('row_orders') as Y.Array<{ id: string }>).toArray().filter((item) => item.id === rowId)
        ).toHaveLength(1)
      );
    } finally {
      row.destroy();
      database.destroy();
    }
    await route.fulfill({ response });
  });
  const footer = page.getByTestId('grid-new-row');

  try {
    await footer.click();
    await entered.promise;
    await expect(footer).toHaveAttribute('aria-busy', 'true');
    await expect(footer).toBeDisabled();
    await expect(footer.locator('.animate-spin')).toBeVisible();
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    await footer.dispatchEvent('click');
    expect(commands).toHaveLength(1);
    held.release();
    await expect(footer).toHaveAttribute('aria-busy', 'false');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
    expect(JSON.parse(commands[0])).toMatchObject({ schema_version: 'v1', cells: {}, position: { kind: 'end' } });
    expect(commands[0]).not.toMatch(/doc_state|created_by|row_orders/);
    await page.reload();
    await waitForGridReady(page);
    await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
    const evidence = info.outputPath('row-creation-performance.json');

    await writeFile(evidence, JSON.stringify({ requestMs, commands: commands.length, apiRequests }, null, 2));
    await info.attach('row-creation-performance', { path: evidence, contentType: 'application/json' });
  } finally {
    held.release();
  }
});

test('refusal and offline clicks leave no partial row; a lost reply retries the same identity once', async ({
  page,
  request,
}) => {
  await createGrid(page, request);
  const footer = page.getByTestId('grid-new-row');
  let refusals = 0;

  await page.route(rowRoute, async (route) => {
    refusals++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 1008, message: 'Permission denied' }),
    });
  });
  await footer.click();
  await expect.poll(() => refusals).toBe(1);
  await expect(footer).toHaveAttribute('aria-busy', 'false');
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  await page.context().setOffline(true);
  try {
    await footer.click();
    await expect(footer).toHaveAttribute('aria-busy', 'false');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    expect(refusals).toBe(1);
  } finally {
    await page.context().setOffline(false);
  }
  await page.unroute(rowRoute);
  const commands: string[] = [];

  await page.route(rowRoute, async (route) => {
    commands.push(route.request().postData()!);
    const response = await route.fetch();

    expect((await response.json()).code).toBe(0);
    if (commands.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await footer.click();
  await expect(footer).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[0]).toBe(commands[1]);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
  await page.reload();
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(4);
});

test('a template with an owned inline database commits its complete row graph before opening', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await createGrid(page, request);
  const { databaseBlocks, insertInlineGridViaSlash, editFirstGridCell, firstGridCellText } = await import(
    '../../support/duplicate-test-helpers'
  );
  const { RowDetailSelectors } = await import('../../support/selectors');
  const templateName = 'Atomic inline template';
  await page.getByTestId('database-template-menu-trigger').click();
  await page.getByTestId('database-template-create').click();
  const template = page.getByTestId('database-template-editor');

  await expect(template).toBeVisible();
  await template.getByTestId('row-title-input').fill(templateName);
  const editor = template.getByTestId('editor-content').first();

  await expect(editor).toBeVisible();
  const documentId = (await editor.getAttribute('id'))!.replace('editor-', '');

  await insertInlineGridViaSlash(page, documentId);
  const block = databaseBlocks(editor).first();

  await editFirstGridCell(page, block, 'Owned template value');
  await expect.poll(() => firstGridCellText(block)).toBe('Owned template value');
  // Web templates created before frozen snapshots existed have only a canonical orphan body.
  // Keep a nonempty nested template in the owned backing and exercise that upgrade during copy.
  await block.getByTestId('database-template-menu-trigger').click();
  await page.getByTestId('database-template-create').click();
  await expect(page.getByTestId('database-template-editor')).toHaveCount(2);
  const nestedTemplate = page.getByTestId('database-template-editor').last();
  await expect(nestedTemplate).toBeVisible();
  await nestedTemplate.getByTestId('row-title-input').fill('Nested legacy template');
  const nestedEditor = nestedTemplate.getByTestId('editor-content').first();
  await expect(nestedEditor).toBeVisible();
  await expect(nestedEditor).not.toHaveAttribute('id', `editor-${documentId}`);
  await nestedEditor.click();
  await expect.poll(() => nestedEditor.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.type('Nested template body is preserved');
  await expect(nestedEditor).toContainText('Nested template body is preserved');
  await page
    .locator('.MuiDialog-root')
    .last()
    .locator('.MuiDialog-container')
    .click({ force: true, position: { x: 5, y: 5 } });
  await expect(page.getByTestId('database-template-editor')).toHaveCount(1);

  await page
    .locator('.MuiDialog-root')
    .filter({ has: template })
    .locator('.MuiDialog-container')
    .click({ force: true, position: { x: 5, y: 5 } });
  await expect(template).toBeHidden();
  const finalized = page.waitForResponse(
    async (item) =>
      item.request().method() === 'POST' &&
      new URL(item.url()).pathname.endsWith('/v2/page-view/compound/finalize') &&
      (await item.json()).code === 0,
    { timeout: 30_000 }
  );

  await page.getByTestId('database-template-menu-trigger').click();
  await page.getByTestId('database-template-menu').getByText(templateName, { exact: true }).click();
  const result = await (await finalized).json();

  expect(result.code, JSON.stringify(result)).toBe(0);
  expect(result.data.result.collabs.some((item: { kind: string }) => item.kind === 'database')).toBe(true);
  const rowId = result.data.result.root_id;
  const detail = RowDetailSelectors.modal(page);

  await expect(detail).toBeVisible();
  const createdBlock = databaseBlocks(detail.getByTestId('editor-content').first()).first();

  await expect.poll(() => firstGridCellText(createdBlock), { timeout: 30_000 }).toBe('Owned template value');
  const copiedDatabase = result.data.result.collabs.find((item: { kind: string }) => item.kind === 'database');
  const canonicalCopy = await readCollab(page, copiedDatabase.object_id, 1);
  try {
    const database = canonicalCopy.getMap('data').get('database') as Y.Map<unknown>;
    const templates = JSON.parse(String((database.get('metas') as Y.Map<unknown>).get('row_templates')));
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('Nested legacy template');
    expect(templates[0].doc_data.length).toBeGreaterThan(0);
  } finally {
    canonicalCopy.destroy();
  }

  await page.keyboard.press('Escape');
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  await page.reload();
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
});

test('a self-linked template keeps one shared database and includes the committed row in its linked view', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const databaseId = await createGrid(page, request);
  const { databaseBlocks, insertLinkedGridViaSlash, editFirstGridCell, firstGridCellText, renameCurrentPage } =
    await import('../../support/duplicate-test-helpers');
  const { RowDetailSelectors } = await import('../../support/selectors');
  const sourceName = `Self-linked atomic ${Date.now()}`;
  const templateName = 'Atomic self-linked template';

  await renameCurrentPage(page, sourceName);
  await editFirstGridCell(page, page.getByTestId('database-grid'), 'Shared source value');
  await page.getByTestId('database-template-menu-trigger').click();
  await page.getByTestId('database-template-create').click();
  const template = page.getByTestId('database-template-editor');

  await expect(template).toBeVisible();
  await template.getByTestId('row-title-input').fill(templateName);
  const editor = template.getByTestId('editor-content').first();

  await expect(editor).toBeVisible();
  const documentId = (await editor.getAttribute('id'))!.replace('editor-', '');

  await insertLinkedGridViaSlash(page, documentId, sourceName);
  await expect.poll(() => firstGridCellText(databaseBlocks(editor).first())).toBe('Shared source value');
  await page
    .locator('.MuiDialog-root')
    .filter({ has: template })
    .locator('.MuiDialog-container')
    .click({ force: true, position: { x: 5, y: 5 } });
  await expect(template).toBeHidden();
  const finalized = page.waitForResponse(
    async (item) =>
      item.request().method() === 'POST' &&
      new URL(item.url()).pathname.endsWith('/v2/page-view/compound/finalize') &&
      (await item.json()).code === 0,
    { timeout: 30_000 }
  );

  await page.getByTestId('database-template-menu-trigger').click();
  await page.getByTestId('database-template-menu').getByText(templateName, { exact: true }).click();
  const result = await (await finalized).json();

  expect(result.code, JSON.stringify(result)).toBe(0);
  expect(result.data.result.collabs.filter((item: { kind: string }) => item.kind === 'database')).toHaveLength(0);
  const rowId = result.data.result.root_id;
  const detail = RowDetailSelectors.modal(page);

  await expect(detail).toBeVisible();
  const block = databaseBlocks(detail.getByTestId('editor-content').first()).first();

  await expect.poll(() => firstGridCellText(block), { timeout: 30_000 }).toBe('Shared source value');
  const database = await readCollab(page, databaseId, 1);

  try {
    const views = (database.getMap('data').get('database') as Y.Map<unknown>).get('views') as Y.Map<Y.Map<unknown>>;

    expect(views.size).toBeGreaterThan(2);
    views.forEach((view) =>
      expect(
        (view.get('row_orders') as Y.Array<{ id: string }>).toArray().filter((item) => item.id === rowId)
      ).toHaveLength(1)
    );
  } finally {
    database.destroy();
  }
  await editFirstGridCell(page, block, 'Shared after row creation');
  await page.keyboard.press('Escape');
  await expect.poll(() => firstGridCellText(page.getByTestId('database-grid'))).toBe('Shared after row creation');
  await page.reload();
  await waitForGridReady(page);
  await expect.poll(() => firstGridCellText(page.getByTestId('database-grid'))).toBe('Shared after row creation');
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
});
