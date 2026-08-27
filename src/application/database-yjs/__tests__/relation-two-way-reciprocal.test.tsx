import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uid: '1', uuid: 'u-1' }),
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
  useRowMap: jest.fn(),
  useSharedRoot: jest.fn(),
}));

import { useDatabase, useDatabaseContext, useRowMap, useSharedRoot } from '@/application/database-yjs/context';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { useUpdateRelationCell, useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField, setRelationTypeOptionValues } from '@/application/database-yjs/fields/relation/utils';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldSetting,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

const SOURCE_DATABASE_ID = 'db-source';
const TARGET_DATABASE_ID = 'db-target';
const TARGET_VIEW_ID = 'view-target';
const RELATION_FIELD_ID = 'rel-1';

function createTextField(fieldId: string, name: string, isPrimary = false): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  if (isPrimary) field.set(YjsDatabaseKey.is_primary, true);
  return field;
}

/** Builds the `database` map a target doc is expected to carry. */
function buildDatabase(opts: {
  databaseId: string;
  viewId: string;
  fields: Array<[string, YDatabaseField]>;
  withFieldSettings: boolean;
}): YDatabase {
  const database = new Y.Map() as YDatabase;
  const fieldsMap = new Y.Map() as YDatabaseFields;

  opts.fields.forEach(([id, field]) => fieldsMap.set(id, field));

  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.id, opts.viewId);
  view.set(YjsDatabaseKey.database_id, opts.databaseId);

  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(opts.fields.map(([id]) => ({ id })));
  view.set(YjsDatabaseKey.field_orders, fieldOrders);

  if (opts.withFieldSettings) {
    const fieldSettings = new Y.Map();

    opts.fields.forEach(([id]) => {
      const setting = new Y.Map() as YDatabaseFieldSetting;

      setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
      fieldSettings.set(id, setting);
    });
    view.set(YjsDatabaseKey.field_settings, fieldSettings);
  }

  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  views.set(opts.viewId, view);

  database.set(YjsDatabaseKey.id, opts.databaseId);
  database.set(YjsDatabaseKey.fields, fieldsMap);
  database.set(YjsDatabaseKey.views, views);
  return database;
}

function createDatabaseDoc(opts: {
  databaseId: string;
  viewId: string;
  fields: Array<[string, YDatabaseField]>;
  withFieldSettings?: boolean;
  /** Leave the doc an empty shell, the way an unsynced `loadView` result arrives. */
  empty?: boolean;
}): YDoc {
  const doc = new Y.Doc() as YDoc;

  doc.guid = opts.databaseId;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);

  if (!opts.empty) {
    sharedRoot.set(
      YjsEditorKey.database,
      buildDatabase({
        databaseId: opts.databaseId,
        viewId: opts.viewId,
        fields: opts.fields,
        withFieldSettings: opts.withFieldSettings ?? true,
      })
    );
  }

  return doc;
}

function setup({
  withFieldSettings = true,
  targetStartsEmpty = false,
  hydrateOnBind = false,
}: { withFieldSettings?: boolean; targetStartsEmpty?: boolean; hydrateOnBind?: boolean } = {}) {
  const relationField = createRelationField(RELATION_FIELD_ID, {
    name: 'Projects',
    database_id: TARGET_DATABASE_ID,
    is_two_way: false,
  });

  const sourceDoc = createDatabaseDoc({
    databaseId: SOURCE_DATABASE_ID,
    viewId: 'view-source',
    fields: [
      ['title', createTextField('title', 'Name', true)],
      [RELATION_FIELD_ID, relationField],
    ],
  });

  const targetFields: Array<[string, YDatabaseField]> = [['t-title', createTextField('t-title', 'Name', true)]];
  const targetDoc = createDatabaseDoc({
    databaseId: TARGET_DATABASE_ID,
    viewId: TARGET_VIEW_ID,
    fields: targetFields,
    withFieldSettings,
    empty: targetStartsEmpty,
  });

  const hydrateTarget = () => {
    targetDoc.transact(() => {
      targetDoc
        .getMap(YjsEditorKey.data_section)
        .set(
          YjsEditorKey.database,
          buildDatabase({
            databaseId: TARGET_DATABASE_ID,
            viewId: TARGET_VIEW_ID,
            fields: targetFields,
            withFieldSettings,
          })
        );
    });
  };

  const sourceSharedRoot = sourceDoc.getMap(YjsEditorKey.data_section);

  (useDatabase as jest.Mock).mockReturnValue(sourceSharedRoot.get(YjsEditorKey.database) as YDatabase);
  (useSharedRoot as jest.Mock).mockReturnValue(sourceSharedRoot);
  (useRowMap as jest.Mock).mockReturnValue({});
  // Row docs served by `createRow`, keyed the way `getRowKey` builds them.
  const rowDocs = new Map<string, YDoc>();
  const createRow = jest.fn(async (rowKey: string) => {
    const existing = rowDocs.get(rowKey);

    if (existing) return existing;

    const rowDoc = new Y.Doc() as YDoc;

    rowDocs.set(rowKey, rowDoc);
    return rowDoc;
  });

  // When the target is an unsynced shell, binding sync is the only channel that can deliver its
  // `database` map — model that: the map lands on the next macrotask after the bind.
  const bindViewSync = jest.fn((doc: YDoc) => {
    if (hydrateOnBind && doc === targetDoc) {
      setTimeout(hydrateTarget, 0);
    }

    return null;
  });

  (useDatabaseContext as jest.Mock).mockReturnValue({
    databaseDoc: sourceDoc,
    createRow,
    getViewIdFromDatabaseId: jest.fn(async (databaseId: string) =>
      databaseId === TARGET_DATABASE_ID ? TARGET_VIEW_ID : null
    ),
    loadView: jest.fn(async (viewId: string) => (viewId === TARGET_VIEW_ID ? targetDoc : null)),
    bindViewSync,
  });

  return { relationField, targetDoc, hydrateTarget, bindViewSync, rowDocs };
}

