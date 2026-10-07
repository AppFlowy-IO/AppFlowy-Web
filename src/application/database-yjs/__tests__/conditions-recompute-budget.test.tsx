/**
 * Recompute budgets of the row selectors (PERFORMANCE-REPORT W23, W6 b and
 * themes 3 and 6 of 3.4):
 * - the user's own cell edit reaches a sorted view on the next frame, without
 *   the 200 ms debounce; a remote burst still recomputes once, after it;
 * - a view's derived result is computed once per conditions: a second
 *   consumer of the same view and conditions, and a return within the
 *   residency window, compute nothing; a change while away, or the end of the
 *   window, computes again;
 * - a board's grouping of a return within the window is not computed again.
 */
import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { releaseDatabaseRowDocs, retainDatabaseRowDocs } from '@/application/database-blob/row-doc-retention';
import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  NumberFilterCondition,
  SortCondition,
  useRowOrdersSelector,
  useRowsByGroup,
} from '@/application/database-yjs';
import * as groupModule from '@/application/database-yjs/group';
import {
  CONDITION_REMOTE_CHANGE_DEBOUNCE_MS,
  clearDerivedResults,
  DERIVED_ROW_ORDERS_TTL_MS,
} from '@/application/database-yjs/selector';
import * as sortModule from '@/application/database-yjs/sort';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
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
// The real debounce (the shared mock calls through at once): the remote budget is about its timing.
jest.mock('lodash-es', () => jest.requireActual('lodash'));

const salaryFieldId = 'salary-field';
const statusFieldId = 'status-field';
const groupId = 'status-group';
const STATUS_OPTIONS = ['todo', 'doing', 'done'];

/** One frame of the faked `requestAnimationFrame` (16 ms). */
const FRAME_MS = 16;

let fixtureCount = 0;

/**
 * A database with a Number (salary) and a Select (status) field, a view sorted
 * by salary, highest first, and a board grouped by status. Every row is in the
 * row map and readable, as on a source whose rows are resident;
 * `peekRowDocFromSeed` answers what the seed cache would: the live doc.
 */
