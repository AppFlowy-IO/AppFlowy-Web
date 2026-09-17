import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  TextFilterCondition,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { DashboardExtraFilter, resolveExtraFiltersForDatabase } from '@/application/database-yjs/dashboard.type';
import * as databaseFilter from '@/application/database-yjs/filter';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRowOrders,
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

// The relative-date refresh hook observes whatever filter list the selector
// hands it. Most tests stub it so they exercise filtering alone; the dedicated
// crash test below switches back to the real hook.
const mockRelativeRefresh = { useActual: false };

jest.mock('@/application/database-yjs/hooks/useRelativeDateFilterRefresh', () => {
  const actual = jest.requireActual('@/application/database-yjs/hooks/useRelativeDateFilterRefresh');

  return {
    useRelativeDateFilterRefresh: (...args: Parameters<typeof actual.useRelativeDateFilterRefresh>) =>
      mockRelativeRefresh.useActual ? actual.useRelativeDateFilterRefresh(...args) : undefined,
  };
});

const databaseId = 'database-id';
const viewId = 'view-id';
const titleFieldId = 'title-field';
const statusFieldId = 'status-field';

type Fixture = {
  databaseDoc: YDoc;
  filters: YDatabaseFilters;
  rowMap: Record<RowId, YDoc>;
};

function createTextField(id: string, name: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  return field;
}

function createViewFilter(content: string) {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'view-filter');
  filter.set(YjsDatabaseKey.field_id, titleFieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
  filter.set(YjsDatabaseKey.content, content);
  return filter;
}

function statusFilter(content: string, condition = TextFilterCondition.TextIs): DashboardExtraFilter {
  return {
    id: `gf-${content}`,
    filter_type: FilterType.Data,
    field_id: statusFieldId,
    ty: FieldType.RichText,
    condition,
    content,
  };
}

