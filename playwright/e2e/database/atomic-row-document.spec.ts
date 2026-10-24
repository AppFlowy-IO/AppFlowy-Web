import { createRequire } from 'node:module';

import { expect, test, type Page } from '@playwright/test';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { waitForRowBodyCompletion } from '../../support/atomic-creation-helpers';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { waitForDocumentTextOnServer } from '../../support/duplicate-test-helpers';
import { closeRowDetailWithEscape, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';
import { setViewOpenPagesIn } from '../../support/yjs-inject-helpers';

import type { collab } from '../../../src/proto/messages';

const rowDocumentRoute = '**/v2/page-view/row-document{,?**}';
const editorForRow = (page: Page) => RowDetailSelectors.modal(page).getByTestId('editor-content').first();
const rowIcon = (page: Page, rowId: string) =>
  DatabaseGridSelectors.rowById(page, rowId).getByTestId(`row-document-icon-${rowId}`);

async function createGrid(page: Page, request: Parameters<typeof signInAndWaitForApp>[1]): Promise<string> {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  return (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace('grid-row-', '');
}

/** Read the durable collab independently of the browser's editor and Row cache. */
async function readCollab(page: Page, objectId: string, collabType: number): Promise<Y.Doc> {
  const workspaceId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('token') || '{}').access_token);
  const response = await page.request.get(`${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/${objectId}`, {
    params: { collab_type: collabType },
    headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
  });
  const body = await response.json();

  expect(response.ok(), JSON.stringify(body)).toBe(true);
  expect(body.code, JSON.stringify(body)).toBe(0);
  const doc = new Y.Doc();

  Y.applyUpdate(doc, new Uint8Array(body.data.doc_state));
  return doc;
}

async function readRowEmptyFlag(page: Page, rowId: string): Promise<unknown> {
  const doc = await readCollab(page, rowId, 4);

  try {
    // Rust RowMeta defaults an absent flag to true for newly initialized rows.
    return (doc.getMap('data').get('meta') as Y.Map<unknown>).get(uuidv5('is_document_empty', rowId)) ?? true;
  } finally {
    doc.destroy();
  }
}

async function readDocumentText(page: Page, documentId: string): Promise<string> {
  const doc = await readCollab(page, documentId, 0);

  try {
    const document = doc.getMap('data').get('document') as Y.Map<unknown>;
    const meta = document.get('meta') as Y.Map<unknown>;
    const texts = meta.get('text_map') as Y.Map<Y.Text>;

    return [...texts.values()]
      .map((text) => text.toString())
      .join('\n')
      .trim();
  } finally {
    doc.destroy();
  }
}

function collectCreationCommands(page: Page): string[] {
  const commands: string[] = [];

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/v2/page-view/row-document')) {
      commands.push(request.postData()!);
    }
  });
  return commands;
}

function collectCreationReplyCodes(page: Page): Promise<number>[] {
  const replyCodes: Promise<number>[] = [];

  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/v2/page-view/row-document')
    ) {
      replyCodes.push(response.json().then((body) => body.code));
    }
  });
  return replyCodes;
}

function expectDefaultSchema(command: string) {
  expect(JSON.parse(command).contribution).toEqual({ kind: 'default_schema', schema_version: 'v1' });
}

