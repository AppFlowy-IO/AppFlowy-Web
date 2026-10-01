import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  type Row,
  type RowOrdersSnapshot,
  SelectOptionFilterCondition,
  SortCondition,
  useProgressiveRowOrdersSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRowOrders,
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

const databaseId = 'employees-database';
const viewId = 'hr-view';
const departmentFieldId = 'department';
const HR = 'option-hr';
const SALES = 'option-sales';
const TOTAL_ROWS = 500;

type Fixture = {
  databaseDoc: YDoc;
  sorts: YDatabaseSorts;
  rowIds: string[];
  rowDocs: Record<RowId, YDoc>;
};

function createDepartmentField() {
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOption = new Y.Map();

  field.set(YjsDatabaseKey.id, departmentFieldId);
  field.set(YjsDatabaseKey.name, 'Department');
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  selectOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      options: [
        { id: HR, name: 'HR', color: 0 },
        { id: SALES, name: 'Sales', color: 1 },
      ],
      disable_color: false,
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

/** A grid of employees filtered by "Department is HR"; `isHr` picks each row's department. */
function createFixture(isHr: (index: number) => boolean): Fixture {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>() as unknown as YDatabaseRowOrders;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;
  const filter = new Y.Map() as YDatabaseFilter;
  const rowIds = Array.from({ length: TOTAL_ROWS }, (_, index) => `employee-${index}`);

  fields.set(departmentFieldId, createDepartmentField());
  filter.set(YjsDatabaseKey.id, 'department-is-hr');
  filter.set(YjsDatabaseKey.field_id, departmentFieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, SelectOptionFilterCondition.OptionIs);
  filter.set(YjsDatabaseKey.content, HR);
  filters.push([filter]);
  (rowOrders as unknown as Y.Array<{ id: RowId; height: number }>).push(rowIds.map((id) => ({ id, height: 36 })));
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowDocs = Object.fromEntries(
    rowIds.map((id, index) => [
      id,
      createRowDoc(id, databaseId, {
        [departmentFieldId]: createCell(FieldType.SingleSelect, isHr(index) ? HR : SALES),
      }),
    ])
  );

  return { databaseDoc, sorts, rowIds, rowDocs };
}

function pickRows(fixture: Fixture, indexes: number[]) {
  return Object.fromEntries(indexes.map((index) => [fixture.rowIds[index], fixture.rowDocs[fixture.rowIds[index]]]));
}

function range(start: number, end: number) {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

function ids(rows?: Row[]) {
  return rows?.map((row) => row.id);
}

/**
 * Renders the progressive selector next to the complete-result selector,
 * recording every value the complete one returned.
 */
function renderSelectors(fixture: Fixture, initialRowMap: Record<RowId, YDoc>) {
  // Rows missing from the map stay unresolved: their loads never settle.
  const ensureRow = jest.fn(() => new Promise<YDoc | undefined>(() => undefined));
  let contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: initialRowMap,
    workspaceId: 'workspace-id',
    ensureRow,
  };
  const completeResults: Array<string[] | undefined> = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const rendered = renderHook(
    () => {
      const progressive: RowOrdersSnapshot = useProgressiveRowOrdersSelector();
      const complete = useRowOrdersSelector();

      completeResults.push(ids(complete));
      return { progressive, complete };
    },
    { wrapper }
  );

  return {
    ...rendered,
    completeResults,
    ensureRow,
    loadRows: (rowMap: Record<RowId, YDoc>) => {
      contextValue = { ...contextValue, rowMap };
      rendered.rerender();
    },
  };
}

function destroyFixture(fixture: Fixture) {
  Object.values(fixture.rowDocs).forEach((doc) => doc.destroy());
  fixture.databaseDoc.destroy();
}

describe('useProgressiveRowOrdersSelector', () => {
  it('publishes the matches among the rows already read while the rest still load', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, completeResults, ensureRow, loadRows, unmount } = renderSelectors(
      fixture,
      pickRows(fixture, range(0, 100))
    );
    const firstHundredMatches = range(0, 100)
      .filter((index) => index % 5 === 0)
      .map((index) => fixture.rowIds[index]);

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
      expect(ids(result.current.progressive.rows)).toEqual(firstHundredMatches);
    });
    expect(result.current.complete).toBeUndefined();
    expect(ensureRow).toHaveBeenCalledWith(fixture.rowIds[100]);

    loadRows(fixture.rowDocs);

    const allMatches = fixture.rowIds.filter((_, index) => index % 5 === 0);

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeUndefined();
      expect(ids(result.current.progressive.rows)).toEqual(allMatches);
    });
    expect(ids(result.current.complete)).toEqual(allMatches);
    // The complete-result selector never saw a partial result.
    expect(completeResults.filter((value) => value !== undefined).every((value) => value?.length === 100)).toBe(true);

    unmount();
    destroyFixture(fixture);
  });

  it('keeps a zero-match partial result hydrating instead of reporting an empty view', async () => {
    // The first 100 rows are all Sales: no HR row has been read yet.
    const fixture = createFixture((index) => index >= 100 && index % 5 === 0);
    const { result, completeResults, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
    });
    expect(result.current.progressive.rows).toEqual([]);
    expect(result.current.complete).toBeUndefined();
    expect(completeResults).not.toContainEqual([]);

    loadRows(fixture.rowDocs);

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeUndefined();
      expect(result.current.progressive.rows).toHaveLength(80);
    });
    expect(result.current.complete).toHaveLength(80);
    expect(completeResults).not.toContainEqual([]);

    unmount();
    destroyFixture(fixture);
  });

  it('only shows matches before the first row it has not read, so rows never jump', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    // Rows 50-59 are still loading, rows 60-99 were read out of order.
    const { result, loadRows, unmount } = renderSelectors(
      fixture,
      pickRows(fixture, [...range(0, 50), ...range(60, 100)])
    );

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 90, total: TOTAL_ROWS });
    });
    expect(ids(result.current.progressive.rows)).toEqual(
      range(0, 50)
        .filter((index) => index % 5 === 0)
        .map((index) => fixture.rowIds[index])
    );

    loadRows(pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
      expect(result.current.progressive.rows).toHaveLength(20);
    });
    // The earlier rows keep their positions at the top of the grown result.
    expect(ids(result.current.progressive.rows)?.slice(0, 10)).toEqual(
      range(0, 50)
        .filter((index) => index % 5 === 0)
        .map((index) => fixture.rowIds[index])
    );

    unmount();
    destroyFixture(fixture);
  });

  it('keeps the rows already found while only the progress grows', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
    });
    const firstRows = result.current.progressive.rows;

    expect(firstRows).toHaveLength(20);

    // Rows after the first one still loading are read: the progress grows, the rows shown stay.
    loadRows(pickRows(fixture, [...range(0, 100), ...range(101, 110)]));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 109, total: TOTAL_ROWS });
    });
    expect(result.current.progressive.rows).toBe(firstRows);

    unmount();
    destroyFixture(fixture);
  });

  it('waits for every row of a sorted view but still reports its progress', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'department-sort');
    sort.set(YjsDatabaseKey.field_id, departmentFieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
    fixture.sorts.push([sort]);
    const { result, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
    });
    expect(result.current.progressive.rows).toBeUndefined();
    expect(result.current.complete).toBeUndefined();

    loadRows(fixture.rowDocs);

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeUndefined();
      expect(result.current.progressive.rows).toHaveLength(100);
    });
    expect(result.current.complete).toHaveLength(100);

    unmount();
    destroyFixture(fixture);
  });
});
