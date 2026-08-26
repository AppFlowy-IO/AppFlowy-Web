import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  NumberFilterCondition,
  SortCondition,
  TextFilterCondition,
  useFieldCellsByRowsSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { CalculationType } from '@/application/database-yjs/database.type';
import {
  useAddAdvancedFilterAndRebuild,
  useCalculateFieldDispatch,
  useUpdateAdvancedFilter,
} from '@/application/database-yjs/dispatch';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import * as databaseFilter from '@/application/database-yjs/filter';
import * as rollupCache from '@/application/database-yjs/rollup/cache';
import * as rowOrderVisibility from '@/application/database-yjs/row-order-visibility';
import {
  RowId,
  YDatabase,
  YDatabaseCalculation,
  YDatabaseCalculations,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseMetas,
  YDatabaseRowOrders,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

type DatabaseFixture = {
  database: YDatabase;
  databaseDoc: YDoc;
  fields: Y.Map<YDatabaseField>;
  filters: YDatabaseFilters;
  rowMap: Record<RowId, YDoc>;
  rowOrders: YDatabaseRowOrders;
  sorts: YDatabaseSorts;
  view: YDatabaseView;
  viewId: string;
  views: YDatabaseViews;
};

const databaseId = 'database-id';
const fieldId = 'description-field';

function createTextField() {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Description');
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

function createTextFilter(content: string, id = 'filter-id') {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, id);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
  filter.set(YjsDatabaseKey.content, content);

  return filter;
}

function createDatabaseFixture(): DatabaseFixture {
  const viewId = 'view-id';
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;

  fields.set(fieldId, createTextField());
  rowOrders.push([
    { id: 'row-c', height: 44 },
    { id: 'row-a', height: 44 },
    { id: 'row-b', height: 44 },
  ]);

  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return {
    database,
    databaseDoc,
    fields,
    filters,
    rowMap: {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'match first'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'match second'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'skip'),
      }),
    },
    rowOrders,
    sorts,
    view,
    viewId,
    views,
  };
}

function addInlineView(fixture: DatabaseFixture, rows: Array<{ id: RowId; height: number; is_deleted?: boolean }>) {
  const inlineViewId = 'inline-view-id';
  const inlineView = new Y.Map() as YDatabaseView;
  const inlineRowOrders = new Y.Array() as YDatabaseRowOrders;
  const metas = new Y.Map() as YDatabaseMetas;

  inlineRowOrders.push(rows);
  inlineView.set(YjsDatabaseKey.is_inline, true);
  inlineView.set(YjsDatabaseKey.row_orders, inlineRowOrders);
  fixture.views.set(inlineViewId, inlineView);
  metas.set(YjsDatabaseKey.iid, inlineViewId);
  fixture.database.set(YjsDatabaseKey.metas, metas);

  return inlineRowOrders;
}