test('side peek opens its row while the database bulk preload is still pending', async ({ page, request }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let bulkRequests = 0;

  await page.route('**/database/*/blob/diff{,?**}', async (route) => {
    bulkRequests++;
    await held;
    await route.continue();
  });
  try {
    await signInAndWaitForApp(page, request, `row_peek_priority_${generateRandomEmail()}`, 0);
    await createDatabaseView(page, 'Grid', 0);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    const rowId = (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace(
      'grid-row-',
      ''
    );

    await expect.poll(() => bulkRequests).toBeGreaterThan(0);
    await setViewOpenPagesIn(page, 'side_peek');
    await openRowDetailByRowId(page, rowId);
    await expect(RowDetailSelectors.modal(page)).toHaveAttribute('data-peek-mode', 'side');
    const editor = editorForRow(page);

    // The clicked row must acquire its own current state. Releasing the bulk
    // response first would hide the five-second Pending retry regression.
    await expect(editor).toBeVisible();
    const text = 'The opened row is ready before background preload.';

    await editor.fill(text);
    await expect(editor).toContainText(text);
    await closeRowDetailWithEscape(page);
    await expect(rowIcon(page, rowId)).toBeVisible();
    release();
    await openRowDetailByRowId(page, rowId);
    await expect(editor).toContainText(text);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('token') || '{}').access_token);

    if (token) {
      const response = await request.delete(`${TestConfig.apiUrl}/api/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.ok(), 'remove the disposable side-peek test account').toBe(true);
    }
  }
});

test('opening an untouched row waits for the server document; body content alone controls its icon', async ({
  page,
  request,
}) => {
  const rowId = await createGrid(page, request);
  const commands = collectCreationCommands(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let documentId = '';

  await page.route(
    rowDocumentRoute,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      expect(body.code, JSON.stringify(body)).toBe(0);
      documentId = body.data.result.document_id;
      await held;
      await route.fulfill({ response });
    },
    { times: 1 }
  );
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  await openRowDetailByRowId(page, rowId);
  try {
    await expect(page.getByTestId('row-document-loading')).toBeVisible();
    await expect(editorForRow(page)).toHaveCount(0);
    await expect.poll(() => documentId).not.toBe('');
    expect(commands).toHaveLength(1);
    expectDefaultSchema(commands[0]);
    expect(await readDocumentText(page, documentId)).toBe('');
    expect(await readRowEmptyFlag(page, rowId)).toBe(true);
  } finally {
    release();
  }

  const editor = editorForRow(page);

  await expect(editor).toBeVisible();
  await expect(page.getByTestId('row-document-loading')).toHaveCount(0);
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  await RowDetailSelectors.titleInput(page).fill('Title does not count as body content');
  const checkbox = RowDetailSelectors.modal(page).locator('[data-testid^="checkbox-cell-"]').first();
  const initiallyChecked = await checkbox.getByTestId('checkbox-checked-icon').count();

  await checkbox.click();
  await expect(checkbox.getByTestId('checkbox-checked-icon')).toHaveCount(initiallyChecked ? 0 : 1);
  await closeRowDetailWithEscape(page);
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  expect(await readRowEmptyFlag(page, rowId)).toBe(true);
  await openRowDetailByRowId(page, rowId);
  await expect(editor).toBeVisible();
  expect(commands).toHaveLength(1);

  const text = 'Typing after creation stays focused and updates the content icon.';

  await editor.click();
  await page.keyboard.type(text, { delay: 25 });
  await expect(editor).toContainText(text);
  await expect(editor).toBeFocused();
  await waitForDocumentTextOnServer(page, TestConfig.apiUrl, documentId, text);
  await expect.poll(() => readRowEmptyFlag(page, rowId)).toBe(false);
  await closeRowDetailWithEscape(page);
  await expect(rowIcon(page, rowId)).toBeVisible();

  await openRowDetailByRowId(page, rowId);
  await expect(editor).toContainText(text);
  // Use real editor keyboard actions so Slate owns the selection and deletion.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(editor).not.toContainText(text);
  await expect.poll(() => readDocumentText(page, documentId)).toBe('');
  await expect.poll(() => readRowEmptyFlag(page, rowId)).toBe(true);
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor).toContainText(text);
  await expect.poll(() => readRowEmptyFlag(page, rowId)).toBe(false);
  await expect(rowIcon(page, rowId)).toBeVisible();
  await expect(editor).toBeFocused();
  // Slate chooses its redo variant from the browser user agent. The emulated
  // Desktop Chrome agent can differ from the host used by ControlOrMeta.
  const redoShortcut = await page.evaluate(() => (/Mac OS X/.test(navigator.userAgent) ? 'Meta+Shift+z' : 'Control+y'));

  await page.keyboard.press(redoShortcut);
  await expect(editor).not.toContainText(text);
  await expect.poll(() => readDocumentText(page, documentId)).toBe('');
  await expect.poll(() => readRowEmptyFlag(page, rowId)).toBe(true);
  await closeRowDetailWithEscape(page);
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  const rowBodyReads: string[] = [];

  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/${documentId}`)) {
      rowBodyReads.push(request.url());
    }
  });
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  expect(rowBodyReads, 'opening a database must use Row metadata, without fetching row bodies for icons').toHaveLength(
    0
  );
  await openRowDetailByRowId(page, rowId);
  await expect(editor).toBeVisible();
  await expect(editor).not.toContainText(text);
  expect(commands).toHaveLength(1);
});