/** Seeds a row doc (shaped like `getRowFromDoc` reads it) whose relation cell holds `linked`. */
function seedRelationRowDoc(rowDoc: YDoc, rowId: string, fieldId: string, linked: string[]) {
  rowDoc.transact(() => {
    const sharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const row = new Y.Map();
    const cells = new Y.Map();
    const cell = new Y.Map();
    const data = new Y.Array<string>();

    data.push(linked);
    cell.set(YjsDatabaseKey.field_type, 10);
    cell.set(YjsDatabaseKey.data, data);
    cells.set(fieldId, cell);
    row.set(YjsDatabaseKey.id, rowId);
    row.set(YjsDatabaseKey.cells, cells);
    sharedRoot.set(YjsEditorKey.database_row, row);
  });
}

function readRelationCell(rowDoc: YDoc, fieldId: string): string[] {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown> | undefined;
  const cell = (row?.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>> | undefined)?.get(fieldId);
  const data = cell?.get(YjsDatabaseKey.data);

  return data instanceof Y.Array ? data.toArray().map(String) : [];
}

function readTargetOrders(targetDoc: YDoc) {
  const database = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const view = database.get(YjsDatabaseKey.views).get(TARGET_VIEW_ID);

  return view.get(YjsDatabaseKey.field_orders).toArray().map((entry) => entry.id);
}

describe('enabling a two-way relation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds the reciprocal property to the related database', async () => {
    const { relationField, targetDoc } = setup();
    const { result } = renderHook(() => useUpdateRelationTypeOption(RELATION_FIELD_ID));

    await act(async () => {
      await result.current({ is_two_way: true, reciprocal_field_name: 'Tasks' });
    });

    const option = parseRelationTypeOption(relationField);

    expect(option.is_two_way).toBe(true);
    expect(option.reciprocal_field_id).toBeTruthy();
    expect(readTargetOrders(targetDoc)).toContain(option.reciprocal_field_id);
  });

  it('shows the reciprocal property on a related view that carries no field_settings', async () => {
    // Bailing out of `addFieldToAllViews` on a missing settings map created the field but never
    // listed it, so the related database showed no new property at all.
    const { relationField, targetDoc } = setup({ withFieldSettings: false });
    const { result } = renderHook(() => useUpdateRelationTypeOption(RELATION_FIELD_ID));

    await act(async () => {
      await result.current({ is_two_way: true, reciprocal_field_name: 'Tasks' });
    });

    const option = parseRelationTypeOption(relationField);

    expect(option.reciprocal_field_id).toBeTruthy();
    expect(readTargetOrders(targetDoc)).toContain(option.reciprocal_field_id);
  });

  it('waits for a related database that is still syncing instead of silently going one-way', async () => {
    // `loadView` hands back an empty shell for a database that has never been opened; reading it
    // straight away dropped the relation back to one-way with no reciprocal property anywhere.
    const { relationField, targetDoc, hydrateTarget } = setup({ targetStartsEmpty: true });
    const { result } = renderHook(() => useUpdateRelationTypeOption(RELATION_FIELD_ID));

    await act(async () => {
      const pending = result.current({ is_two_way: true, reciprocal_field_name: 'Tasks' });

      // A macrotask, so the sync lands strictly after every `await` the update already has —
      // a single synchronous read of the doc has to miss it.
      setTimeout(hydrateTarget, 0);
      await pending;
    });

    const option = parseRelationTypeOption(relationField);

    expect(option.is_two_way).toBe(true);
    expect(option.reciprocal_field_id).toBeTruthy();
    expect(readTargetOrders(targetDoc)).toContain(option.reciprocal_field_id);
  });
});

