import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  useCellSelector,
} from '@/application/database-yjs';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { useRollupFieldObservers } from '@/application/database-yjs/hooks/useRollupFieldObservers';
import * as rollupCache from '@/application/database-yjs/rollup/cache';
import {
  LoadView,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc, setRelationCellRowIds } from '../../__tests__/test-helpers';

const baseDatabaseId = 'base-database-id';
const baseViewId = 'base-view-id';
const baseRowId = 'base-row-id';
const relationFieldId = 'relation-field-id';
const rollupFieldId = 'rollup-field-id';
const relatedDatabaseId = 'related-database-id';
const relatedViewId = 'related-view-id';
const relatedRowId = 'related-row-id';
const targetFieldId = 'target-field-id';

function createFixture() {
  const relatedDoc = new Y.Doc({ guid: relatedViewId }) as YDoc;
  const relatedDatabase = new Y.Map() as YDatabase;
  const relatedFields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const targetField = new Y.Map() as YDatabaseField;

  targetField.set(YjsDatabaseKey.id, targetFieldId);
  targetField.set(YjsDatabaseKey.name, 'Target');
  targetField.set(YjsDatabaseKey.type, FieldType.RichText);
  targetField.set(YjsDatabaseKey.is_primary, true);
  relatedFields.set(targetFieldId, targetField);
  relatedDatabase.set(YjsDatabaseKey.id, relatedDatabaseId);
  relatedDatabase.set(YjsDatabaseKey.fields, relatedFields);
  relatedDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, relatedDatabase);

  const baseDoc = new Y.Doc({ guid: baseViewId }) as YDoc;
  const baseDatabase = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
  const sort = new Y.Map() as YDatabaseSort;
  const relationField = createRelationField(relationFieldId, {
    database_id: relatedDatabaseId,
  });
  const rollupField = createRollupField(rollupFieldId);

  fields.set(relationFieldId, relationField);
  fields.set(rollupFieldId, rollupField);
  sort.set(YjsDatabaseKey.field_id, rollupFieldId);
  sorts.push([sort]);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set(baseViewId, view);
  baseDatabase.set(YjsDatabaseKey.id, baseDatabaseId);
  baseDatabase.set(YjsDatabaseKey.fields, fields);
  baseDatabase.set(YjsDatabaseKey.views, views);
  baseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, baseDatabase);
  const integratedRollupField = fields.get(rollupFieldId);
  const rollupOption = integratedRollupField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Rollup));

  rollupOption?.set(YjsDatabaseKey.relation_field_id, relationFieldId);
  rollupOption?.set(YjsDatabaseKey.target_field_id, targetFieldId);

  const baseRowDoc = createRowDoc(baseRowId, baseDatabaseId, {
    [relationFieldId]: { fieldType: FieldType.Relation },
    [rollupFieldId]: { fieldType: FieldType.Rollup },
  });

  setRelationCellRowIds(baseRowDoc, relationFieldId, [relatedRowId]);

  const relatedRowDoc = createRowDoc(relatedRowId, relatedDatabaseId, {
    [targetFieldId]: { fieldType: FieldType.RichText, data: 'Related value' },
  });
  const loadView = jest.fn(async () => relatedDoc) as jest.MockedFunction<LoadView>;
  const createRow = jest.fn(async () => relatedRowDoc);
  const getViewIdFromDatabaseId = jest.fn(async (databaseId: string) =>
    databaseId === relatedDatabaseId ? relatedViewId : null
  );
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: baseDoc,
    databasePageId: baseViewId,
    activeViewId: baseViewId,
    rowMap: { [baseRowId]: baseRowDoc },
    workspaceId: 'workspace-id',
    loadView,
    createRow,
    getViewIdFromDatabaseId,
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return { getViewIdFromDatabaseId, loadView, wrapper };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rollup target database loading', () => {
  it('loads selector observer metadata without page row data', async () => {
    const { getViewIdFromDatabaseId, loadView, wrapper } = createFixture();

    jest.spyOn(rollupCache, 'readRollupCell').mockResolvedValue({ value: '' });
    renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), { wrapper });

    await waitFor(() => {
      expect(getViewIdFromDatabaseId).toHaveBeenCalled();
      expect(loadView).toHaveBeenCalledWith(relatedViewId, false, false, {
        databaseId: relatedDatabaseId,
        databaseMetadataOnly: true,
      });
    });
    expect(loadView).toHaveBeenCalledTimes(1);
  });

  it('loads sort-triggered observer metadata without page row data', async () => {
    const { loadView, wrapper } = createFixture();

    renderHook(() => useRollupFieldObservers(jest.fn(), 0), { wrapper });

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith(relatedViewId, false, false, {
        databaseId: relatedDatabaseId,
        databaseMetadataOnly: true,
      });
    });
    expect(loadView).toHaveBeenCalledTimes(1);
  });
});