function createWrapper(fixture: DatabaseFixture, contextOverrides: Partial<DatabaseContextState> = {}) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: fixture.databaseDoc,
    databasePageId: fixture.viewId,
    activeViewId: fixture.viewId,
    rowMap: fixture.rowMap,
    workspaceId: 'workspace-id',
    ...contextOverrides,
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useRowOrdersSelector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not expose stale row order after a filter is applied', async () => {
    const fixture = createDatabaseFixture();
    const renderedOrders: Array<string[] | undefined> = [];
    const { result } = renderHook(
      () => {
        const rows = useRowOrdersSelector();

        renderedOrders.push(rows?.map((row) => row.id));
        return rows;
      },
      {
        wrapper: createWrapper(fixture),
      }
    );

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    const renderCountBeforeFilter = renderedOrders.length;

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    const ordersRenderedAfterFilter = renderedOrders.slice(renderCountBeforeFilter);

    expect(ordersRenderedAfterFilter).not.toContainEqual(['row-c', 'row-a', 'row-b']);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    });
  });

  it('keeps current rows visible when a blank filter is created', async () => {
    const fixture = createDatabaseFixture();
    const filterBySpy = jest.spyOn(databaseFilter, 'filterBy');
    const renderedOrders: Array<string[] | undefined> = [];
    const { result } = renderHook(
      () => {
        const rows = useRowOrdersSelector();

        renderedOrders.push(rows?.map((row) => row.id));
        return rows;
      },
      {
        wrapper: createWrapper(fixture),
      }
    );

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    filterBySpy.mockClear();
    const renderCountBeforeFilter = renderedOrders.length;
    const rowsBeforeFilter = result.current;

    act(() => {
      fixture.filters.push([createTextFilter('')]);
    });

    expect(result.current).toBe(rowsBeforeFilter);
    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    expect(renderedOrders.slice(renderCountBeforeFilter)).not.toContain(undefined);
    expect(filterBySpy).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    expect(filterBySpy).not.toHaveBeenCalled();
    filterBySpy.mockRestore();
  });

  it('reacts when a blank inline filter receives its debounced content', async () => {
    const fixture = createDatabaseFixture();
    const filter = createTextFilter('');
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([filter]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);

    act(() => {
      filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
    });

    act(() => {
      filter.set(YjsDatabaseKey.content, 'match');
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    });
  });

  it('computes each filter change once', async () => {
    const fixture = createDatabaseFixture();
    const filterBySpy = jest.spyOn(databaseFilter, 'filterBy');
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    filterBySpy.mockClear();

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    expect(filterBySpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(filterBySpy).toHaveBeenCalledTimes(1);
    filterBySpy.mockRestore();
  });

  it('refreshes computed condition fields when an existing sort switches fields', async () => {
    const fixture = createDatabaseFixture();
    const rollupFieldId = 'rollup-field';
    const rollupField = createRollupField(rollupFieldId);
    const sort = new Y.Map() as YDatabaseSort;

    rollupField.set(YjsDatabaseKey.type, FieldType.Rollup);
    fixture.fields.set(rollupFieldId, rollupField);
    sort.set(YjsDatabaseKey.id, 'sort-id');
    sort.set(YjsDatabaseKey.field_id, rollupFieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    fixture.sorts.push([sort]);

    const invalidateRollupSpy = jest.spyOn(rollupCache, 'invalidateRollupCell');
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toHaveLength(3);
    });

    act(() => {
      sort.set(YjsDatabaseKey.field_id, fieldId);
    });
    invalidateRollupSpy.mockClear();

    act(() => {
      const row = fixture.rowMap['row-a']
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get(fieldId)?.set(YjsDatabaseKey.data, 'changed');
    });

    expect(invalidateRollupSpy).not.toHaveBeenCalledWith(`row-a:${rollupFieldId}`);
    invalidateRollupSpy.mockRestore();
  });

  it('applies conditions that do not require an input value', async () => {
    const fixture = createDatabaseFixture();
    const emptyFilter = createTextFilter('');

    emptyFilter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIsEmpty);

    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([emptyFilter]);
    });

    expect(result.current).toEqual([]);
  });

  it('updates unconditioned row order immediately when rows are added or removed', async () => {
    const fixture = createDatabaseFixture();
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.rowOrders.insert(1, [{ id: 'row-new', height: 44 }]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-new', 'row-a', 'row-b']);

    act(() => {
      fixture.rowOrders.delete(0);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-new', 'row-a', 'row-b']);
  });

  it('updates linked-view visibility immediately when the inline tombstone changes', async () => {
    const fixture = createDatabaseFixture();
    const inlineRowOrders = addInlineView(fixture, fixture.rowOrders.toJSON());
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      const rowAIndex = inlineRowOrders.toJSON().findIndex(({ id }) => id === 'row-a');
      const rowA = inlineRowOrders.get(rowAIndex);

      fixture.databaseDoc.transact(() => {
        inlineRowOrders.delete(rowAIndex);
        inlineRowOrders.insert(rowAIndex, [{ ...rowA, is_deleted: true }]);
      });
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-b']);

    act(() => {
      const rowAIndex = inlineRowOrders.toJSON().findIndex(({ id }) => id === 'row-a');
      const rowA = inlineRowOrders.get(rowAIndex);

      fixture.databaseDoc.transact(() => {
        inlineRowOrders.delete(rowAIndex);
        inlineRowOrders.insert(rowAIndex, [{ ...rowA, is_deleted: false }]);
      });
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
  });

  it('reconciles all-view row-order changes once per Yjs transaction', async () => {
    const fixture = createDatabaseFixture();
    const inlineRowOrders = addInlineView(fixture, fixture.rowOrders.toJSON());
    const materializeSpy = jest.spyOn(rowOrderVisibility, 'materializeVisibleRowOrders');
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    materializeSpy.mockClear();

    act(() => {
      fixture.databaseDoc.transact(() => {
        const row = { id: 'row-new', height: 44 };

        fixture.rowOrders.push([row]);
        inlineRowOrders.push([row]);
      });
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b', 'row-new']);
    expect(materializeSpy).toHaveBeenCalledTimes(1);
    materializeSpy.mockRestore();
  });

  it('renders a duplicate row-order ID once and keeps its last value', async () => {
    const fixture = createDatabaseFixture();
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.rowOrders.push([{ id: 'row-a', height: 72 }]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    expect(result.current?.find((row) => row.id === 'row-a')?.height).toBe(72);
  });

  it('resubscribes when the row order array is replaced', async () => {
    const fixture = createDatabaseFixture();
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    const replacementRowOrders = new Y.Array<{ id: RowId; height: number }>() as YDatabaseRowOrders;

    replacementRowOrders.push([{ id: 'row-replacement', height: 44 }]);

    act(() => {
      fixture.view.set(YjsDatabaseKey.row_orders, replacementRowOrders);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-replacement']);
    });

    act(() => {
      replacementRowOrders.push([{ id: 'row-new', height: 44 }]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-replacement', 'row-new']);
  });

  it('does not publish raw row order immediately when filters are active', async () => {
    const fixture = createDatabaseFixture();
    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    });

    act(() => {
      fixture.rowOrders.insert(0, [{ id: 'row-new', height: 44 }]);
    });

    expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
  });

  it('prunes a deleted row and updates calculations while another conditioned row is still hydrating', async () => {
    const fixture = createDatabaseFixture();
    const ensureRow = jest.fn(() => new Promise<YDoc | undefined>(() => undefined));
    const calculation = new Y.Map() as YDatabaseCalculation;
    const calculations = new Y.Array() as YDatabaseCalculations;

    calculation.set(YjsDatabaseKey.id, 'calculation-id');
    calculation.set(YjsDatabaseKey.field_id, fieldId);
    calculation.set(YjsDatabaseKey.type, CalculationType.Count);
    calculation.set(YjsDatabaseKey.calculation_value, 0);
    calculations.push([calculation]);
    fixture.view.set(YjsDatabaseKey.calculations, calculations);

    const { result } = renderHook(
      () => {
        const rows = useRowOrdersSelector();
        const { cells } = useFieldCellsByRowsSelector(fieldId, rows);
        const calculate = useCalculateFieldDispatch(fieldId);

        useEffect(() => {
          if (cells) {
            calculate(cells);
          }
        }, [calculate, cells]);

        return rows;
      },
      {
        wrapper: createWrapper(fixture, { ensureRow }),
      }
    );

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe(3);
    });

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe(2);
    });

    act(() => {
      fixture.rowOrders.push([{ id: 'row-hydrating', height: 44 }]);
      jest.advanceTimersByTime(250);
    });

    expect(ensureRow).toHaveBeenCalledWith('row-hydrating');
    expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);

    act(() => {
      const rowAIndex = fixture.rowOrders.toJSON().findIndex(({ id }) => id === 'row-a');

      fixture.rowOrders.delete(rowAIndex);
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-b']);
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe(1);
    });
  });

  it('requests missing row docs while a conditioned view is loading', async () => {
    const fixture = createDatabaseFixture();
    const ensureRow = jest.fn(async () => undefined);

    delete fixture.rowMap['row-a'];

    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture, { ensureRow }),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    expect(result.current).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ensureRow).toHaveBeenCalledWith('row-a');
    });
  });

  it('settles a conditioned view when a missing row cannot be hydrated', async () => {
    const fixture = createDatabaseFixture();
    const ensureRow = jest.fn(async () => undefined);

    delete fixture.rowMap['row-a'];

    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture, { ensureRow }),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    expect(result.current).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ensureRow).toHaveBeenCalledWith('row-a');
      expect(result.current?.map((row) => row.id)).toEqual(['row-b']);
    });
  });

  it('keeps a conditioned view loading while an opened row doc is still hydrating', async () => {
    const fixture = createDatabaseFixture();
    const emptyRowDoc = new Y.Doc() as unknown as YDoc;
    const ensureRow = jest.fn(async () => emptyRowDoc);

    fixture.rowMap['row-a'] = emptyRowDoc;

    const { result } = renderHook(() => useRowOrdersSelector(), {
      wrapper: createWrapper(fixture, { ensureRow }),
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    expect(result.current).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ensureRow).toHaveBeenCalledWith('row-a');
      expect(result.current).toBeUndefined();
    });

    const hydratedRowDoc = createRowDoc('row-a', databaseId, {
      [fieldId]: createCell(FieldType.RichText, 'match first'),
    });

    act(() => {
      Y.applyUpdate(emptyRowDoc, Y.encodeStateAsUpdate(hydratedRowDoc));
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    });
  });
});