function createFixture(): Fixture {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>() as unknown as YDatabaseRowOrders;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;

  fields.set(titleFieldId, createTextField(titleFieldId, 'Title'));
  fields.set(statusFieldId, createTextField(statusFieldId, 'Status'));
  (rowOrders as unknown as Y.Array<{ id: RowId; height: number }>).push([
    { id: 'row-c', height: 36 },
    { id: 'row-a', height: 36 },
    { id: 'row-b', height: 36 },
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
    databaseDoc,
    filters,
    rowMap: {
      'row-a': createRowDoc('row-a', databaseId, {
        [titleFieldId]: createCell(FieldType.RichText, 'match alpha'),
        [statusFieldId]: createCell(FieldType.RichText, 'done'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [titleFieldId]: createCell(FieldType.RichText, 'match beta'),
        [statusFieldId]: createCell(FieldType.RichText, 'todo'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [titleFieldId]: createCell(FieldType.RichText, 'skip gamma'),
        [statusFieldId]: createCell(FieldType.RichText, 'done'),
      }),
    },
  };
}

/**
 * The wrapper re-reads `current.extraFilters` on every render, so a test can
 * swap the injected filters and call `rerender()`.
 */
function renderRowOrders(fixture: Fixture, initialExtraFilters?: DashboardExtraFilter[]) {
  const current: { extraFilters?: DashboardExtraFilter[] } = { extraFilters: initialExtraFilters };
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: DatabaseContextState = {
      readOnly: false,
      databaseDoc: fixture.databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: fixture.rowMap,
      workspaceId: 'workspace-id',
      isDashboardWidget: true,
      extraFilters: current.extraFilters,
    };

    return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
  };

  const hook = renderHook(() => useRowOrdersSelector(), { wrapper });
  const setExtraFilters = (extraFilters?: DashboardExtraFilter[]) => {
    current.extraFilters = extraFilters;
    hook.rerender();
  };

  return { ...hook, setExtraFilters };
}

function ids(rows: { id: string }[] | undefined) {
  return rows?.map((row) => row.id);
}

describe('useRowOrdersSelector with dashboard extra filters', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRelativeRefresh.useActual = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('filters rows by the injected filter', async () => {
    const fixture = createFixture();
    const { result } = renderRowOrders(fixture, [statusFilter('done')]);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });
  });

  it('ANDs the injected filter with the view filters', async () => {
    const fixture = createFixture();

    fixture.filters.push([createViewFilter('match')]);
    const { result } = renderRowOrders(fixture, [statusFilter('done')]);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-a']);
    });
  });

  // The selector memoises the combined list on the Y.Array identity, which
  // survives in-place edits, so `combineFilters` must read the live array.
  it('reacts to view filters added or removed while filters are injected', async () => {
    const fixture = createFixture();
    const { result } = renderRowOrders(fixture, [statusFilter('done')]);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });

    act(() => {
      fixture.filters.push([createViewFilter('gamma')]);
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c']);
    });

    act(() => {
      fixture.filters.delete(0, 1);
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });
  });

  it('keeps the row list identity when no filters are injected', async () => {
    const fixture = createFixture();
    const filterBySpy = jest.spyOn(databaseFilter, 'filterBy');
    const { result, setExtraFilters } = renderRowOrders(fixture);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    const before = result.current;

    filterBySpy.mockClear();
    setExtraFilters([]);
    expect(result.current).toBe(before);
    setExtraFilters([]);
    expect(result.current).toBe(before);
    setExtraFilters(undefined);
    expect(result.current).toBe(before);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(result.current).toBe(before);
    expect(filterBySpy).not.toHaveBeenCalled();
    filterBySpy.mockRestore();
  });

  it('recomputes when the injected filters change', async () => {
    const fixture = createFixture();
    const { result, setExtraFilters } = renderRowOrders(fixture);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    act(() => setExtraFilters([statusFilter('done')]));
    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });

    act(() => setExtraFilters([statusFilter('todo')]));
    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-b']);
    });

    act(() => setExtraFilters([statusFilter('todo'), statusFilter('done')]));
    await waitFor(() => {
      expect(result.current).toEqual([]);
    });

    act(() => setExtraFilters([]));
    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });
  });

  it('ignores injected filters that are blank or target unknown fields', async () => {
    const fixture = createFixture();
    const { result } = renderRowOrders(fixture, [
      statusFilter('', TextFilterCondition.TextContains),
      { ...statusFilter('done'), field_id: 'missing-field' },
    ]);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });
  });

  // The condition number means something else for another type (Number
  // GreaterThan is Text Contains), so a mapped field that changed type must
  // not be filtered with the stale condition.
  it('skips an injected filter while its field has another type', async () => {
    const fixture = createFixture();
    const { result } = renderRowOrders(fixture, [statusFilter('done')]);
    const statusField = () =>
      (fixture.databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
        .get(YjsDatabaseKey.fields)
        .get(statusFieldId);
    const setStatusType = (type: FieldType) => {
      act(() => {
        statusField().set(YjsDatabaseKey.type, type);
      });
      act(() => {
        jest.advanceTimersByTime(250);
      });
    };

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });

    setStatusType(FieldType.Number);
    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    setStatusType(FieldType.RichText);
    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a']);
    });
  });

  it('only applies global filters resolved for the widget database', async () => {
    const fixture = createFixture();
    const globalFilters = [
      {
        id: 'gf-1',
        name: 'Status',
        fieldType: FieldType.RichText,
        condition: TextFilterCondition.TextIs,
        content: 'todo',
        targets: { [databaseId]: statusFieldId },
      },
      {
        id: 'gf-2',
        name: 'Other',
        fieldType: FieldType.RichText,
        condition: TextFilterCondition.TextIs,
        content: 'nothing matches',
        targets: { 'other-database': 'other-field' },
      },
    ];
    const { result } = renderRowOrders(fixture, resolveExtraFiltersForDatabase(globalFilters, databaseId));

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-b']);
    });
  });

  // `useRelativeDateFilterRefresh` observes the combined list, which forwards
  // `observeDeep` to the view's own Y.Array.
  it('mounts with the real relative-date refresh hook while filters are injected', async () => {
    mockRelativeRefresh.useActual = true;
    const fixture = createFixture();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { result } = renderRowOrders(fixture, [statusFilter('done')]);

      await waitFor(() => {
        expect(ids(result.current)).toEqual(['row-c', 'row-a']);
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('mounts with the real relative-date refresh hook when nothing is injected', async () => {
    mockRelativeRefresh.useActual = true;
    const fixture = createFixture();
    const { result } = renderRowOrders(fixture);

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-c', 'row-a', 'row-b']);
    });
  });
});