describe('two-way relation: cell edits', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hydrates a shell related database through the sync binding before giving up', async () => {
    // A cache-only shell has no HTTP fetch in flight; binding sync is the only channel that can
    // deliver its `database` map. Waiting for hydration BEFORE binding let the timeout expire
    // against a channel that was never opened, silently downgrading the relation to one-way.
    const { relationField, targetDoc, bindViewSync } = setup({ targetStartsEmpty: true, hydrateOnBind: true });
    const { result } = renderHook(() => useUpdateRelationTypeOption(RELATION_FIELD_ID));

    await act(async () => {
      await result.current({ is_two_way: true, reciprocal_field_name: 'Tasks' });
    });

    expect(bindViewSync).toHaveBeenCalledWith(targetDoc);

    const option = parseRelationTypeOption(relationField);

    expect(option.is_two_way).toBe(true);
    expect(option.reciprocal_field_id).toBeTruthy();
    expect(readTargetOrders(targetDoc)).toContain(option.reciprocal_field_id);
  }, 10000);

  it('keeps the reciprocal link when one changeset reinserts a removed row', async () => {
    // {insertedRowIds:[R], removedRowIds:[R]} yields R in BOTH effective sets — they are not
    // inherently disjoint. The source cell ends with R present, so the reciprocal must end with
    // the source row present too, regardless of how the two concurrent branches interleave.
    const targetRowId = 'target-row-1';
    const sourceRowId = 'source-row-1';
    const reciprocalFieldId = 'recip-1';
    const { relationField, targetDoc, rowDocs } = setup();

    // Wire the source field as an established two-way relation.
    relationField.get(YjsDatabaseKey.type_option).delete(String(10));
    setRelationTypeOptionValues(ensureTypeOption(relationField), {
      database_id: TARGET_DATABASE_ID,
      is_two_way: true,
      reciprocal_field_id: reciprocalFieldId,
      source_limit: 0,
      target_limit: 0,
    });

    const targetDatabase = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    targetDatabase.get(YjsDatabaseKey.fields).set(
      reciprocalFieldId,
      createRelationField(reciprocalFieldId, {
        name: 'Customers',
        database_id: SOURCE_DATABASE_ID,
        is_two_way: true,
        reciprocal_field_id: RELATION_FIELD_ID,
      })
    );

    // Source row already links the target row; the reciprocal already points back.
    const sourceRowDoc = new Y.Doc() as YDoc;
    const targetRowDoc = new Y.Doc() as YDoc;

    seedRelationRowDoc(sourceRowDoc, sourceRowId, RELATION_FIELD_ID, [targetRowId]);
    seedRelationRowDoc(targetRowDoc, targetRowId, reciprocalFieldId, [sourceRowId]);
    rowDocs.set(`${SOURCE_DATABASE_ID}_rows_${sourceRowId}`, sourceRowDoc);
    rowDocs.set(`${TARGET_DATABASE_ID}_rows_${targetRowId}`, targetRowDoc);

    const { result } = renderHook(() => useUpdateRelationCell(sourceRowId, RELATION_FIELD_ID));

    await act(async () => {
      await result.current({ insertedRowIds: [targetRowId], removedRowIds: [targetRowId] });
    });

    expect(readRelationCell(sourceRowDoc, RELATION_FIELD_ID)).toEqual([targetRowId]);
    expect(readRelationCell(targetRowDoc, reciprocalFieldId)).toContain(sourceRowId);
  });
});

function ensureTypeOption(field: YDatabaseField) {
  let typeOptionMap = field.get(YjsDatabaseKey.type_option);

  if (!typeOptionMap) {
    typeOptionMap = new Y.Map() as never;
    field.set(YjsDatabaseKey.type_option, typeOptionMap);
  }

  let typeOption = typeOptionMap.get(String(10));

  if (!typeOption) {
    typeOption = new Y.Map() as never;
    typeOptionMap.set(String(10), typeOption);
  }

  return typeOption;
}
