import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  RollupDisplayMode,
  useCellSelector,
} from '@/application/database-yjs';
import { TextFilterCondition } from '@/application/database-yjs/fields';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { useRollupFieldObservers } from '@/application/database-yjs/hooks/useRollupFieldObservers';
import * as rollupCache from '@/application/database-yjs/rollup/cache';
import {
  LoadView,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc, setRelationCellRowIds } from '../../__tests__/test-helpers';

import type { ReactNode } from 'react';

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
  const rollupOption = integratedRollupField?.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Rollup));

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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return { contextValue, getViewIdFromDatabaseId, loadView, relatedRowDoc, wrapper };
}

function setCellData(rowDoc: YDoc, fieldId: string, data: string) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
  const cell = row?.get(YjsDatabaseKey.cells)?.get(fieldId) as YDatabaseCell | undefined;

  cell?.set(YjsDatabaseKey.data, data);
}

function createNestedRelationRollupFixture(showAs: RollupDisplayMode, useNestedFilter = false) {
  const suffix = `${showAs}-${useNestedFilter ? 'filter' : 'cell'}`;
  const nestedDatabaseId = `nested-database-${suffix}`;
  const nestedViewId = `nested-view-${suffix}`;
  const nestedRowId = `nested-row-${suffix}`;
  const nestedNameFieldId = `nested-name-${suffix}`;
  const projectDatabaseId = `project-database-${suffix}`;
  const projectViewId = `project-view-${suffix}`;
  const projectRowId = `project-row-${suffix}`;
  const projectRelationFieldId = `project-relation-${suffix}`;
  const baseDatabaseId = `base-database-${suffix}`;
  const baseViewId = `base-view-${suffix}`;
  const baseRowId = `base-row-${suffix}`;
  const baseRelationFieldId = `base-relation-${suffix}`;
  const rollupFieldId = `rollup-${suffix}`;

  const nestedDoc = new Y.Doc({ guid: nestedViewId }) as YDoc;
  const nestedDatabase = new Y.Map() as YDatabase;
  const nestedFields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const nestedNameField = new Y.Map() as YDatabaseField;

  nestedNameField.set(YjsDatabaseKey.id, nestedNameFieldId);
  nestedNameField.set(YjsDatabaseKey.name, 'Name');
  nestedNameField.set(YjsDatabaseKey.type, FieldType.RichText);
  nestedNameField.set(YjsDatabaseKey.is_primary, true);
  nestedFields.set(nestedNameFieldId, nestedNameField);
  nestedDatabase.set(YjsDatabaseKey.id, nestedDatabaseId);
  nestedDatabase.set(YjsDatabaseKey.fields, nestedFields);
  nestedDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, nestedDatabase);

  const projectDoc = new Y.Doc({ guid: projectViewId }) as YDoc;
  const projectDatabase = new Y.Map() as YDatabase;
  const projectFields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const projectRelationField = createRelationField(projectRelationFieldId, {
    database_id: nestedDatabaseId,
  });

  projectFields.set(projectRelationFieldId, projectRelationField);
  projectDatabase.set(YjsDatabaseKey.id, projectDatabaseId);
  projectDatabase.set(YjsDatabaseKey.fields, projectFields);
  projectDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, projectDatabase);

  const baseDoc = new Y.Doc({ guid: baseViewId }) as YDoc;
  const baseDatabase = new Y.Map() as YDatabase;
  const baseFields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const baseRelationField = createRelationField(baseRelationFieldId, {
    database_id: projectDatabaseId,
  });
  const rollupField = createRollupField(rollupFieldId);

  baseFields.set(baseRelationFieldId, baseRelationField);
  baseFields.set(rollupFieldId, rollupField);
  views.set(baseViewId, view);
  baseDatabase.set(YjsDatabaseKey.id, baseDatabaseId);
  baseDatabase.set(YjsDatabaseKey.fields, baseFields);
  baseDatabase.set(YjsDatabaseKey.views, views);
  baseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, baseDatabase);

  const rollupOption = baseFields.get(rollupFieldId)?.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Rollup));

  rollupOption?.set(YjsDatabaseKey.relation_field_id, baseRelationFieldId);
  rollupOption?.set(YjsDatabaseKey.target_field_id, projectRelationFieldId);
  rollupOption?.set(YjsDatabaseKey.show_as, showAs);

  if (useNestedFilter) {
    const dataFilter = new Y.Map() as YDatabaseFilter;
    const nestedGroup = new Y.Map() as YDatabaseFilter;
    const rootGroup = new Y.Map() as YDatabaseFilter;
    const nestedChildren = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
    const rootChildren = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
    const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

    dataFilter.set(YjsDatabaseKey.id, `data-filter-${suffix}`);
    dataFilter.set(YjsDatabaseKey.field_id, rollupFieldId);
    dataFilter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    dataFilter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
    dataFilter.set(YjsDatabaseKey.content, 'Nested');
    nestedChildren.push([dataFilter]);
    nestedGroup.set(YjsDatabaseKey.id, `nested-group-${suffix}`);
    nestedGroup.set(YjsDatabaseKey.filter_type, FilterType.Or);
    nestedGroup.set(YjsDatabaseKey.children, nestedChildren);
    rootChildren.push([nestedGroup]);
    rootGroup.set(YjsDatabaseKey.id, `root-group-${suffix}`);
    rootGroup.set(YjsDatabaseKey.filter_type, FilterType.And);
    rootGroup.set(YjsDatabaseKey.children, rootChildren);
    filters.push([rootGroup]);
    view.set(YjsDatabaseKey.filters, filters);
  } else {
    const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.field_id, rollupFieldId);
    sorts.push([sort]);
    view.set(YjsDatabaseKey.sorts, sorts);
  }

  const baseRowDoc = createRowDoc(baseRowId, baseDatabaseId, {
    [baseRelationFieldId]: { fieldType: FieldType.Relation },
    [rollupFieldId]: { fieldType: FieldType.Rollup },
  });
  const projectRowDoc = createRowDoc(projectRowId, projectDatabaseId, {
    [projectRelationFieldId]: { fieldType: FieldType.Relation },
  });
  const nestedRowDoc = createRowDoc(nestedRowId, nestedDatabaseId, {
    [nestedNameFieldId]: { fieldType: FieldType.RichText, data: 'Nested one' },
  });

  setRelationCellRowIds(baseRowDoc, baseRelationFieldId, [projectRowId]);
  setRelationCellRowIds(projectRowDoc, projectRelationFieldId, [nestedRowId]);

  const docsByViewId = new Map([
    [projectViewId, projectDoc],
    [nestedViewId, nestedDoc],
  ]);
  const viewIdByDatabaseId = new Map([
    [projectDatabaseId, projectViewId],
    [nestedDatabaseId, nestedViewId],
  ]);
  const rowDocsById = new Map([
    [projectRowId, projectRowDoc],
    [nestedRowId, nestedRowDoc],
  ]);
  const loadView = jest.fn(async (viewId: string) => docsByViewId.get(viewId) ?? null) as jest.MockedFunction<LoadView>;
  const createRow = jest.fn(async (rowKey: string) => {
    const rowId = rowKey.split('_rows_').pop() ?? '';

    return rowDocsById.get(rowId) as YDoc;
  });
  const getViewIdFromDatabaseId = jest.fn(async (databaseId: string) => viewIdByDatabaseId.get(databaseId) ?? null);
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return {
    baseRelationFieldId,
    baseRowDoc,
    baseRowId,
    contextValue,
    nestedNameFieldId,
    nestedRowId,
    nestedRowDoc,
    projectDatabaseId,
    projectRelationFieldId,
    projectRowDoc,
    projectViewId,
    rowDocsById,
    rollupFieldId,
    wrapper,
  };
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

  it('handles selector observer setup rejections', async () => {
    const { contextValue, wrapper } = createFixture();
    const error = new Error('row observer failed');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    contextValue.createRow = jest.fn().mockRejectedValue(error);
    jest.spyOn(rollupCache, 'readRollupCell').mockResolvedValue({ value: '' });
    renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), { wrapper });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[Database] failed to set up rollup cell observers', error);
    });
  });

  it('handles condition observer setup rejections', async () => {
    const { contextValue, wrapper } = createFixture();
    const error = new Error('metadata observer failed');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    contextValue.loadView = jest.fn().mockRejectedValue(error);
    renderHook(() => useRollupFieldObservers(jest.fn(), 0), { wrapper });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[Database] failed to set up rollup condition observers', error);
    });
  });

  it('recomputes after observers attach when a related row changes during setup', async () => {
    const { contextValue, relatedRowDoc, wrapper } = createFixture();
    const originalCreateRow = contextValue.createRow;
    let resolveRow: ((doc: YDoc) => void) | undefined;

    contextValue.createRow = jest.fn(
      () =>
        new Promise<YDoc>((resolve) => {
          resolveRow = resolve;
        })
    );
    const observedValues: string[] = [];
    const readCurrentValue = () => {
      const row = relatedRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
      const cell = row?.get(YjsDatabaseKey.cells)?.get(targetFieldId);

      observedValues.push(String(cell?.get(YjsDatabaseKey.data) ?? ''));
    };

    readCurrentValue();
    renderHook(() => useRollupFieldObservers(readCurrentValue, 0), { wrapper });

    await waitFor(() => {
      expect(contextValue.createRow).toHaveBeenCalled();
      expect(resolveRow).toBeDefined();
    });

    act(() => {
      setCellData(relatedRowDoc, targetFieldId, 'Edited during observer setup');
      resolveRow?.(relatedRowDoc);
    });

    await waitFor(() => {
      expect(observedValues).toEqual(['Related value', 'Edited during observer setup']);
    });

    contextValue.createRow = originalCreateRow;
  });

  it('discovers rollups inside nested advanced filter groups and observes second-hop rows', async () => {
    const { nestedNameFieldId, nestedRowDoc, wrapper } = createNestedRelationRollupFixture(
      RollupDisplayMode.OriginalList,
      true
    );
    const onConditionsChange = jest.fn();

    renderHook(() => useRollupFieldObservers(onConditionsChange, 0), { wrapper });

    await waitFor(() => {
      expect(onConditionsChange).toHaveBeenCalled();
    });
    onConditionsChange.mockClear();

    act(() => {
      setCellData(nestedRowDoc, nestedNameFieldId, 'Nested two');
    });

    await waitFor(() => {
      expect(onConditionsChange).toHaveBeenCalled();
    });
  });

  it('does not rebuild nested condition observers for unrelated first-hop row edits', async () => {
    const { contextValue, projectRowDoc, wrapper } = createNestedRelationRollupFixture(
      RollupDisplayMode.OriginalList,
      true
    );
    const onConditionsChange = jest.fn();

    renderHook(() => useRollupFieldObservers(onConditionsChange, 0), { wrapper });

    await waitFor(() => {
      expect(onConditionsChange).toHaveBeenCalled();
    });
    const createRow = contextValue.createRow as jest.Mock;

    createRow.mockClear();
    onConditionsChange.mockClear();

    act(() => {
      const projectRow = projectRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

      projectRow?.set(YjsDatabaseKey.last_modified, Date.now());
    });

    await waitFor(() => {
      expect(onConditionsChange).toHaveBeenCalled();
    });
    expect(createRow).not.toHaveBeenCalled();
  });

  it('rebuilds nested condition observers when the target relation membership changes', async () => {
    const { contextValue, projectRelationFieldId, projectRowDoc, wrapper } = createNestedRelationRollupFixture(
      RollupDisplayMode.OriginalList,
      true
    );
    const onConditionsChange = jest.fn();

    renderHook(() => useRollupFieldObservers(onConditionsChange, 0), { wrapper });

    await waitFor(() => {
      expect(onConditionsChange).toHaveBeenCalled();
    });
    const createRow = contextValue.createRow as jest.Mock;

    createRow.mockClear();

    act(() => {
      setRelationCellRowIds(projectRowDoc, projectRelationFieldId, []);
    });

    await waitFor(() => {
      expect(createRow).toHaveBeenCalled();
    });
  });

  it('does not rebuild selector observers for unrelated first-hop row edits', async () => {
    const { baseRowId, contextValue, projectRowDoc, rollupFieldId, wrapper } = createNestedRelationRollupFixture(
      RollupDisplayMode.OriginalList
    );
    const readRollupCell = jest.spyOn(rollupCache, 'readRollupCell').mockResolvedValue({ value: '' });
    const createRow = contextValue.createRow as jest.Mock;
    const getViewIdFromDatabaseId = contextValue.getViewIdFromDatabaseId as jest.Mock;

    renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), { wrapper });

    await waitFor(() => {
      expect(createRow.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    getViewIdFromDatabaseId.mockClear();
    readRollupCell.mockClear();

    act(() => {
      const projectRow = projectRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

      projectRow?.set(YjsDatabaseKey.last_modified, Date.now());
    });

    await waitFor(() => {
      expect(readRollupCell).toHaveBeenCalled();
    });
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
  });

  it('bounds parallel selector observer row loads', async () => {
    const {
      baseRelationFieldId,
      baseRowDoc,
      baseRowId,
      contextValue,
      nestedRowId,
      projectDatabaseId,
      projectRelationFieldId,
      rowDocsById,
      rollupFieldId,
      wrapper,
    } = createNestedRelationRollupFixture(RollupDisplayMode.OriginalList);
    const relatedRowIds = Array.from({ length: 8 }, (_, index) => `project-row-pool-${index}`);

    relatedRowIds.forEach((rowId) => {
      const rowDoc = createRowDoc(rowId, projectDatabaseId, {
        [projectRelationFieldId]: { fieldType: FieldType.Relation },
      });

      setRelationCellRowIds(rowDoc, projectRelationFieldId, [nestedRowId]);
      rowDocsById.set(rowId, rowDoc);
    });
    setRelationCellRowIds(baseRowDoc, baseRelationFieldId, relatedRowIds);

    let activeLoads = 0;
    let maxActiveLoads = 0;
    const pendingResolutions: Array<() => void> = [];

    contextValue.createRow = jest.fn(
      (rowKey: string) =>
        new Promise<YDoc>((resolve) => {
          const rowId = rowKey.split('_rows_').pop() ?? '';

          activeLoads += 1;
          maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
          pendingResolutions.push(() => {
            activeLoads -= 1;
            resolve(rowDocsById.get(rowId) as YDoc);
          });
        })
    );
    const readRollupCell = jest.spyOn(rollupCache, 'readRollupCell').mockResolvedValue({ value: '' });
    const { unmount } = renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), { wrapper });

    await waitFor(() => {
      expect(pendingResolutions).toHaveLength(4);
    });
    expect(maxActiveLoads).toBe(4);

    readRollupCell.mockClear();
    unmount();
    await act(async () => {
      pendingResolutions.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    });
    expect(readRollupCell).not.toHaveBeenCalled();
  });

  it.each([RollupDisplayMode.OriginalList, RollupDisplayMode.UniqueList])(
    'updates %s rollups when a second-hop relation target label changes',
    async (showAs) => {
      const { baseRowId, nestedNameFieldId, nestedRowDoc, rollupFieldId, wrapper } =
        createNestedRelationRollupFixture(showAs);
      const { result } = renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current?.data).toBe('Nested one');
      });

      act(() => {
        setCellData(nestedRowDoc, nestedNameFieldId, 'Nested two');
      });

      await waitFor(() => {
        expect(result.current?.data).toBe('Nested two');
      });
    }
  );

  it('re-reads a cell after its asynchronous observer chain attaches', async () => {
    const {
      baseRowId,
      contextValue,
      nestedNameFieldId,
      nestedRowDoc,
      projectDatabaseId,
      projectViewId,
      rollupFieldId,
      wrapper,
    } = createNestedRelationRollupFixture(RollupDisplayMode.OriginalList);
    const originalGetViewId = contextValue.getViewIdFromDatabaseId;
    let resolveObserverLookup: ((viewId: string) => void) | undefined;
    let projectLookupCount = 0;

    contextValue.getViewIdFromDatabaseId = jest.fn((databaseId: string) => {
      if (databaseId === projectDatabaseId && projectLookupCount++ === 0) {
        return new Promise<string>((resolve) => {
          resolveObserverLookup = resolve;
        });
      }

      return originalGetViewId?.(databaseId) ?? Promise.resolve(null);
    });

    const { result } = renderHook(() => useCellSelector({ rowId: baseRowId, fieldId: rollupFieldId }), { wrapper });

    await waitFor(() => {
      expect(result.current?.data).toBe('Nested one');
      expect(resolveObserverLookup).toBeDefined();
    });

    act(() => {
      setCellData(nestedRowDoc, nestedNameFieldId, 'Edited before observers attached');
      resolveObserverLookup?.(projectViewId);
    });

    await waitFor(() => {
      expect(result.current?.data).toBe('Edited before observers attached');
    });
  });
});