function createFixture(salaries: number[], documentGuid?: string) {
  fixtureCount += 1;
  const databaseId = `budget-database-${fixtureCount}`;
  const viewId = 'sorted-view';
  const databaseDoc = new Y.Doc({ guid: documentGuid ?? databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const salaryField = new Y.Map() as YDatabaseField;
  const statusField = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOptions = new Y.Map();
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
  const sort = new Y.Map() as YDatabaseSort;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const groups = new Y.Array<Y.Map<unknown>>();
  const group = new Y.Map<unknown>();
  const columns = new Y.Array<{ id: string; visible: boolean }>();

  salaryField.set(YjsDatabaseKey.id, salaryFieldId);
  salaryField.set(YjsDatabaseKey.name, 'Salary');
  salaryField.set(YjsDatabaseKey.type, FieldType.Number);
  fields.set(salaryFieldId, salaryField);
  selectOptions.set(
    YjsDatabaseKey.content,
    JSON.stringify({ disable_color: false, options: STATUS_OPTIONS.map((id) => ({ id, name: id, color: 'Blue' })) })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOptions);
  statusField.set(YjsDatabaseKey.id, statusFieldId);
  statusField.set(YjsDatabaseKey.name, 'Status');
  statusField.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  statusField.set(YjsDatabaseKey.type_option, typeOptions);
  fields.set(statusFieldId, statusField);

  sort.set(YjsDatabaseKey.id, 'salary-sort');
  sort.set(YjsDatabaseKey.field_id, salaryFieldId);
  sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
  sorts.push([sort]);

  columns.push([{ id: statusFieldId, visible: true }, ...STATUS_OPTIONS.map((id) => ({ id, visible: true }))]);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, statusFieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  const rowIds = salaries.map((_salary, index) => `row-${index}`);

  rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  view.set(YjsDatabaseKey.groups, groups);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowMap: Record<RowId, YDoc> = Object.fromEntries(
    rowIds.map((id, index) => [
      id,
      createRowDoc(id, databaseId, {
        [salaryFieldId]: createCell(FieldType.Number, String(salaries[index])),
        [statusFieldId]: createCell(FieldType.SingleSelect, STATUS_OPTIONS[index % STATUS_OPTIONS.length]),
      }),
    ])
  );
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    workspaceId: 'workspace-id',
    seedsReady: true,
    blobPrefetchComplete: true,
    peekRowDocFromSeed: (rowId) => rowMap[rowId] ?? null,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const cellOf = (rowId: string, fieldId: string) =>
    (rowMap[rowId].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow)
      .get(YjsDatabaseKey.cells)
      .get(fieldId);

  return {
    databaseId,
    rowIds,
    rowMap,
    rowOrders,
    salaryField,
    wrapper,
    /** A saved filter: salary above `min`. */
    filterSalaryAbove: (min: number) => {
      const filter = new Y.Map() as YDatabaseFilter;

      filter.set(YjsDatabaseKey.id, 'salary-filter');
      filter.set(YjsDatabaseKey.field_id, salaryFieldId);
      filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
      filter.set(YjsDatabaseKey.condition, NumberFilterCondition.GreaterThan);
      filter.set(YjsDatabaseKey.content, String(min));
      filters.push([filter]);
    },
    /** The user's own edit: a local transaction on the row doc. */
    setSalaryLocally: (rowId: string, salary: number) => {
      rowMap[rowId].transact(() => cellOf(rowId, salaryFieldId).set(YjsDatabaseKey.data, String(salary)));
    },
    /** A collaborator's edit: the update of another replica, applied as sync does (not local). */
    setSalaryRemotely: (rowId: string, salary: number) => {
      const replica = new Y.Doc();

      Y.applyUpdate(replica, Y.encodeStateAsUpdate(rowMap[rowId]));
      const stateBefore = Y.encodeStateVector(replica);
      const cell = (
        (replica.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow).get(
          YjsDatabaseKey.cells
        ) as Y.Map<YDatabaseCell>
      ).get(salaryFieldId) as YDatabaseCell;

      cell.set(YjsDatabaseKey.data, String(salary));
      Y.applyUpdate(rowMap[rowId], Y.encodeStateAsUpdate(replica, stateBefore), 'remote');
      replica.destroy();
    },
    destroy: () => {
      Object.values(rowMap).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
    },
  };
}

const ids = (rows: { id: string }[] | undefined) => rows?.map(({ id }) => id);

describe('row selector recompute budgets', () => {
  let sortSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    clearDerivedResults();
    sortSpy = jest.spyOn(sortModule, 'sortBy');
  });

  afterEach(() => {
    sortSpy.mockRestore();
    clearDerivedResults();
    jest.useRealTimers();
  });

  describe('a cell edit (W23)', () => {
    it('reaches a sorted view on the next frame when it is the user’s own, without the 200 ms timer', () => {
      const fixture = createFixture([300, 200, 100]);
      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(result.current)).toEqual(['row-0', 'row-1', 'row-2']);
      sortSpy.mockClear();

      act(() => fixture.setSalaryLocally('row-2', 900));
      // Not before the frame…
      expect(ids(result.current)).toEqual(['row-0', 'row-1', 'row-2']);
      act(() => {
        jest.advanceTimersByTime(FRAME_MS);
      });
      // …and in it, far before the remote debounce would end.
      expect(FRAME_MS).toBeLessThan(CONDITION_REMOTE_CHANGE_DEBOUNCE_MS);
      expect(ids(result.current)).toEqual(['row-2', 'row-0', 'row-1']);
      expect(sortSpy).toHaveBeenCalledTimes(1);

      // Nothing else is left to run once the debounce would have ended.
      act(() => {
        jest.advanceTimersByTime(CONDITION_REMOTE_CHANGE_DEBOUNCE_MS);
      });
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it('folds the user’s own edits of one frame (a paste) into one recompute', () => {
      const fixture = createFixture([300, 200, 100]);
      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      sortSpy.mockClear();
      act(() => {
        fixture.setSalaryLocally('row-0', 10);
        fixture.setSalaryLocally('row-1', 20);
        fixture.setSalaryLocally('row-2', 30);
      });
      act(() => {
        jest.advanceTimersByTime(FRAME_MS);
      });
      expect(ids(result.current)).toEqual(['row-2', 'row-1', 'row-0']);
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it('keeps a row the user’s own edit filters out until the 200 ms debounce, so an editor open on it stays', () => {
      const fixture = createFixture([300, 200, 100]);

      fixture.filterSalaryAbove(150);
      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(result.current)).toEqual(['row-0', 'row-1']);
      act(() => fixture.setSalaryLocally('row-1', 50));
      act(() => {
        jest.advanceTimersByTime(FRAME_MS);
      });
      // A select menu picking the value is still open on the row.
      expect(ids(result.current)).toEqual(['row-0', 'row-1']);
      act(() => {
        jest.advanceTimersByTime(CONDITION_REMOTE_CHANGE_DEBOUNCE_MS);
      });
      expect(ids(result.current)).toEqual(['row-0']);

      // An edit that removes no row shows on the next frame: a row that now matches joins at once.
      act(() => fixture.setSalaryLocally('row-2', 900));
      act(() => {
        jest.advanceTimersByTime(FRAME_MS);
      });
      expect(ids(result.current)).toEqual(['row-2', 'row-0']);
      unmount();
      fixture.destroy();
    });

    it('recomputes a remote burst of 10 changes once, 200 ms after it', () => {
      const fixture = createFixture([300, 200, 100]);
      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      sortSpy.mockClear();
      for (let change = 0; change < 10; change += 1) {
        act(() => {
          fixture.setSalaryRemotely('row-2', 1000 + change);
          jest.advanceTimersByTime(10);
        });
      }

      // 190 ms after the last change: still the previous result.
      act(() => {
        jest.advanceTimersByTime(CONDITION_REMOTE_CHANGE_DEBOUNCE_MS - 20);
      });
      expect(sortSpy).not.toHaveBeenCalled();
      expect(ids(result.current)).toEqual(['row-0', 'row-1', 'row-2']);

      act(() => {
        jest.advanceTimersByTime(20);
      });
      expect(sortSpy).toHaveBeenCalledTimes(1);
      expect(ids(result.current)).toEqual(['row-2', 'row-0', 'row-1']);
      unmount();
      fixture.destroy();
    });
  });

  describe('derived row orders of a resident source (W6 b)', () => {
    it('computes once for two consumers of the same view and conditions', () => {
      const fixture = createFixture([100, 300, 200]);
      const { result, unmount } = renderHook(() => [useRowOrdersSelector(), useRowOrdersSelector()], {
        wrapper: fixture.wrapper,
      });

      expect(result.current.map(ids)).toEqual([
        ['row-1', 'row-2', 'row-0'],
        ['row-1', 'row-2', 'row-0'],
      ]);
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it('computes nothing for a return within the residency window, and shows the result at once', () => {
      const fixture = createFixture([100, 300, 200]);
      const first = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(first.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      first.unmount();
      sortSpy.mockClear();

      act(() => {
        jest.advanceTimersByTime(DERIVED_ROW_ORDERS_TTL_MS - 1_000);
      });
      const renders: (string[] | undefined)[] = [];
      const second = renderHook(
        () => {
          const rows = useRowOrdersSelector();

          renders.push(ids(rows));
          return rows;
        },
        { wrapper: fixture.wrapper }
      );

      // The first render already shows it: no loading frame in between.
      expect(renders[0]).toEqual(['row-1', 'row-2', 'row-0']);
      expect(ids(second.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      expect(sortSpy).not.toHaveBeenCalled();
      second.unmount();
      fixture.destroy();
    });

    it('computes again after a change made while away', () => {
      const fixture = createFixture([100, 300, 200]);

      renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper }).unmount();
      // Another tab of the database edits a row.
      act(() => fixture.setSalaryLocally('row-0', 999));
      sortSpy.mockClear();

      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(result.current)).toEqual(['row-0', 'row-1', 'row-2']);
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it('starts the return window when a long-lived consumer unmounts', () => {
      const fixture = createFixture([100, 300, 200]);
      const first = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      act(() => {
        jest.advanceTimersByTime(DERIVED_ROW_ORDERS_TTL_MS * 2);
      });
      first.unmount();
      sortSpy.mockClear();
      const second = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(second.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      expect(sortSpy).not.toHaveBeenCalled();
      second.unmount();
      fixture.destroy();
    });

    it('computes again after a row was added while away', () => {
      const fixture = createFixture([100, 300]);

      renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper }).unmount();
      fixture.rowMap['row-new'] = createRowDoc('row-new', 'budget', {
        [salaryFieldId]: createCell(FieldType.Number, '200'),
      });
      act(() => fixture.rowOrders.push([{ id: 'row-new', height: 36 }]));
      sortSpy.mockClear();

      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(result.current)).toEqual(['row-1', 'row-new', 'row-0']);
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it('keeps the result of fields a desktop client wrote (BigInt values)', () => {
      const fixture = createFixture([100, 300, 200]);

      // Yrs decodes integers as BigInts (Yjs cannot write them): the field the sort reads holds one.
      const plain = fixture.salaryField.toJSON();

      jest.spyOn(fixture.salaryField, 'toJSON').mockReturnValue({ ...plain, ty: BigInt(FieldType.Number) });
      const first = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(first.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      first.unmount();
      sortSpy.mockClear();

      const second = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(second.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      expect(sortSpy).not.toHaveBeenCalled();
      second.unmount();
      fixture.destroy();
    });

    it('computes again once the residency window is over', () => {
      const fixture = createFixture([100, 300, 200]);

      renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper }).unmount();
      act(() => {
        jest.advanceTimersByTime(DERIVED_ROW_ORDERS_TTL_MS + 1_000);
      });
      sortSpy.mockClear();

      const { result, unmount } = renderHook(() => useRowOrdersSelector(), { wrapper: fixture.wrapper });

      expect(ids(result.current)).toEqual(['row-1', 'row-2', 'row-0']);
      expect(sortSpy).toHaveBeenCalledTimes(1);
      unmount();
      fixture.destroy();
    });

    it.each([undefined, 'published-sorted-view'])(
      'forgets a released source while keeping another resident source cached (document guid %s)',
      (documentGuid) => {
        const released = createFixture([100, 300, 200], documentGuid);
        const resident = createFixture([400, 600, 500]);

        renderHook(() => useRowOrdersSelector(), { wrapper: released.wrapper }).unmount();
        renderHook(() => useRowOrdersSelector(), { wrapper: resident.wrapper }).unmount();
        // A sync binding can keep a row doc alive after the source's final
        // release. Its derived result must no longer keep every row alive too.
        releaseDatabaseRowDocs(released.databaseId);
        retainDatabaseRowDocs(released.databaseId);
        sortSpy.mockClear();

        const cached = renderHook(() => useRowOrdersSelector(), { wrapper: resident.wrapper });

        expect(ids(cached.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
        expect(sortSpy).not.toHaveBeenCalled();
        const reopened = renderHook(() => useRowOrdersSelector(), { wrapper: released.wrapper });

        expect(ids(reopened.result.current)).toEqual(['row-1', 'row-2', 'row-0']);
        expect(sortSpy).toHaveBeenCalledTimes(1);
        cached.unmount();
        reopened.unmount();
        released.destroy();
        resident.destroy();
      }
    );
  });

  describe('derived board groups of a resident source (W6 b)', () => {
    it('groups the rows once: a return within the window groups nothing', () => {
      const groupSpy = jest.spyOn(groupModule, 'groupByField');
      const fixture = createFixture([100, 300, 200, 400]);
      const first = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });
      const firstResult = first.result.current.groupResult;

      expect(firstResult.get('todo')?.map(({ id }) => id)).toEqual(['row-3', 'row-0']);
      first.unmount();
      groupSpy.mockClear();

      const second = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });

      expect(second.result.current.groupResult.get('todo')?.map(({ id }) => id)).toEqual(['row-3', 'row-0']);
      expect(second.result.current.groupRowsReady).toBe(true);
      expect(groupSpy).not.toHaveBeenCalled();
      second.unmount();
      groupSpy.mockRestore();
      fixture.destroy();
    });

    it.each([undefined, 'published-board-view'])(
      'forgets board groups when their source is released (document guid %s)',
      (documentGuid) => {
        const groupSpy = jest.spyOn(groupModule, 'groupByField');
        const fixture = createFixture([100, 300, 200, 400], documentGuid);

        renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper }).unmount();
        releaseDatabaseRowDocs(fixture.databaseId);
        retainDatabaseRowDocs(fixture.databaseId);
        groupSpy.mockClear();

        const reopened = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });

        expect(reopened.result.current.groupResult.get('todo')?.map(({ id }) => id)).toEqual(['row-3', 'row-0']);
        expect(groupSpy).toHaveBeenCalledTimes(1);
        reopened.unmount();
        groupSpy.mockRestore();
        fixture.destroy();
      }
    );
  });
});
