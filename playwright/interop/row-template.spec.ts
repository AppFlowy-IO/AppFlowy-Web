import { expect, test, type Page } from '@playwright/test';

import type { DatabaseRowTemplate } from '../../src/application/database-yjs/template/types';
import type { DatabaseTestWindow } from '../../src/components/database/database-test-context';
import { withDesktopTemplate, type DesktopTemplateResult } from '../support/desktop-sdk';
import { signInAndCreateDatabaseView, waitForGridReady } from '../support/database-ui-helpers';
import { databaseBlocks, editFirstGridCell, firstGridCellText, insertInlineGridViaSlash } from '../support/duplicate-test-helpers';
import { closeRowDetailWithEscape, openRowDetailByRowId } from '../support/row-detail-helpers';
import { addDatabaseView, closeTemplateEditor, createRowAndGetId, createTemplate, editTemplate, expectDatabaseBlockViews, selectTemplate, setDefaultTemplate } from '../support/row-template-helpers';
import { generateRandomEmail } from '../support/test-config';

interface Identity { workspaceId: string; viewId: string; databaseId: string; templates: DatabaseRowTemplate[]; defaultId?: string; rowIds: string[] }

async function readIdentity(page: Page): Promise<Identity> {
  return page.evaluate(async () => {
    const path = '/src/application/database-yjs/template/store.ts';
    const { DatabaseRowTemplateStore } = await import(/* @vite-ignore */ path);
    const context = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__;

    if (!context?.databaseDoc || !context.workspaceId) throw new Error('Missing live Web database');
    const database = context.databaseDoc.getMap('data' as Parameters<typeof context.databaseDoc.getMap>[0]).get('database');
    const state = new DatabaseRowTemplateStore(database).read();

    return { workspaceId: context.workspaceId, viewId: context.activeViewId, databaseId: database.get('id'),
      templates: state.templates, defaultId: state.defaultTemplateId,
      rowIds: database.get('views').get(context.activeViewId).get('row_orders').toArray().filter((row: { is_deleted?: boolean }) => !row.is_deleted).map((row: { id: string }) => row.id) };
  });
}

async function observeNative(page: Page, identity: Identity, native: DesktopTemplateResult) {
  expect([native.workspace_id, native.view_id, native.database_id])
    .toEqual([identity.workspaceId, identity.viewId, identity.databaseId]);
  await expect.poll(async () => (await readIdentity(page)).templates.find((item) => item.templateId === native.template.template_id)?.name,
    { timeout: 30000, message: 'Web must observe the actual native template write' }).toBe(native.template.name);
  const stored = (await readIdentity(page)).templates.find((item) => item.templateId === native.template.template_id)!;

  expect(stored.documentData).toEqual(native.template.doc_data);
  expect(stored.embeddedDatabases).toHaveLength(native.template.embedded_databases.length);
  if (identity.defaultId) expect((await readIdentity(page)).defaultId).toBe(identity.defaultId);
}

async function assertRow(page: Page, rowId: string, blocks: number, tabs: number, text?: string) {
  await openRowDetailByRowId(page, rowId);
  const body = page.getByTestId('row-detail').getByTestId('editor-content').first();
  const databases = databaseBlocks(body);

  await expect(databases).toHaveCount(blocks, { timeout: 30000 });
  await expectDatabaseBlockViews(databases.first(), tabs);
  if (text) await expect.poll(() => firstGridCellText(databases.first()), { timeout: 30000 }).toBe(text);
  await closeRowDetailWithEscape(page);
}

async function reopenAndCreate(page: Page, name: string, blocks: number, tabs: number, text?: string) {
  const before = (await readIdentity(page)).rowIds;
  const editor = await editTemplate(page, name);
  const databases = databaseBlocks(editor.getByTestId('editor-content').first());

  await expect(databases).toHaveCount(blocks, { timeout: 30000 });
  await expectDatabaseBlockViews(databases.first(), tabs);
  if (text) await expect.poll(() => firstGridCellText(databases.first()), { timeout: 30000 }).toBe(text);
  await closeTemplateEditor(page);
  expect((await readIdentity(page)).rowIds).toEqual(before);
  const rowId = await createRowAndGetId(page, () => selectTemplate(page, name));

  await assertRow(page, rowId, blocks, tabs, text);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as Window & { Cypress?: boolean }).Cypress = true; });
});

test('Web → Desktop SDK → Web preserves a live inline/Board template', async ({ page, request }) => {
  const email = generateRandomEmail();
  const name = 'Web origin';

  await signInAndCreateDatabaseView(page, request, email, 'Grid', { verify: waitForGridReady });
  const editor = await createTemplate(page, name);
  const id = (await editor.getByTestId('editor-content').first().getAttribute('id'))!.replace('editor-', '');

  await insertInlineGridViaSlash(page, id);
  const block = databaseBlocks(editor.getByTestId('editor-content').first()).first();

  await editFirstGridCell(page, block, 'Web task survives both clients');
  await addDatabaseView(page, block, 'Board');
  await closeTemplateEditor(page);
  await setDefaultTemplate(page, name);
  const identity = await readIdentity(page);
  const template = identity.templates.find((item) => item.name === name)!;
  const native = await withDesktopTemplate({ email, view_id: identity.viewId, template_id: template.templateId,
    name: 'Saved on Desktop', action: 'save', expected_database_blocks: 1 }, (result) => observeNative(page, identity, result));

  expect(native.template.embedded_databases).toHaveLength(2);
  await page.reload();
  await waitForGridReady(page);
  await assertRow(page, native.created.row_id, 1, 2, 'Web task survives both clients');
  await reopenAndCreate(page, native.template.name, 1, 2, 'Web task survives both clients');
  expect((await readIdentity(page)).defaultId).toBe(template.templateId);

});

test('Desktop SDK → Web → Desktop SDK preserves archive-only owned and linked databases', async ({ page, request }) => {
  const email = generateRandomEmail();

  await signInAndCreateDatabaseView(page, request, email, 'Grid', { verify: waitForGridReady });
  const identity = await readIdentity(page);
  const native = await withDesktopTemplate({ email, view_id: identity.viewId, name: 'Desktop origin', action: 'author',
    expected_database_blocks: 2 }, (result) => observeNative(page, identity, result));

  expect(native.template.embedded_databases.map((item) => item.is_linked).sort()).toEqual([false, true]);
  await page.reload();
  await waitForGridReady(page);
  await assertRow(page, native.created.row_id, 2, 1);
  await setDefaultTemplate(page, native.template.name);
  await reopenAndCreate(page, native.template.name, 2, 1);
  await withDesktopTemplate({ email, view_id: identity.viewId, template_id: native.template.template_id,
    name: 'Desktop roundtrip', action: 'save', expected_database_blocks: 2 }, (result) => observeNative(page, identity, result));
  await page.reload();
  await waitForGridReady(page);
  await reopenAndCreate(page, 'Desktop roundtrip', 2, 1);
  expect((await readIdentity(page)).defaultId).toBe(native.template.template_id);
});
