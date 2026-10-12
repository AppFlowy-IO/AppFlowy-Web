import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForRowBodyCompletion } from '../../support/atomic-creation-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { waitForDocumentTextOnServer } from '../../support/duplicate-test-helpers';
import { closeRowDetailWithEscape, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

const firstBodyRoute = '**/v2/page-view/row-document';

test('new ordinary rows immediately accept atomic row pages after normal source synchronization', async ({
  page,
  request,
}) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  for (let index = 0; index < 5; index += 1) {
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

    expect(created).toBeTruthy();
    const rowId = created!.replace('grid-row-', '');

    await openRowDetailByRowId(page, rowId);
    const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

    await expect(editor).toBeVisible();
    const completion = waitForRowBodyCompletion(page);
    const text = `Body for newly synchronized row ${index}`;

    await editor.fill(text);
    await completion;
    await expect(page.getByTestId('row-document-creation-pending')).toHaveCount(0);
    await expect(page.getByTestId('row-document-creation-error')).toHaveCount(0);
    await closeRowDetailWithEscape(page);
    await openRowDetailByRowId(page, rowId);
    await expect(RowDetailSelectors.modal(page)).toContainText(text);
    await closeRowDetailWithEscape(page);
  }
});

test('continuous typing stays focused across a held first-body acknowledgement and persists all later characters', async ({
  page,
  request,
}) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  const rowId = (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace(
    'grid-row-',
    ''
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const serverCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let documentId = '';
  const commands: string[] = [];

  await page.route(firstBodyRoute, async (route) => {
    commands.push(route.request().postData()!);
    const response = await route.fetch();
    const body = await response.json();

    expect(body.code).toBe(0);
    documentId = body.data.result.document_id;
    committed();
    await held;
    await route.fulfill({ response });
  });
  await openRowDetailByRowId(page, rowId);
  const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();
  const text = 'Typing must preserve every character while the server acknowledgement is held.';

  await expect(editor).toBeVisible();
  try {
    await editor.click();
    const typing = page.keyboard.type(text, { delay: 50 });

    await serverCommitted;
    await typing;
    await expect(editor).toContainText(text);
    await expect(editor).toBeFocused();
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect(page.getByTestId('row-document-creation-pending')).toHaveCount(0);
  await expect(editor).toContainText(text);
  await expect(editor).toBeFocused();
  await page.keyboard.type(' And continue.');
  await expect(editor).toContainText(`${text} And continue.`);
  await waitForDocumentTextOnServer(page, TestConfig.apiUrl, documentId, `${text} And continue.`);
  await closeRowDetailWithEscape(page);
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  await openRowDetailByRowId(page, rowId);
  await expect(RowDetailSelectors.modal(page)).toContainText(`${text} And continue.`);
  expect(commands).toHaveLength(1);
});

test('lost first-body acknowledgement keeps a visible retry and recovers exactly once across reload', async ({
  page,
  request,
}) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  const rowId = (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace(
    'grid-row-',
    ''
  );
  const commands: string[] = [];

  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/v2/page-view/row-document')) commands.push(req.postData()!);
  });
  await openRowDetailByRowId(page, rowId);
  const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

  await expect(editor).toBeVisible();
  expect(commands).toHaveLength(0);
  await page.route(
    firstBodyRoute,
    async (route) => {
      const response = await route.fetch();

      expect((await response.json()).code).toBe(0);
      await route.abort('failed');
    },
    { times: 1 }
  );
  await editor.fill('Durable first body after a lost acknowledgement');
  const error = page.getByTestId('row-document-creation-error');

  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error.getByRole('button', { name: 'Retry creation', exact: true })).toBeEnabled();
  await expect(editor).toContainText('Durable first body after a lost acknowledgement');
  expect(commands).toHaveLength(1);
  const replay = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/v2/page-view/row-document')
  );

  await error.getByRole('button', { name: 'Retry creation', exact: true }).click();
  expect((await (await replay).json()).data.outcome).toBe('already_applied');
  await expect(error).toHaveCount(0);
  await expect(page.getByTestId('row-document-creation-pending')).toHaveCount(0);
  await expect(editor).toContainText('Durable first body after a lost acknowledgement');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  await closeRowDetailWithEscape(page);
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  await openRowDetailByRowId(page, rowId);
  await expect(RowDetailSelectors.modal(page).getByTestId('editor-content').first()).toContainText(
    'Durable first body after a lost acknowledgement'
  );
  expect(commands).toHaveLength(2);
});

test('an open empty row page rejects its first edit offline and remains usable after reconnect', async ({
  page,
  request,
}) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  const rowId = (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace(
    'grid-row-',
    ''
  );
  const commands: string[] = [];

  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/v2/page-view/row-document')) commands.push(req.postData()!);
  });
  await openRowDetailByRowId(page, rowId);
  const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

  await expect(editor).toBeVisible();
  await page.context().setOffline(true);
  await editor.fill('This must not create an offline row page');
  await expect(page.getByTestId('row-document-creation-error')).toContainText(
    'Connect to the internet to create this item.'
  );
  await expect(editor).not.toContainText('This must not create an offline row page');
  expect(commands).toHaveLength(0);
  await page.context().setOffline(false);
  await editor.fill('Created after reconnect');
  await expect(page.getByTestId('row-document-creation-pending')).toHaveCount(0);
  await expect(page.getByTestId('row-document-creation-error')).toHaveCount(0);
  await expect(editor).toContainText('Created after reconnect');
  await expect.poll(() => commands.length).toBe(1);
  await closeRowDetailWithEscape(page);
  await openRowDetailByRowId(page, rowId);
  await expect(RowDetailSelectors.modal(page)).toContainText('Created after reconnect');
});

test('reopening after a lost acknowledgement restores staged typing without changing the original command', async ({
  page,
  request,
}) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  const rowId = (await DatabaseGridSelectors.dataRows(page).first().getAttribute('data-testid'))!.replace(
    'grid-row-',
    ''
  );
  const commands: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let documentId = '';

  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/v2/page-view/row-document')) commands.push(req.postData()!);
  });
  await page.route(
    firstBodyRoute,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      expect(body.code).toBe(0);
      documentId = body.data.result.document_id;
      await held;
      await route.abort('failed');
    },
    { times: 1 }
  );
  await openRowDetailByRowId(page, rowId);
  const text = 'All typing after the first character survives a browser reload.';
  const editor = RowDetailSelectors.modal(page).getByTestId('editor-content').first();

  try {
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type(text, { delay: 30 });
    await expect(editor).toContainText(text);
    await expect.poll(() => documentId).not.toBe('');
  } finally {
    release();
  }
  await expect(page.getByTestId('row-document-creation-error')).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.reload();
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible();
  // Reconnect alone does not replay; opening this row explicitly recovers its saved command.
  expect(commands).toHaveLength(1);
  const replay = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/v2/page-view/row-document')
  );

  await openRowDetailByRowId(page, rowId);
  expect((await (await replay).json()).data.outcome).toBe('already_applied');
  await expect(RowDetailSelectors.modal(page).getByTestId('editor-content').first()).toContainText(text);
  await waitForDocumentTextOnServer(page, TestConfig.apiUrl, documentId, text);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
});
