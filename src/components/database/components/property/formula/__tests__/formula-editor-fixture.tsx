import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { flushFormulaEditor, formulaInput } from '@/application/database-yjs/__tests__/formula-editor-input';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { CellSpec, createFields, createRow, FieldSpec } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { parseFormulaTypeOption } from '@/application/database-yjs/fields/formula/parse';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import type { ReactNode } from 'react';

/**
 * A database with one row ('row') for the formula editor. The field helpers
 * change the properties the way a collaborator's synced edit does.
 */
export function formulaEditorFixture(specs: FieldSpec[], cells: Record<string, CellSpec> = {}) {
  const fields = createFields(specs).clone() as YDatabaseFields;
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;

  view.set(YjsDatabaseKey.id, 'view');
  view.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: 'row', height: 44 }]));
  views.set('view', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  view.set(YjsDatabaseKey.field_orders, Y.Array.from(Array.from(fields.keys(), (id) => ({ id }))));
  const { doc: rowDoc } = createRow('row', cells);
  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    readOnly: false,
    workspaceId: 'workspace',
    rowMap: { row: rowDoc },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  const addField = (id: string, name: string) => {
    const field = new Y.Map() as YDatabaseField;

    fields.set(id, field);
    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.name, name);
    field.set(YjsDatabaseKey.type, FieldType.Number);
  };

  return {
    fields,
    wrapper,
    /** Plain field edits, for use inside `transact`. */
    edit: {
      rename: (id: string, name: string) => fields.get(id).set(YjsDatabaseKey.name, name),
      remove: (id: string) => fields.delete(id),
      add: addField,
    },
    rename: (id: string, name: string) =>
      act(() => {
        fields.get(id).set(YjsDatabaseKey.name, name);
      }),
    remove: (id: string) =>
      act(() => {
        fields.delete(id);
      }),
    add: (id: string, name: string) =>
      act(() => {
        addField(id, name);
      }),
    /** Several field edits synced as one update. */
    transact: (edits: () => void) =>
      act(() => {
        fields.doc!.transact(edits);
      }),
    saved: (fieldId: string) => parseFormulaTypeOption(fields.get(fieldId)).formula,
  };
}

export type FormulaEditorFixture = ReturnType<typeof formulaEditorFixture>;

/** Types at the Slate selection: a paste lands where a keystroke would. */
export async function typeAtCaret(text: string) {
  fireEvent.paste(formulaInput(), {
    clipboardData: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  await flushFormulaEditor();
}

/** Ctrl+Z on a non-Apple platform; is-hotkey matches on `which`, so pass the key code. */
export async function undo() {
  fireEvent.keyDown(formulaInput(), { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ctrlKey: true });
  await flushFormulaEditor();
}

export async function redo() {
  fireEvent.keyDown(formulaInput(), { key: 'y', code: 'KeyY', keyCode: 89, which: 89, ctrlKey: true });
  await flushFormulaEditor();
}

/** The reference each token in the input holds, in order. */
export const tokenRefs = () =>
  screen.queryAllByTestId('formula-token').map((token) => token.getAttribute('data-ref'));

export const preview = () => screen.getByTestId('formula-preview-value').textContent;

export const doneDisabled = () => screen.getByTestId<HTMLButtonElement>('formula-editor-done').disabled;

export const clickDone = () => fireEvent.click(screen.getByTestId('formula-editor-done'));
