import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { YDatabase, YDatabaseField, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useRollupData } from './useRollupData';

const mockUpdateRollupTypeOption = jest.fn();
const mockLoadView = jest.fn();
const mockGetViewIdFromDatabaseId = jest.fn();
let baseDatabase: YDatabase;
let rollupField: YDatabaseField;
let relatedDoc: YDoc;

jest.mock('@/application/database-yjs/context', () => ({
  useDatabase: () => baseDatabase,
  useDatabaseContext: () => ({
    loadView: mockLoadView,
    getViewIdFromDatabaseId: mockGetViewIdFromDatabaseId,
  }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateRollupTypeOption: () => mockUpdateRollupTypeOption,
}));

jest.mock('@/application/database-yjs/selector', () => ({
  useFieldSelector: () => ({ field: rollupField, clock: 0 }),
}));

function createTargetField(id: string, type: FieldType) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, type);
  return field;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function setupDocuments() {
  const baseDoc = new Y.Doc();
  const baseRoot = baseDoc.getMap(YjsEditorKey.data_section);
  const fields = new Y.Map() as YDatabaseFields;
  const relationField = createRelationField('relation', { database_id: 'related-database', name: 'Projects' });

  rollupField = createRollupField('rollup');
  fields.set('relation', relationField);
  fields.set('rollup', rollupField);
  baseDatabase = new Y.Map() as YDatabase;
  baseDatabase.set(YjsDatabaseKey.fields, fields);
  baseRoot.set(YjsEditorKey.database, baseDatabase);

  relatedDoc = new Y.Doc({ guid: 'related-database' }) as YDoc;
  const relatedRoot = relatedDoc.getMap(YjsEditorKey.data_section);
  const relatedDatabase = new Y.Map() as YDatabase;
  const relatedFields = new Y.Map() as YDatabaseFields;

  relatedFields.set('Amount', createTargetField('Amount', FieldType.Number));
  relatedFields.set('Name', createTargetField('Name', FieldType.RichText));
  relatedDatabase.set(YjsDatabaseKey.fields, relatedFields);
  relatedRoot.set(YjsEditorKey.database, relatedDatabase);

  mockGetViewIdFromDatabaseId.mockResolvedValue('related-view');
  mockLoadView.mockResolvedValue(relatedDoc);
}

describe('useRollupData Desktop interactions', () => {
  beforeEach(() => {
    mockUpdateRollupTypeOption.mockReset();
    mockLoadView.mockReset();
    mockGetViewIdFromDatabaseId.mockReset();
    setupDocuments();
    mockUpdateRollupTypeOption.mockImplementation((updates: Record<string, unknown>) => {
      const typeOption = rollupField.get(YjsDatabaseKey.type_option).get(String(FieldType.Rollup));

      if (updates.relation_field_id !== undefined) {
        typeOption.set(YjsDatabaseKey.relation_field_id, updates.relation_field_id);
      }

      if (updates.target_field_id !== undefined) {
        typeOption.set(YjsDatabaseKey.target_field_id, updates.target_field_id);
      }

      if (updates.calculation_type !== undefined) {
        typeOption.set(YjsDatabaseKey.calculation_type, updates.calculation_type);
      }
    });
  });

  it('automatically selects the first target after a relation is selected', async () => {
    const { result } = renderHook(() => useRollupData('rollup'));

    await waitFor(() => expect(result.current.relationFields).toHaveLength(1));
    await act(async () => {
      await result.current.selectRelationField(result.current.relationFields[0]);
    });

    expect(mockUpdateRollupTypeOption).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        relation_field_id: 'relation',
        target_field_id: '',
        calculation_type: CalculationType.Count,
        visualization_type: 0,
      })
    );
    expect(mockUpdateRollupTypeOption).toHaveBeenNthCalledWith(2, {
      target_field_id: 'Amount',
      calculation_type: CalculationType.Count,
      condition_value: '',
    });
  });

  it('does not overwrite a target selected while automatic selection is loading', async () => {
    const deferredLoad = createDeferred<YDoc | null>();

    mockLoadView.mockReturnValue(deferredLoad.promise);
    const { result } = renderHook(() => useRollupData('rollup'));

    await waitFor(() => expect(result.current.relationFields).toHaveLength(1));
    await act(async () => {
      const selection = result.current.selectRelationField(result.current.relationFields[0]);
      const typeOption = rollupField.get(YjsDatabaseKey.type_option).get(String(FieldType.Rollup));

      typeOption.set(YjsDatabaseKey.target_field_id, 'Name');
      deferredLoad.resolve(relatedDoc);
      await selection;
    });

    expect(mockUpdateRollupTypeOption).toHaveBeenCalledTimes(1);
    expect(
      rollupField.get(YjsDatabaseKey.type_option).get(String(FieldType.Rollup)).get(YjsDatabaseKey.target_field_id)
    ).toBe('Name');
  });

  it('resets an unsupported calculation and visualization when a non-number target is selected', async () => {
    const typeOption = rollupField.get(YjsDatabaseKey.type_option).get(String(FieldType.Rollup));

    typeOption.set(YjsDatabaseKey.calculation_type, CalculationType.Sum);
    const { result } = renderHook(() => useRollupData('rollup'));
    const nameField = createTargetField('Name', FieldType.RichText);

    act(() => {
      result.current.selectTargetField({ id: 'Name', name: 'Name', type: FieldType.RichText, field: nameField });
    });

    expect(mockUpdateRollupTypeOption).toHaveBeenCalledWith({
      target_field_id: 'Name',
      calculation_type: CalculationType.Count,
      condition_value: '',
      visualization_type: 0,
    });
  });
});
