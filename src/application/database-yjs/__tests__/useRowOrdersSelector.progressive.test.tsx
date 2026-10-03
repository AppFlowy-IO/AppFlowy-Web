import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import {
  advancePartialFilter,
  computeRowOrders,
  createPartialFilterState,
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  type Row,
  type RowOrdersLoadReport,
  RowOrdersLoadReporterContext,
  type RowOrdersSelectorOptions,
  type RowOrdersSnapshot,
  SelectOptionFilterCondition,
  SortCondition,
  useProgressiveRowOrdersSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
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
function renderSelectors(
  fixture: Fixture,
  initialRowMap: Record<RowId, YDoc>,
  options?: RowOrdersSelectorOptions
) {
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
  // What each row-orders result last reported to its host, by result.
  const loadReports = new Map<object, RowOrdersLoadReport>();
  const loadReporter = {
    report: (source: object, report: RowOrdersLoadReport) => loadReports.set(source, report),
    release: (source: object) => loadReports.delete(source),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RowOrdersLoadReporterContext.Provider value={loadReporter}>
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </RowOrdersLoadReporterContext.Provider>
  );
  const rendered = renderHook(
    () => {
      const progressive: RowOrdersSnapshot = useProgressiveRowOrdersSelector(options);
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
    loadReports,
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

  it('shows the matches among the rows read so far and appends later ones below, so rows never move', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const matches = (indexes: number[]) =>
      indexes.filter((index) => index % 5 === 0).map((index) => fixture.rowIds[index]);
    // Rows 50-59 are still loading, rows 60-99 were read out of order.
    const { result, loadRows, unmount } = renderSelectors(
      fixture,
      pickRows(fixture, [...range(0, 50), ...range(60, 100)])
    );

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 90, total: TOTAL_ROWS });
    });
    // Every match among the rows read shows, not only those before the first unread row.
    const shownFirst = ids(result.current.progressive.rows);

    expect(shownFirst).toEqual(matches([...range(0, 50), ...range(60, 100)]));

    loadRows(pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 100, total: TOTAL_ROWS });
      expect(result.current.progressive.rows).toHaveLength(20);
    });
    // The rows already shown keep their positions; the late ones append below them.
    expect(ids(result.current.progressive.rows)?.slice(0, 18)).toEqual(shownFirst);
    expect(ids(result.current.progressive.rows)?.slice(18)).toEqual(matches(range(50, 60)));
    // The earlier rows keep their positions at the top of the grown result.
    expect(ids(result.current.progressive.rows)?.slice(0, 10)).toEqual(matches(range(0, 50)));
    expect(result.current.complete).toBeUndefined();

    loadRows(fixture.rowDocs);

    // Once every row was read the result is in the view's order.
    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeUndefined();
      expect(ids(result.current.progressive.rows)).toEqual(matches(range(0, TOTAL_ROWS)));
    });

    unmount();
    destroyFixture(fixture);
  });

  it('shows the same rows in the same order when the rows arrive in view order', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 40)));
    const seen: Array<string[] | undefined> = [];

    for (const loaded of [40, 120, 260, 400]) {
      loadRows(pickRows(fixture, range(0, loaded)));
      await waitFor(() => {
        expect(result.current.progressive.hydrating).toEqual({ ready: loaded, total: TOTAL_ROWS });
      });
      seen.push(ids(result.current.progressive.rows));
    }

    loadRows(fixture.rowDocs);
    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeUndefined();
    });
    const finalRows = ids(result.current.progressive.rows) ?? [];

    // Every partial result was the first rows of the final one: nothing moved, even at the end.
    seen.forEach((rows) => expect(rows).toEqual(finalRows.slice(0, rows?.length)));
    expect(seen.map((rows) => rows?.length)).toEqual([8, 24, 52, 80]);

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

    // Rows that do not match are read: the progress grows, the rows shown stay.
    loadRows(pickRows(fixture, [...range(0, 100), ...range(101, 105)]));

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toEqual({ ready: 104, total: TOTAL_ROWS });
    });
    expect(result.current.progressive.rows).toBe(firstRows);

    unmount();
    destroyFixture(fixture);
  });

  it('gives a consumer that waits for every row neither partial rows nor progress updates', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, ensureRow, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)), {
      partial: false,
    });

    await waitFor(() => {
      expect(result.current.progressive.hydrating).toBeDefined();
      // The rows still missing are requested whoever asks for the result.
      expect(ensureRow).toHaveBeenCalledWith(fixture.rowIds[100]);
    });
    const waiting = result.current.progressive;

    expect(waiting.rows).toBeUndefined();

    // More rows are read: the snapshot this consumer holds is the same object, so nothing re-renders.
    loadRows(pickRows(fixture, range(0, 300)));
    await waitFor(() => {
      expect(ensureRow).toHaveBeenCalledWith(fixture.rowIds[300]);
    });
    expect(result.current.progressive).toBe(waiting);
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

  it('reports to its host when the result lists matches and when it is complete', async () => {
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, loadReports, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.rows).toHaveLength(20);
    });
    // The progressive result lists matches; the one that waits for every row lists nothing yet.
    expect(Array.from(loadReports.values())).toEqual(
      expect.arrayContaining([
        { complete: false, hasMatches: true },
        { complete: false, hasMatches: false },
      ])
    );
    expect(loadReports.size).toBe(2);

    loadRows(fixture.rowDocs);

    await waitFor(() => {
      expect(result.current.complete).toHaveLength(100);
    });
    expect(Array.from(loadReports.values())).toEqual([
      { complete: true, hasMatches: true },
      { complete: true, hasMatches: true },
    ]);

    unmount();
    expect(loadReports.size).toBe(0);
    destroyFixture(fixture);
  });

  it('counts one full computation of the derived result per consumer', async () => {
    dashboardLoadStats.reset();
    const fixture = createFixture((index) => index % 5 === 0);
    const { result, loadRows, unmount } = renderSelectors(fixture, pickRows(fixture, range(0, 100)));

    await waitFor(() => {
      expect(result.current.progressive.rows).toHaveLength(20);
    });
    // Partial results are not full computations.
    expect(dashboardLoadStats.snapshot().derivedComputes).toEqual({});

    loadRows(fixture.rowDocs);
    await waitFor(() => {
      expect(result.current.complete).toHaveLength(100);
    });
    const { derivedComputes } = dashboardLoadStats.snapshot();
    const keys = Object.keys(derivedComputes);

    // One key for the view and its conditions; each of the two mounted results computed it once.
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`${viewId}:`)).toBe(true);
    expect(derivedComputes[keys[0]]).toBe(2);

    unmount();
    destroyFixture(fixture);
    dashboardLoadStats.reset();
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

