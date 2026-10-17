import * as Y from 'yjs';

import { populateNewRowCells } from '@/application/database-yjs/dispatch/new-row-cells';
import { FieldType } from '@/application/database-yjs/database.type';
import { applyTemplateCellsToRow, extractTemplateCellsFromRow } from '@/application/database-yjs/template/cell';
import { YDatabase, YDatabaseCell, YDatabaseCells, YDatabaseField, YDatabaseFields, YDatabaseRow, YDatabaseViews, YDatabaseView, YjsDatabaseKey } from '@/application/types';

import { assertFieldMutation, bindVerificationField, createNativeVerificationField, deleteNativeVerificationField, findVerificationField, getVerificationPropertyId, getVerificationSourceType } from '../native';

function fixture() {
  const doc = new Y.Doc();
  const database = doc.getMap('database') as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  views.set('view', view);
  view.set(YjsDatabaseKey.field_orders, new Y.Array());
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  return { doc, database, fields, view };
}

function addTextField(fields: YDatabaseFields, id = 'text') {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  const options = new Y.Map();

  options.set('0', new Y.Map([['original', 'preserved']]));
  field.set(YjsDatabaseKey.type_option, options);
  fields.set(id, field);
  return field;
}

describe('native Verification lifecycle', () => {
  it('creates exactly one real field in native field orders, with Cloud binding and no cells', () => {
    const f = fixture();
    const id = createNativeVerificationField(f.database, 'generation-a');
    const field = findVerificationField(f.database)!;

    expect(field.get(YjsDatabaseKey.id)).toBe(id);
    expect(Number(field.get(YjsDatabaseKey.type))).toBe(FieldType.Verification);
    expect(getVerificationPropertyId(field)).toBe('generation-a');
    expect(f.view.get(YjsDatabaseKey.field_orders).toJSON()).toEqual([{ id }]);
    expect(() => createNativeVerificationField(f.database, 'generation-b')).toThrow('already exists');
    expect(f.fields.size).toBe(1);
  });

  it('preserves original options, field identity and the source hint across rebinding', () => {
    const f = fixture();
    const field = addTextField(f.fields);
    const original = field.get(YjsDatabaseKey.type_option).get('0');

    bindVerificationField(f.database, field, 'a');
    bindVerificationField(f.database, field, 'b');
    expect(f.fields.get('text')).toBe(field);
    expect(field.get(YjsDatabaseKey.type_option).get('0')).toBe(original);
    expect(original.toJSON()).toEqual({ original: 'preserved' });
    expect(getVerificationSourceType(field)).toBe(FieldType.RichText);
    expect(getVerificationPropertyId(field)).toBe('b');
  });

  it('rejects stale or unguarded mutations without deleting a rebound generation', () => {
    const f = fixture();
    const field = addTextField(f.fields);

    bindVerificationField(f.database, field, 'b');
    expect(() => assertFieldMutation(field)).toThrow('changed');
    expect(() => deleteNativeVerificationField(f.database, 'text', 'a')).toThrow('changed');
    expect(f.fields.get('text')).toBe(field);
    deleteNativeVerificationField(f.database, 'text', 'b');
    expect(f.fields.has('text')).toBe(false);
  });

  it('treats duplicate remote Verification schemas as ambiguous', () => {
    const f = fixture();

    createNativeVerificationField(f.database, 'a');
    const duplicate = addTextField(f.fields, 'remote');

    duplicate.set(YjsDatabaseKey.type, FieldType.Verification);
    expect(findVerificationField(f.database)).toBeUndefined();
  });

  it('does not write or export Verification values through templates and defaults', () => {
    const f = fixture();
    const id = createNativeVerificationField(f.database, 'a');
    const row = new Y.Doc().getMap('row') as YDatabaseRow;

    row.set(YjsDatabaseKey.cells, new Y.Map());
    const values = { [id]: { type: 'text' as const, value: 'Verified' } };

    expect(applyTemplateCellsToRow(row, f.database, values)).toEqual({});
    expect(row.get(YjsDatabaseKey.cells).size).toBe(0);
    expect(extractTemplateCellsFromRow(row, f.database)).toEqual({});
  });
});


it('ignores Verification values in raw row creation and calendar draft snapshots', () => {
  const f = fixture();
  const id = createNativeVerificationField(f.database, 'a');
  const row = new Y.Doc().getMap('row') as YDatabaseRow;

  row.set(YjsDatabaseKey.cells, new Y.Map());
  populateNewRowCells({ row, database: f.database, cellsData: { [id]: 'Verified' } });
  expect(row.get(YjsDatabaseKey.cells).size).toBe(0);
  const draft = new Y.Doc().getMap('cells') as YDatabaseCells;
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
  cell.set(YjsDatabaseKey.data, 'Preserved source data');
  draft.set(id, cell);
  populateNewRowCells({ row, database: f.database, initialCells: draft });
  expect(row.get(YjsDatabaseKey.cells).size).toBe(0);
});