test('a fresh atomic row opens its page without a preliminary Row full-sync', async ({ page, request }) => {
  await createGrid(page, request);
  const before = new Set(await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-testid'))
  ));

  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(before.size + 1);
  const created = (await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-testid'))
  )).find((id) => !before.has(id));
  const rowId = created!.replace('grid-row-', '');
  const commands = collectCreationCommands(page);
  const replyCodes = collectCreationReplyCodes(page);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { loadSync } = createRequire(import.meta.url)('protobufjs') as typeof import('protobufjs');
  const protocol = loadSync(new URL('../../../src/proto/collab.proto', import.meta.url).pathname);
  const requestType = protocol.lookupType('collab.CollabBatchSyncRequest');
  let rowSyncRequests = 0;
  let documentId = '';

  await page.route('**/collab/full-sync/batch{,?**}', async (route) => {
    const body = route.request().postDataBuffer();
    const batch = body ? requestType.decode(body) as unknown as collab.CollabBatchSyncRequest : undefined;

    if (batch?.items.some((item) => item.objectId === rowId)) {
      rowSyncRequests++;
      // Atomic row creation already committed the source. Opening its page must
      // succeed even if a redundant preliminary Row upload cannot complete.
      await route.abort('failed');
      return;
    }

    await route.continue();
  });
  await page.route(rowDocumentRoute, async (route) => {
    const response = await route.fetch();
    const body = await response.json();

    if (body.code === -5) {
      await route.fulfill({ response });
      return;
    }

    expect(body.code, JSON.stringify(body)).toBe(0);
    documentId = body.data.result.document_id;
    await held;
    await route.fulfill({ response });
  });
  try {
    await openRowDetailByRowId(page, rowId);
    await expect.poll(() => documentId).not.toBe('');
    expect(rowSyncRequests).toBe(0);
    await expect(page.getByTestId('row-document-loading')).toBeVisible();
    await expect(editorForRow(page)).toHaveCount(0);
    expect(await readDocumentText(page, documentId)).toBe('');
    const completion = waitForRowBodyCompletion(page);

    release();
    await completion;
    await expect(editorForRow(page)).toBeVisible();
    await expect(rowIcon(page, rowId)).toHaveCount(0);
    expect(rowSyncRequests).toBe(0);
    // Legacy source settlement may still ask the atomic API to retry.
    // Require one journaled command and only explicit retry-later replies before success.
    expect(new Set(commands).size).toBe(1);
    expect(await Promise.all(replyCodes)).toEqual([...Array(commands.length - 1).fill(-5), 0]);
    commands.forEach(expectDefaultSchema);
    expect(await readRowEmptyFlag(page, rowId)).toBe(true);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('new ordinary rows can open an atomic empty page immediately after normal source synchronization', async ({
  page,
  request,
}) => {
  await createGrid(page, request);
  const commands = collectCreationCommands(page);

  for (let index = 0; index < 3; index += 1) {
    const before = new Set(
      await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-testid'))
      )
    );

    await DatabaseGridSelectors.newRowButton(page).click();
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(before.size + 1);
    const created = (
      await DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-testid'))
      )
    ).find((id) => !before.has(id));
    const rowId = created!.replace('grid-row-', '');
    const completion = waitForRowBodyCompletion(page);

    await openRowDetailByRowId(page, rowId);
    await completion;
    const editor = editorForRow(page);
    const text = `Body for newly synchronized row ${index}`;

    await expect(editor).toBeVisible();
    await expect(rowIcon(page, rowId)).toHaveCount(0);
    await editor.fill(text);
    await closeRowDetailWithEscape(page);
    await expect(rowIcon(page, rowId)).toBeVisible();
    await openRowDetailByRowId(page, rowId);
    await expect(editor).toContainText(text);
    await closeRowDetailWithEscape(page);
  }

  commands.forEach(expectDefaultSchema);
});

