import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uid: '1', uuid: 'u-1' }),
}));

jest.mock('@/application/database-yjs/fields/text/rich-text-notice', () => ({ notifyRichTextNewer: jest.fn() }));

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
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
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
      targetDoc.getMap(YjsEditorKey.data_section).set(
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

function protectCell(rowDoc: YDoc, fieldId: string) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown>;
  const cell = (row.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>).get(fieldId)!;

  cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
  cell.set(YjsDatabaseKey.data, 'Future text');
  cell.set(YjsDatabaseKey.rich_text, JSON.stringify({ min_v: 2, text: 'Future text', delta: [] }));
}

function readTargetOrders(targetDoc: YDoc) {
  const database = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const view = database.get(YjsDatabaseKey.views).get(TARGET_VIEW_ID);

  return view
    .get(YjsDatabaseKey.field_orders)
    .toArray()
    .map((entry) => entry.id);
}

describe('enabling a two-way relation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves protected cells and their attribution when changing the related database', async () => {
    setup();
    const protectedDoc = new Y.Doc() as YDoc;
    const ordinaryDoc = new Y.Doc() as YDoc;

    seedRelationRowDoc(protectedDoc, 'protected', RELATION_FIELD_ID, []);
    seedRelationRowDoc(ordinaryDoc, 'ordinary', RELATION_FIELD_ID, ['old-target']);
    protectCell(protectedDoc, RELATION_FIELD_ID);
    const original = protectedDoc.toJSON();

    (useRowMap as jest.Mock).mockReturnValue({ protected: protectedDoc, ordinary: ordinaryDoc });
    const { result } = renderHook(() => useUpdateRelationTypeOption(RELATION_FIELD_ID));

    await act(async () => {
      await result.current({ database_id: 'another-database' });
    });
    expect(protectedDoc.toJSON()).toEqual(original);
    expect(readRelationCell(ordinaryDoc, RELATION_FIELD_ID)).toEqual([]);
    expect(notifyRichTextNewer).not.toHaveBeenCalled();
  });

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

  it.each(['replace', 'append', 'remove', 'other-cell'] as const)(
    'preserves invocation order during overlapping %s edits while a target is loading',
    async (operation) => {
      jest.useFakeTimers();
      try {
        const { relationField, targetDoc, rowDocs } = setup();
        const reciprocalId = 'reciprocal';

        setRelationTypeOptionValues(ensureTypeOption(relationField), {
          database_id: TARGET_DATABASE_ID,
          is_two_way: true,
          reciprocal_field_id: reciprocalId,
          source_limit: operation === 'replace' ? 1 : 0,
          target_limit: 0,
        });
        const targetDatabase = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

        targetDatabase.get(YjsDatabaseKey.fields).set(
          reciprocalId,
          createRelationField(reciprocalId, {
            name: 'Backlinks',
            database_id: SOURCE_DATABASE_ID,
            is_two_way: true,
            reciprocal_field_id: RELATION_FIELD_ID,
          })
        );
        const source = new Y.Doc() as YDoc;
        const other = new Y.Doc() as YDoc;
        const a = new Y.Doc() as YDoc;
        const b = new Y.Doc() as YDoc;

        seedRelationRowDoc(source, 'source', RELATION_FIELD_ID, []);
        seedRelationRowDoc(other, 'other', RELATION_FIELD_ID, []);
        seedRelationRowDoc(b, 'b', reciprocalId, []);
        rowDocs.set(`${SOURCE_DATABASE_ID}_rows_source`, source);
        rowDocs.set(`${SOURCE_DATABASE_ID}_rows_other`, other);
        rowDocs.set(`${TARGET_DATABASE_ID}_rows_a`, a);
        rowDocs.set(`${TARGET_DATABASE_ID}_rows_b`, b);
        const first = renderHook(() => useUpdateRelationCell('source', RELATION_FIELD_ID));
        // Separate consumers of the same cell must share its write ordering.
        const second = renderHook(() =>
          useUpdateRelationCell(operation === 'other-cell' ? 'other' : 'source', RELATION_FIELD_ID)
        );

        await act(async () => {
          const firstSave = first.result.current({ insertedRowIds: ['a'] });

          await jest.advanceTimersByTimeAsync(0);
          const secondSave = second.result.current(
            operation === 'remove' ? { removedRowIds: ['a'] } : { insertedRowIds: ['b'] }
          );

          await jest.advanceTimersByTimeAsync(0);
          if (operation === 'other-cell') {
            // An unrelated cell can finish while A is still hydrating.
            expect(readRelationCell(other, RELATION_FIELD_ID)).toEqual(['b']);
          }

          seedRelationRowDoc(a, 'a', reciprocalId, []);
          await Promise.all([firstSave, secondSave]);
        });
        expect(readRelationCell(source, RELATION_FIELD_ID)).toEqual(
          operation === 'replace' ? ['b'] : operation === 'append' ? ['a', 'b'] : operation === 'remove' ? [] : ['a']
        );
        expect(readRelationCell(a, reciprocalId)).toEqual(
          operation === 'append' || operation === 'other-cell' ? ['source'] : []
        );
        expect(readRelationCell(b, reciprocalId)).toEqual(
          operation === 'remove' ? [] : [operation === 'other-cell' ? 'other' : 'source']
        );
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it.each(['replace', 'remove', 'missing-insertion'] as const)(
    'handles an unavailable relation participant during %s',
    async (operation) => {
      jest.useFakeTimers();
      try {
        const { relationField, targetDoc, rowDocs } = setup();
        const reciprocalId = 'reciprocal';

        setRelationTypeOptionValues(ensureTypeOption(relationField), {
          database_id: TARGET_DATABASE_ID,
          is_two_way: true,
          reciprocal_field_id: reciprocalId,
          source_limit: 1,
          target_limit: 0,
        });
        const targetDatabase = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

        targetDatabase.get(YjsDatabaseKey.fields).set(
          reciprocalId,
          createRelationField(reciprocalId, {
            name: 'Backlinks',
            database_id: SOURCE_DATABASE_ID,
            is_two_way: true,
            reciprocal_field_id: RELATION_FIELD_ID,
          })
        );
        const source = new Y.Doc() as YDoc;
        const target = new Y.Doc() as YDoc;

        seedRelationRowDoc(source, 'source', RELATION_FIELD_ID, ['old']);
        seedRelationRowDoc(target, 'new', reciprocalId, []);
        rowDocs.set(`${SOURCE_DATABASE_ID}_rows_source`, source);
        rowDocs.set(`${TARGET_DATABASE_ID}_rows_new`, target);
        const { result } = renderHook(() => useUpdateRelationCell('source', RELATION_FIELD_ID));

        await act(async () => {
          const pending = result.current(
            operation === 'remove'
              ? { removedRowIds: ['old'] }
              : { insertedRowIds: [operation === 'replace' ? 'new' : 'missing'] }
          );

          await jest.advanceTimersByTimeAsync(3000);
          await pending;
        });
        expect(readRelationCell(source, RELATION_FIELD_ID)).toEqual(
          operation === 'replace' ? ['new'] : operation === 'remove' ? [] : ['old']
        );
        expect(readRelationCell(target, reciprocalId)).toEqual(operation === 'replace' ? ['source'] : []);
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it.each(['insert', 'remove', 'replace-one'] as const)(
    'preflights protected participants before a two-way %s',
    async (operation) => {
      const { relationField, targetDoc, rowDocs } = setup();
      const reciprocalId = 'reciprocal';

      setRelationTypeOptionValues(ensureTypeOption(relationField), {
        database_id: TARGET_DATABASE_ID,
        is_two_way: true,
        reciprocal_field_id: reciprocalId,
        source_limit: 0,
        target_limit: 0,
      });
      const targetDatabase = targetDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

      targetDatabase.get(YjsDatabaseKey.fields).set(
        reciprocalId,
        createRelationField(reciprocalId, {
          name: 'Backlinks',
          database_id: SOURCE_DATABASE_ID,
          is_two_way: true,
          reciprocal_field_id: RELATION_FIELD_ID,
          source_limit: operation === 'replace-one' ? 1 : 0,
        })
      );
      const source = new Y.Doc() as YDoc;
      const target = new Y.Doc() as YDoc;
      const displaced = new Y.Doc() as YDoc;

      seedRelationRowDoc(source, 'source', RELATION_FIELD_ID, operation === 'remove' ? ['target'] : []);
      seedRelationRowDoc(target, 'target', reciprocalId, operation === 'replace-one' ? ['displaced'] : []);
      seedRelationRowDoc(displaced, 'displaced', RELATION_FIELD_ID, ['target']);
      protectCell(
        operation === 'replace-one' ? displaced : target,
        operation === 'replace-one' ? RELATION_FIELD_ID : reciprocalId
      );
      rowDocs.set(`${SOURCE_DATABASE_ID}_rows_source`, source);
      rowDocs.set(`${TARGET_DATABASE_ID}_rows_target`, target);
      rowDocs.set(`${SOURCE_DATABASE_ID}_rows_displaced`, displaced);
      const originals = [source, target, displaced].map((doc) => doc.toJSON());
      const { result } = renderHook(() => useUpdateRelationCell('source', RELATION_FIELD_ID));

      await act(async () => {
        await result.current(operation === 'remove' ? { removedRowIds: ['target'] } : { insertedRowIds: ['target'] });
      });
      expect([source, target, displaced].map((doc) => doc.toJSON())).toEqual(originals);
      expect(notifyRichTextNewer).toHaveBeenCalledTimes(1);
    }
  );

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