describe('useUpdateAdvancedFilter', () => {
  it('updates a nested condition without replacing the filter tree', () => {
    const fixture = createDatabaseFixture();
    const root = new Y.Map() as YDatabaseFilter;
    const children = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
    const target = createTextFilter('match', 'filter-id');
    const sibling = createTextFilter('other', 'sibling-filter');

    root.set(YjsDatabaseKey.id, 'root-filter');
    root.set(YjsDatabaseKey.filter_type, FilterType.And);
    children.push([target, sibling]);
    root.set(YjsDatabaseKey.children, children);
    fixture.filters.push([root]);

    const { result } = renderHook(() => useUpdateAdvancedFilter(), {
      wrapper: createWrapper(fixture),
    });

    act(() => {
      result.current({
        filterId: 'filter-id',
        fieldId,
        condition: TextFilterCondition.TextDoesNotContain,
      });
    });

    expect(fixture.filters.get(0)).toBe(root);
    expect(root.get(YjsDatabaseKey.children)).toBe(children);
    expect(target.get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextDoesNotContain);
    expect(sibling.get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextContains);
  });

  it('preserves a numeric Rollup variant when a Desktop tree must be rebuilt', () => {
    const fixture = createDatabaseFixture();
    const rollupFieldId = 'rollup-field';
    const rollupField = new Y.Map() as YDatabaseField;

    rollupField.set(YjsDatabaseKey.id, rollupFieldId);
    rollupField.set(YjsDatabaseKey.name, 'Total');
    rollupField.set(YjsDatabaseKey.type, FieldType.Rollup);
    fixture.fields.set(rollupFieldId, rollupField);

    fixture.filters.push([
      {
        id: 'desktop-root',
        filter_type: FilterType.And,
        children: [
          {
            id: 'filter-id',
            field_id: fieldId,
            filter_type: FilterType.Data,
            ty: FieldType.RichText,
            condition: TextFilterCondition.TextContains,
            content: 'match',
          },
          {
            id: 'rollup-filter',
            field_id: rollupFieldId,
            filter_type: FilterType.Data,
            ty: FieldType.Rollup,
            condition: NumberFilterCondition.Equal,
            content: '10',
            rollup_target_ty: FieldType.Number,
          },
        ],
      } as unknown as YDatabaseFilter,
    ]);

    const { result } = renderHook(() => useUpdateAdvancedFilter(), {
      wrapper: createWrapper(fixture),
    });

    act(() => {
      result.current({
        filterId: 'filter-id',
        fieldId,
        condition: TextFilterCondition.TextIs,
      });
    });

    const rebuiltRoot = fixture.filters.get(0);
    const rebuiltChildren = rebuiltRoot.get(YjsDatabaseKey.children) as YDatabaseFilters;
    const rebuiltTextFilter = rebuiltChildren.get(0);
    const rebuiltRollupFilter = rebuiltChildren.get(1);

    expect(rebuiltTextFilter.get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextIs);
    expect(rebuiltRollupFilter.get(YjsDatabaseKey.rollup_target_type)).toBe(FieldType.Number);
  });

  it('ignores a delayed update targeting a previous field', () => {
    const fixture = createDatabaseFixture();
    const filter = createTextFilter('');

    fixture.filters.push([filter]);

    const { result } = renderHook(() => useUpdateAdvancedFilter(), {
      wrapper: createWrapper(fixture),
    });

    act(() => {
      filter.set(YjsDatabaseKey.field_id, 'replacement-field');
      result.current({
        filterId: 'filter-id',
        fieldId,
        content: 'stale value',
      });
    });

    expect(filter.get(YjsDatabaseKey.field_id)).toBe('replacement-field');
    expect(filter.get(YjsDatabaseKey.content)).toBe('');
  });
});

describe('useAddAdvancedFilterAndRebuild', () => {
  it('persists the numeric Rollup variant and Number default condition', () => {
    const fixture = createDatabaseFixture();
    const rollupFieldId = 'numeric-rollup-field';

    fixture.fields.set(rollupFieldId, createRollupField(rollupFieldId));

    const { result } = renderHook(() => useAddAdvancedFilterAndRebuild(), {
      wrapper: createWrapper(fixture),
    });

    act(() => {
      result.current(rollupFieldId);
    });

    const root = fixture.filters.get(0);
    const children = root.get(YjsDatabaseKey.children) as YDatabaseFilters;
    const rollupFilter = children.get(0);

    expect(rollupFilter.get(YjsDatabaseKey.condition)).toBe(NumberFilterCondition.Equal);
    expect(rollupFilter.get(YjsDatabaseKey.rollup_target_type)).toBe(FieldType.Number);
  });
});
