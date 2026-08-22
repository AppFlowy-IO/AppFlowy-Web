import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { useUpdateRelationCell } from '@/application/database-yjs/dispatch/relation';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import {
  getOrCreateDatabaseHistoryManager,
  runDatabaseAction,
  useDatabaseHistory,
} from '@/application/database-yjs/history';
import {
  type YDatabase,
  type YDatabaseCell,
  type YDatabaseField,
  type YDatabaseFields,
  type YDatabaseRow,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  type YSharedRoot,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'field-id';

type Fixture = {
  database: YDatabase;
  databaseDoc: YDoc;
  rowDoc: YDoc;
};

type CellCase = {
  fieldType: FieldType;
  initialValue: string;
  isPrimary?: boolean;
  label: string;
  updatedValue: string;
};

const committedCellCases: CellCase[] = [
  {
    fieldType: FieldType.RichText,
    initialValue: 'Old title',
    isPrimary: true,
    label: 'title',
    updatedValue: 'New title',
  },
  {
    fieldType: FieldType.RichText,
    initialValue: 'Old text',
    label: 'RichText',
    updatedValue: 'New text',
  },
  { fieldType: FieldType.Number, initialValue: '1', label: 'number', updatedValue: '42' },
  {
    fieldType: FieldType.URL,
    initialValue: 'https://old.example',
    label: 'URL',
    updatedValue: 'https://new.example',
  },
  { fieldType: FieldType.Checkbox, initialValue: 'No', label: 'checkbox', updatedValue: 'Yes' },
  {
    fieldType: FieldType.SingleSelect,
    initialValue: 'option-a',
    label: 'single select',
    updatedValue: 'option-b',
  },
  {
    fieldType: FieldType.MultiSelect,
    initialValue: 'option-a',
    label: 'multi select',
    updatedValue: 'option-a,option-b',
  },
  {
    fieldType: FieldType.Checklist,
    initialValue: '[{"id":"a","name":"Old","completed":false}]',
    label: 'checklist',
    updatedValue: '[{"id":"a","name":"Old","completed":true}]',
  },
  {
    fieldType: FieldType.DateTime,
    initialValue: '1700000000',
    label: 'date',
    updatedValue: '1800000000',
  },
  {
    fieldType: FieldType.Person,
    initialValue: 'person-a',
    label: 'person',
    updatedValue: 'person-b',
  },
  {
    fieldType: FieldType.Media,
    initialValue: '[{"id":"old-file"}]',
    label: 'media',
    updatedValue: '[{"id":"new-file"}]',
  },
  {
    fieldType: FieldType.Summary,
    initialValue: 'Old manual summary',
    label: 'manually edited AI summary',
    updatedValue: 'New manual summary',
  },
  {
    fieldType: FieldType.Translate,
    initialValue: 'Old manual translation',
    label: 'manually edited AI translation',
    updatedValue: 'New manual translation',
  },
];

function createField(fieldType: FieldType, isPrimary: boolean): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, isPrimary ? 'Name' : 'Field');
  field.set(YjsDatabaseKey.type, fieldType);
  field.set(YjsDatabaseKey.is_primary, isPrimary);
  return field;
}

function createFixture(testCase: CellCase): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  fields.set(fieldId, createField(testCase.fieldType, testCase.isPrimary ?? false));
  view.set(YjsDatabaseKey.id, viewId);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc(rowId, databaseId, {
    [fieldId]: createCell(testCase.fieldType, testCase.initialValue),
  });

  return { database, databaseDoc, rowDoc };
}

function createWrapper(fixture: Fixture) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: { [rowId]: fixture.rowDoc },
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

function useCellHistory() {
  const updateCell = useUpdateCellDispatch(rowId, fieldId);
  const history = useDatabaseHistory();

  return { history, updateCell };
}

function getCell(fixture: Fixture): YDatabaseCell {
  const row = fixture.rowDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId);
}

describe('committed cell production hooks use database history', () => {
  it.each(committedCellCases)('undoes and redoes a committed $label value', async (testCase) => {
    const fixture = createFixture(testCase);
    const { result } = renderHook(useCellHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateCell(testCase.updatedValue));
    await waitFor(() => {
      expect(getCell(fixture).get(YjsDatabaseKey.data)).toBe(testCase.updatedValue);
    });

    act(() => result.current.history.undo());
    expect(getCell(fixture).get(YjsDatabaseKey.data)).toBe(testCase.initialValue);

    act(() => result.current.history.redo());
    expect(getCell(fixture).get(YjsDatabaseKey.data)).toBe(testCase.updatedValue);
  });

  it('skips generic and specialized Relation writes while preserving redo', async () => {
    const fixture = createFixture({
      fieldType: FieldType.Relation,
      initialValue: '',
      label: 'Relation',
      updatedValue: '',
    });
    const relationField = createRelationField(fieldId, {
      database_id: 'related-database-id',
      is_two_way: false,
      source_limit: RelationLimit.NoLimit,
      target_limit: RelationLimit.NoLimit,
    });
    const initialRelationData = new Y.Array<string>();

    initialRelationData.push(['related-row-a']);
    fixture.database.get(YjsDatabaseKey.fields).set(fieldId, relationField);
    getCell(fixture).set(YjsDatabaseKey.data, initialRelationData);

    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    runDatabaseAction(fixture.databaseDoc, { type: 'database.test-marker' }, () => {
      fixture.database.set('history-marker', true);
    });
    history.undo();
    expect(history.canRedo()).toBe(true);

    const { result } = renderHook(
      () => ({
        updateGenericCell: useUpdateCellDispatch(rowId, fieldId),
        updateRelationCell: useUpdateRelationCell(rowId, fieldId),
      }),
      { wrapper: createWrapper(fixture) }
    );
    const genericRelationData = new Y.Array<string>();

    genericRelationData.push(['related-row-b']);
    act(() => result.current.updateGenericCell(genericRelationData));
    await waitFor(() => {
      expect((getCell(fixture).get(YjsDatabaseKey.data) as Y.Array<string>).toArray()).toEqual(['related-row-b']);
    });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    await act(async () => {
      await result.current.updateRelationCell({ insertedRowIds: ['related-row-c'] });
    });
    expect((getCell(fixture).get(YjsDatabaseKey.data) as Y.Array<string>).toArray()).toEqual([
      'related-row-b',
      'related-row-c',
    ]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    void act(() => {
      history.redo();
    });
    expect(fixture.database.get('history-marker')).toBe(true);
    expect((getCell(fixture).get(YjsDatabaseKey.data) as Y.Array<string>).toArray()).toEqual([
      'related-row-b',
      'related-row-c',
    ]);
  });
});
