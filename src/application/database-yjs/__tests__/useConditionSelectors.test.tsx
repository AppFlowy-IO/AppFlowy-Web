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
import { DatabaseViewOverlayContext } from '@/application/database-yjs/context';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
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

  it('returns the requested sort id when the id changes to an identical sort', () => {
    const fixture = createConditionFixture();
    const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;

    sorts.push([createSort('sort-a', firstFieldId), createSort('sort-b', firstFieldId)]);
    fixture.view.set(YjsDatabaseKey.sorts, sorts);

    const { result, rerender } = renderHook(({ sortId }) => useSortSelector(sortId), {
      initialProps: { sortId: 'sort-a' },
      wrapper: createWrapper(fixture),
    });

    expect(result.current?.id).toBe('sort-a');
    rerender({ sortId: 'sort-b' });
    expect(result.current?.id).toBe('sort-b');
  });
});

describe('condition selectors over a viewer overlay', () => {
  function createOverlayFixture() {
    const fixture = createConditionFixture();
    const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
    const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

    sorts.push([createSort('sort-1', firstFieldId), createSort('sort-2', secondFieldId)]);
    filters.push([createTextFilter('filter-1', firstFieldId), createTextFilter('filter-2', secondFieldId)]);
    fixture.view.set(YjsDatabaseKey.sorts, sorts);
    fixture.view.set(YjsDatabaseKey.filters, filters);

    const overlay = createViewConditionsOverlay(fixture.view);
    const DatabaseWrapper = createWrapper(fixture);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseViewOverlayContext.Provider value={overlay.view}>
        <DatabaseWrapper>{children}</DatabaseWrapper>
      </DatabaseViewOverlayContext.Provider>
    );

    return {
      overlay,
      wrapper,
      localSorts: overlay.view.get(YjsDatabaseKey.sorts),
      localFilters: overlay.view.get(YjsDatabaseKey.filters),
    };
  }

  function replaceAt<T>(array: Y.Array<T>, index: number, value: T) {
    array.doc?.transact(() => {
      array.delete(index, 1);
      array.insert(index, [value]);
    });
  }

  it('updates a sort whose map is replaced by a copy with the same id', () => {
    const { overlay, wrapper, localSorts } = createOverlayFixture();
    const { result } = renderHook(() => useSortSelector('sort-1'), { wrapper });
    const replacement = createSort('sort-1', firstFieldId);

    expect(result.current?.condition).toBe(SortCondition.Ascending);
    replacement.set(YjsDatabaseKey.condition, SortCondition.Descending);
    act(() => replaceAt(localSorts, 0, replacement));
    expect(result.current?.condition).toBe(SortCondition.Descending);

    act(() => {
      replacement.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    });
    expect(result.current?.condition).toBe(SortCondition.Ascending);
    overlay.destroy();
  });

  it('follows a reset that puts back copies of the shared sorts', () => {
    const { overlay, wrapper, localSorts } = createOverlayFixture();
    const { result } = renderHook(() => ({ first: useSortSelector('sort-1'), second: useSortSelector('sort-2') }), {
      wrapper,
    });
    const moved = createSort('sort-1', firstFieldId);

    // The viewer flips sort-1 and moves it last; a reorder copies the map.
    moved.set(YjsDatabaseKey.condition, SortCondition.Descending);
    act(() => {
      localSorts.doc?.transact(() => {
        localSorts.delete(0, 1);
        localSorts.push([moved]);
      });
    });
    expect(result.current.first?.condition).toBe(SortCondition.Descending);

    act(() => overlay.reset());
    expect(localSorts.get(0)).not.toBe(moved);
    expect(result.current.first?.condition).toBe(SortCondition.Ascending);
    expect(result.current.second?.fieldId).toBe(secondFieldId);
    overlay.destroy();
  });

  it('updates a filter whose map is replaced, and after a reset', () => {
    const { overlay, wrapper, localFilters } = createOverlayFixture();
    const { result } = renderHook(() => useFilterSelector('filter-1'), { wrapper });
    const replacement = createTextFilter('filter-1', firstFieldId);

    expect(result.current?.content).toBe('match');
    replacement.set(YjsDatabaseKey.content, 'mine');
    act(() => replaceAt(localFilters, 0, replacement));
    expect(result.current?.content).toBe('mine');

    const current = result.current;

    // Another filter's edit keeps this value, and its chip, as they are.
    act(() => {
      localFilters.get(1).set(YjsDatabaseKey.content, 'other');
    });
    expect(result.current).toBe(current);

    act(() => overlay.reset());
    expect(result.current?.content).toBe('match');
    overlay.destroy();
  });

  it('reads a plain filter synced from desktop', () => {
    const fixture = createConditionFixture();
    const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

    fixture.view.set(YjsDatabaseKey.filters, filters);
    filters.push([
      {
        id: 'desktop-filter',
        field_id: firstFieldId,
        filter_type: FilterType.Data,
        condition: TextFilterCondition.TextContains,
        content: 'desktop',
      } as unknown as YDatabaseFilter,
    ]);
    const { result } = renderHook(() => useFilterSelector('desktop-filter'), { wrapper: createWrapper(fixture) });

    expect(result.current).toMatchObject({ fieldId: firstFieldId, content: 'desktop' });
  });
});