test('a new row page opened offline shows an inline error without an editor and opens only after reconnect', async ({
  page,
  request,
}) => {
  const rowId = await createGrid(page, request);
  const commands = collectCreationCommands(page);
  const replyCodes = collectCreationReplyCodes(page);

  await page.context().setOffline(true);
  try {
    await openRowDetailByRowId(page, rowId);
    const error = page.getByTestId('row-document-load-error');

    await expect(error).toBeVisible();
    await expect(error).toContainText('Connect to the internet');
    await expect(editorForRow(page)).toHaveCount(0);
    await expect(rowIcon(page, rowId)).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await error.getByRole('button', { name: /retry/i }).click();
    await expect(error).toBeVisible();
    await expect(editorForRow(page)).toHaveCount(0);
    expect(commands).toHaveLength(0);
    // Close before reconnect so the next explicit open owns the new attempt;
    // app-level reconnect may otherwise remount and resume this same open intent.
    await closeRowDetailWithEscape(page);
  } finally {
    await page.context().setOffline(false);
  }

  // Exercise source-settlement retry without depending on backend timing.
  await page.route(
    rowDocumentRoute,
    (route) => route.fulfill({ status: 200, json: { code: -5, message: 'Row source is not ready' } }),
    { times: 1 }
  );
  const completion = waitForRowBodyCompletion(page);

  await openRowDetailByRowId(page, rowId);
  await completion;
  const editor = editorForRow(page);

  await expect(editor).toBeVisible();
  await expect(page.getByTestId('row-document-load-error')).toHaveCount(0);
  await editor.fill('Created only after reconnect');
  await closeRowDetailWithEscape(page);
  await expect(rowIcon(page, rowId)).toBeVisible();
  await openRowDetailByRowId(page, rowId);
  await expect(editor).toContainText('Created only after reconnect');
  // Reconnecting may reach the atomic API before its source is ready. A
  // RetryLater response must replay the same command, not create a new intent.
  expect(commands.length).toBeGreaterThanOrEqual(2);
  expect(new Set(commands).size).toBe(1);
  expect(await Promise.all(replyCodes)).toEqual([...Array(commands.length - 1).fill(-5), 0]);
  commands.forEach(expectDefaultSchema);
});

test('lost creation acknowledgement retries the identical command before enabling editing', async ({
  page,
  request,
}) => {
  const rowId = await createGrid(page, request);
  const commands = collectCreationCommands(page);

  await page.route(
    rowDocumentRoute,
    async (route) => {
      const response = await route.fetch();

      expect((await response.json()).code).toBe(0);
      await route.abort('failed');
    },
    { times: 1 }
  );
  await openRowDetailByRowId(page, rowId);
  const error = page.getByTestId('row-document-load-error');

  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(editorForRow(page)).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expectDefaultSchema(commands[0]);
  const replay = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/row-document')
  );

  await error.getByRole('button', { name: /retry/i }).click();
  expect((await (await replay).json()).data.outcome).toBe('already_applied');
  await expect(error).toHaveCount(0);
  await expect(editorForRow(page)).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  await editorForRow(page).fill('Recovered canonical document');
  await closeRowDetailWithEscape(page);
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  await openRowDetailByRowId(page, rowId);
  await expect(editorForRow(page)).toContainText('Recovered canonical document');
  expect(commands).toHaveLength(2);
});

test('reload after a lost creation acknowledgement recovers the saved command without an editable placeholder', async ({
  page,
  request,
}) => {
  const rowId = await createGrid(page, request);
  const commands = collectCreationCommands(page);

  await page.route(
    rowDocumentRoute,
    async (route) => {
      const response = await route.fetch();

      expect((await response.json()).code).toBe(0);
      await route.abort('failed');
    },
    { times: 1 }
  );
  await openRowDetailByRowId(page, rowId);
  await expect(page.getByTestId('row-document-load-error')).toBeVisible({ timeout: 30_000 });
  await expect(editorForRow(page)).toHaveCount(0);
  await closeRowDetailWithEscape(page);
  expect(commands).toHaveLength(1);
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  expect(commands).toHaveLength(1);
  const replay = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/row-document')
  );

  await openRowDetailByRowId(page, rowId);
  expect((await (await replay).json()).data.outcome).toBe('already_applied');
  await expect(editorForRow(page)).toBeVisible();
  await expect(rowIcon(page, rowId)).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
});