describe('computeRowOrders', () => {
  const isHrIndex = (index: number) => index % 3 === 0;

  function createPureFixture(total: number) {
    const rowOrders: Row[] = Array.from({ length: total }, (_, index) => ({ id: `row-${index}`, height: 36 }));
    const allDocs = Object.fromEntries(
      rowOrders.map((row, index) => [
        row.id,
        createRowDoc(row.id, databaseId, {
          [departmentFieldId]: createCell(FieldType.SingleSelect, isHrIndex(index) ? HR : SALES),
        }),
      ])
    );
    const judged: string[] = [];
    const matchesRow = (row: Row) => isHrIndex(Number(row.id.slice('row-'.length)));
    const filter = (rows: Row[]) => {
      rows.forEach((row) => judged.push(row.id));
      return rows.filter(matchesRow);
    };

    return {
      rowOrders,
      allDocs,
      judged,
      filter,
      matchesRow,
      destroy: () => Object.values(allDocs).forEach((doc) => doc.destroy()),
    };
  }

  /** A fixed shuffle: the order in which a server could deliver the rows. */
  function deliveryOrder(total: number) {
    return Array.from({ length: total }, (_, index) => (index * 37 + 11) % total);
  }

  it('finds the same matches as the full filter while judging every row once, whatever order rows arrive in', () => {
    const total = 101;
    const fixture = createPureFixture(total);
    const state = createPartialFilterState('view:conditions');
    const docs: Record<RowId, YDoc> = {};
    const arrival = deliveryOrder(total);
    let previousShown: string[] = [];

    expect(new Set(arrival).size).toBe(total);

    // The last three rows stay unread, so every pass below is a partial one.
    for (let delivered = 0; delivered + 7 < total; delivered += 7) {
      arrival.slice(delivered, delivered + 7).forEach((index) => {
        const id = fixture.rowOrders[index].id;

        docs[id] = fixture.allDocs[id];
      });
      const result = computeRowOrders({
        rowOrders: fixture.rowOrders,
        docs,
        unavailable: new Set(),
        filter: fixture.filter,
        partial: state,
      });
      const readable = fixture.rowOrders.filter((row) => docs[row.id]);
      const shown = ids(result.rows) ?? [];

      expect(result.hydrating).toEqual({ ready: readable.length, total });
      expect(result.unresolved).toEqual(fixture.rowOrders.filter((row) => !docs[row.id]));
      // The same rows the full filter finds among the rows read so far.
      expect([...shown].sort()).toEqual(ids(readable.filter(fixture.matchesRow))?.sort());
      // Rows already shown did not move; the new ones are below them, in view order.
      expect(shown.slice(0, previousShown.length)).toEqual(previousShown);
      const appended = shown.slice(previousShown.length);

      expect(appended).toEqual(ids(fixture.rowOrders.filter((row) => appended.includes(row.id))));
      previousShown = shown;
    }

    // Each readable row went through the predicate exactly once.
    expect(new Set(fixture.judged).size).toBe(fixture.judged.length);
    expect(fixture.judged.length).toBe(Object.keys(docs).length);
    expect(fixture.judged.length).toBe(98);

    // With every row read, the result is the full filter in the view's order.
    const complete = computeRowOrders({
      rowOrders: fixture.rowOrders,
      docs: fixture.allDocs,
      unavailable: new Set(),
      filter: fixture.filter,
      partial: state,
    });

    expect(complete.hydrating).toBeUndefined();
    expect(complete.unresolved).toEqual([]);
    expect(ids(complete.rows)).toEqual(ids(fixture.rowOrders.filter(fixture.matchesRow)));
    fixture.destroy();
  });

  it('waits for every row of a sorted view and of a caller that shows no partial result', () => {
    const fixture = createPureFixture(12);
    const docs = Object.fromEntries(fixture.rowOrders.slice(0, 6).map((row) => [row.id, fixture.allDocs[row.id]]));
    const sorted = computeRowOrders({
      rowOrders: fixture.rowOrders,
      docs,
      unavailable: new Set(),
      sort: (rows) => [...rows].reverse(),
      filter: fixture.filter,
      partial: createPartialFilterState('view:sorted'),
    });
    const waiting = computeRowOrders({
      rowOrders: fixture.rowOrders,
      docs,
      unavailable: new Set(),
      filter: fixture.filter,
    });

    expect(sorted.rows).toBeUndefined();
    expect(sorted.hydrating).toEqual({ ready: 6, total: 12 });
    expect(waiting.rows).toBeUndefined();
    expect(waiting.hydrating).toEqual({ ready: 6, total: 12 });
    // Neither ran the filter.
    expect(fixture.judged).toEqual([]);

    const complete = computeRowOrders({
      rowOrders: fixture.rowOrders,
      docs: fixture.allDocs,
      unavailable: new Set(),
      sort: (rows) => [...rows].reverse(),
      filter: fixture.filter,
    });

    expect(ids(complete.rows)).toEqual(ids(fixture.rowOrders.filter(fixture.matchesRow).reverse()));
    fixture.destroy();
  });

  it('leaves a row that cannot be loaded out without waiting for it', () => {
    const fixture = createPureFixture(9);
    const docs = { ...fixture.allDocs };

    delete docs['row-3'];
    const result = computeRowOrders({
      rowOrders: fixture.rowOrders,
      docs,
      unavailable: new Set(['row-3']),
      filter: fixture.filter,
    });

    expect(result.hydrating).toBeUndefined();
    expect(ids(result.rows)).toEqual(['row-0', 'row-6']);
    fixture.destroy();
  });

  it('judges a row again when its doc is replaced or the verdicts go stale, without moving the rows shown', () => {
    const fixture = createPureFixture(12);
    const state = createPartialFilterState('view:conditions');
    const docs: Record<RowId, YDoc> = {};

    // Rows 6-11 arrive first, then rows 0-5.
    fixture.rowOrders.slice(6).forEach((row) => (docs[row.id] = fixture.allDocs[row.id]));
    expect(ids(advancePartialFilter(state, fixture.rowOrders.slice(6), docs, fixture.filter))).toEqual([
      'row-6',
      'row-9',
    ]);
    fixture.rowOrders.slice(0, 6).forEach((row) => (docs[row.id] = fixture.allDocs[row.id]));
    const shown = advancePartialFilter(state, fixture.rowOrders, docs, fixture.filter);

    expect(ids(shown)).toEqual(['row-6', 'row-9', 'row-0', 'row-3']);
    // Nothing new to judge: the same array comes back.
    expect(advancePartialFilter(state, fixture.rowOrders, docs, fixture.filter)).toBe(shown);
    expect(fixture.judged).toHaveLength(12);

    // Row 9 gets another doc, in which it no longer matches; row 7 gets one in which it does.
    const replacement = createRowDoc('row-9', databaseId, {
      [departmentFieldId]: createCell(FieldType.SingleSelect, SALES),
    });
    const promoted = createRowDoc('row-7', databaseId, {
      [departmentFieldId]: createCell(FieldType.SingleSelect, HR),
    });
    const matching = new Set(['row-0', 'row-3', 'row-6', 'row-7']);
    const filterAfterEdit = (rows: Row[]) => {
      rows.forEach((row) => fixture.judged.push(row.id));
      return rows.filter((row) => matching.has(row.id));
    };

    docs['row-9'] = replacement;
    docs['row-7'] = promoted;
    expect(ids(advancePartialFilter(state, fixture.rowOrders, docs, filterAfterEdit))).toEqual([
      'row-6',
      'row-0',
      'row-3',
      'row-7',
    ]);
    // Only the two replaced rows were judged again.
    expect(fixture.judged.slice(12)).toEqual(['row-7', 'row-9']);

    // Stale verdicts (a field or a row changed in place): every row is judged again, the order holds.
    state.verdicts.clear();
    expect(ids(advancePartialFilter(state, fixture.rowOrders, docs, filterAfterEdit))).toEqual([
      'row-6',
      'row-0',
      'row-3',
      'row-7',
    ]);
    expect(fixture.judged.slice(14)).toHaveLength(12);

    // A row that left the view leaves the rows shown.
    const withoutRow0 = fixture.rowOrders.slice(1);

    expect(ids(advancePartialFilter(state, withoutRow0, docs, filterAfterEdit))).toEqual(['row-6', 'row-3', 'row-7']);

    replacement.destroy();
    promoted.destroy();
    fixture.destroy();
  });
});
