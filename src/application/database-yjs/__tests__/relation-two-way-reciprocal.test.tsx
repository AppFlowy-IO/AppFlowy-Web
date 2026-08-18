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
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
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
}: { withFieldSettings?: boolean; targetStartsEmpty?: boolean } = {}) {
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
  (useDatabaseContext as jest.Mock).mockReturnValue({
    databaseDoc: sourceDoc,
    createRow: jest.fn(),
    getViewIdFromDatabaseId: jest.fn(async (databaseId: string) =>
      databaseId === TARGET_DATABASE_ID ? TARGET_VIEW_ID : null
    ),
    loadView: jest.fn(async (viewId: string) => (viewId === TARGET_VIEW_ID ? targetDoc : null)),
    bindViewSync: jest.fn(),
  });

  return { relationField, targetDoc, hydrateTarget };
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
