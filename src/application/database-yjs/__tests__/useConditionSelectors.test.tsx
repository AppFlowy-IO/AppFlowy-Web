import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  SortCondition,
  TextFilterCondition,
  useFiltersSelector,
  useFilterSelector,
  useSortsSelector,
  useSortSelector,
} from '@/application/database-yjs';
import {
  RowId,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

type ConditionFixture = {
  databaseDoc: YDoc;
  fields: Y.Map<YDatabaseField>;
  view: YDatabaseView;
  viewId: string;
};

const firstFieldId = 'first-field';
const secondFieldId = 'second-field';

function createTextField(fieldId: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

function createTextFilter(id: string, fieldId: string) {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, id);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
  filter.set(YjsDatabaseKey.content, 'match');
  filter.set(YjsDatabaseKey.type, FieldType.RichText);

  return filter;
}

function createSort(id: string, fieldId: string) {
  const sort = new Y.Map() as YDatabaseSort;

  sort.set(YjsDatabaseKey.id, id);
  sort.set(YjsDatabaseKey.field_id, fieldId);
  sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);

  return sort;
}

function createConditionFixture(): ConditionFixture {
  const viewId = 'view-id';
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map();
  const view = new Y.Map() as YDatabaseView;

  fields.set(firstFieldId, createTextField(firstFieldId));
  fields.set(secondFieldId, createTextField(secondFieldId));
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return {
    databaseDoc,
    fields,
    view,
    viewId,
  };
}

function createWrapper(fixture: ConditionFixture, contextOverrides: Partial<DatabaseContextState> = {}) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: fixture.databaseDoc,
    databasePageId: fixture.viewId,
    activeViewId: fixture.viewId,
    rowMap: {} as Record<RowId, YDoc>,
    workspaceId: 'workspace-id',
    ...contextOverrides,
  };

  return ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('database condition selectors', () => {
  it('observes a filters array created after mount', async () => {
    const fixture = createConditionFixture();
    const { result } = renderHook(() => useFiltersSelector(), {
      wrapper: createWrapper(fixture),
    });

    expect(result.current).toEqual([]);

    const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

    act(() => {
      fixture.view.set(YjsDatabaseKey.filters, filters);
      filters.push([createTextFilter('filter-id', firstFieldId)]);
    });

    await waitFor(() => {
      expect(result.current).toEqual([{ id: 'filter-id', fieldId: firstFieldId }]);
    });
  });

  it('updates filter selectors when the filter field changes', async () => {
    const fixture = createConditionFixture();
    const filter = createTextFilter('filter-id', firstFieldId);
    const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

    filters.push([filter]);
    fixture.view.set(YjsDatabaseKey.filters, filters);

    const { result: filterListResult } = renderHook(() => useFiltersSelector(), {
      wrapper: createWrapper(fixture),
    });
    const { result: filterResult } = renderHook(() => useFilterSelector('filter-id'), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(filterListResult.current).toEqual([{ id: 'filter-id', fieldId: firstFieldId }]);
      expect(filterResult.current?.fieldId).toBe(firstFieldId);
    });

    act(() => {
      filter.set(YjsDatabaseKey.field_id, secondFieldId);
    });

    await waitFor(() => {
      expect(filterListResult.current).toEqual([{ id: 'filter-id', fieldId: secondFieldId }]);
      expect(filterResult.current?.fieldId).toBe(secondFieldId);
    });
  });

  it('observes a sorts array created after mount', async () => {
    const fixture = createConditionFixture();
    const { result } = renderHook(() => useSortsSelector(), {
      wrapper: createWrapper(fixture),
    });

    expect(result.current).toEqual([]);

    const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;

    act(() => {
      fixture.view.set(YjsDatabaseKey.sorts, sorts);
      sorts.push([createSort('sort-id', firstFieldId)]);
    });

    await waitFor(() => {
      expect(result.current).toEqual([{ id: 'sort-id', fieldId: firstFieldId }]);
    });
  });

  it('updates sort selectors when the sort field changes', async () => {
    const fixture = createConditionFixture();
    const sort = createSort('sort-id', firstFieldId);
    const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;

    sorts.push([sort]);
    fixture.view.set(YjsDatabaseKey.sorts, sorts);

    const { result: sortListResult } = renderHook(() => useSortsSelector(), {
      wrapper: createWrapper(fixture),
    });
    const { result: sortResult } = renderHook(() => useSortSelector('sort-id'), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(sortListResult.current).toEqual([{ id: 'sort-id', fieldId: firstFieldId }]);
      expect(sortResult.current?.fieldId).toBe(firstFieldId);
    });

    act(() => {
      sort.set(YjsDatabaseKey.field_id, secondFieldId);
    });

    await waitFor(() => {
      expect(sortListResult.current).toEqual([{ id: 'sort-id', fieldId: secondFieldId }]);
      expect(sortResult.current?.fieldId).toBe(secondFieldId);
    });
  });
});
