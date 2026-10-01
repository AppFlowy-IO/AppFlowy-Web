import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, GridGrouping } from '@/application/database-yjs';
import { YDoc } from '@/application/types';

import { RenderRowType, useRenderRows } from '../useRenderRows';

import type { ReactNode } from 'react';

function createWrapper() {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: new Y.Doc() as unknown as YDoc,
    databasePageId: 'database-id',
    activeViewId: 'view-id',
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useRenderRows', () => {
  it('renders the loading placeholder above the new-row control while rows are loading', () => {
    const { result } = renderHook(() => useRenderRows(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.PlaceholderRow,
      RenderRowType.NewRow,
    ]);
  });

  it('renders every visible group as one virtualized stream with repeated field headers', () => {
    const grouping: GridGrouping = {
      isGrouped: true,
      groupId: 'group-config',
      fieldId: 'status',
      fieldName: 'Status',
      fieldType: 3,
      hideEmptyGroups: true,
      ready: true,
      groups: [],
      visibleGroups: [
        {
          id: 'todo',
          label: 'To do',
          rows: [{ id: 'row-1', height: 0 }],
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
        {
          id: 'done',
          label: 'Done',
          rows: [{ id: 'row-2', height: 0 }],
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
      ],
    };
    const { result } = renderHook(() => useRenderRows([], { grouping }), { wrapper: createWrapper() });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.GroupHeader,
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.NewRow,
      RenderRowType.GroupSeparator,
      RenderRowType.GroupHeader,
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.NewRow,
      RenderRowType.GroupSeparator,
      RenderRowType.CalculateRow,
    ]);
    expect(result.current.rows.filter((row) => row.type === RenderRowType.NewRow).map((row) => row.groupId)).toEqual([
      'todo',
      'done',
    ]);
    expect(
      result.current.rows
        .filter((row) => row.type === RenderRowType.Row)
        .map((row) => ({ groupFieldId: row.groupFieldId, groupId: row.groupId, rowId: row.rowId }))
    ).toEqual([
      { groupFieldId: 'status', groupId: 'todo', rowId: 'row-1' },
      { groupFieldId: 'status', groupId: 'done', rowId: 'row-2' },
    ]);
  });

  it('keeps a collapsed group header mounted while removing its table rows', () => {
    const grouping: GridGrouping = {
      isGrouped: true,
      hideEmptyGroups: true,
      ready: true,
      groups: [],
      visibleGroups: [
        {
          id: 'todo',
          label: 'To do',
          rows: [{ id: 'row-1', height: 0 }],
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: true,
        },
      ],
    };
    const { result } = renderHook(() => useRenderRows([], { grouping }), { wrapper: createWrapper() });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.GroupHeader,
      RenderRowType.GroupSeparator,
      RenderRowType.CalculateRow,
    ]);
  });

  it('keeps exact large-group counts while limiting the mounted row stream', () => {
    const alphaRows = Array.from({ length: 60 }, (_, index) => ({ id: `alpha-${index}`, height: 0 }));
    const betaRows = Array.from({ length: 40 }, (_, index) => ({ id: `beta-${index}`, height: 0 }));
    const grouping: GridGrouping = {
      isGrouped: true,
      groupId: 'group-config',
      fieldId: 'status',
      fieldName: 'Status',
      fieldType: 3,
      hideEmptyGroups: true,
      ready: true,
      groups: [],
      visibleGroups: [
        {
          id: 'alpha',
          label: 'Alpha',
          rows: alphaRows,
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
        {
          id: 'beta',
          label: 'Beta',
          rows: betaRows,
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
      ],
    };
    const { result } = renderHook(() => useRenderRows([], { grouping, visibleRowLimit: 25 }), {
      wrapper: createWrapper(),
    });
    const groupHeaders = result.current.rows.filter((row) => row.type === RenderRowType.GroupHeader);
    const mountedRows = result.current.rows.filter((row) => row.type === RenderRowType.Row);

    expect(groupHeaders.map((row) => [row.groupId, row.groupRowCount])).toEqual([
      ['alpha', 60],
      ['beta', 40],
    ]);
    expect(groupHeaders.reduce((total, row) => total + (row.groupRowCount ?? 0), 0)).toBe(100);
    expect(mountedRows).toHaveLength(25);
    expect(result.current.remainingRowCount).toBe(75);
    expect(result.current.lastVisibleRowId).toBe('alpha-24');
  });

  it('uses group-qualified keys when a MultiSelect row appears in multiple groups', () => {
    const sharedRow = { id: 'row-shared', height: 0 };
    const grouping: GridGrouping = {
      isGrouped: true,
      hideEmptyGroups: true,
      ready: true,
      groups: [],
      visibleGroups: [
        {
          id: 'alpha',
          label: 'Alpha',
          rows: [sharedRow],
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
        {
          id: 'beta',
          label: 'Beta',
          rows: [sharedRow],
          isDefault: false,
          visible: true,
          hidden: false,
          automaticallyHidden: false,
          collapsed: false,
        },
      ],
    };
    const { result } = renderHook(() => useRenderRows([], { grouping }), { wrapper: createWrapper() });
    const rowKeys = result.current.rows.filter((row) => row.type === RenderRowType.Row).map((row) => row.key);

    expect(rowKeys).toEqual(['group:alpha:row:row-shared', 'group:beta:row:row-shared']);
    expect(new Set(rowKeys).size).toBe(2);
  });

  it('renders the rows read so far above a loading row', () => {
    const hydrating = { ready: 100, total: 500 };
    const rows = [
      { id: 'row-1', height: 36 },
      { id: 'row-2', height: 36 },
    ];
    const { result } = renderHook(() => useRenderRows(rows, { hydrating }), {
      wrapper: createWrapper(),
    });

    // No calculation row: calculations summarize the complete result only.
    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.PlaceholderRow,
      RenderRowType.NewRow,
    ]);
    expect(result.current.lastVisibleRowId).toBe('row-2');
  });

  it('keeps the stream of the rows read so far while only the progress or the grouping object changes', () => {
    const rows = [
      { id: 'row-1', height: 36 },
      { id: 'row-2', height: 36 },
    ];
    const ungrouped = (): GridGrouping => ({
      isGrouped: false,
      hideEmptyGroups: false,
      ready: true,
      activeGroupIds: [],
      groups: [],
      visibleGroups: [],
    });
    const { result, rerender } = renderHook(
      ({ ready, grouping }: { ready: number; grouping: GridGrouping }) =>
        useRenderRows(rows, { grouping, hydrating: { ready, total: 500 } }),
      { wrapper: createWrapper(), initialProps: { ready: 100, grouping: ungrouped() } }
    );
    const firstStream = result.current.rows;

    // The loading row reads the progress itself; the rows shown do not re-render.
    rerender({ ready: 300, grouping: ungrouped() });
    expect(result.current.rows).toBe(firstStream);

    rerender({ ready: 300, grouping: ungrouped() });
    expect(result.current.rows).toBe(firstStream);
  });

  it('renders a partial result without matches as loading, never as an empty result', () => {
    const { result } = renderHook(() => useRenderRows([], { hydrating: { ready: 100, total: 500 } }), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.PlaceholderRow,
      RenderRowType.NewRow,
    ]);
  });

  it('keeps the loading placeholder of a view that waits for every row', () => {
    const { result } = renderHook(() => useRenderRows(undefined, { hydrating: { ready: 100, total: 500 } }), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.PlaceholderRow,
      RenderRowType.NewRow,
    ]);
  });

  it('keeps the load-more row above the loading row of a limited embedded grid', () => {
    const rows = [
      { id: 'row-1', height: 36 },
      { id: 'row-2', height: 36 },
      { id: 'row-3', height: 36 },
    ];
    const { result } = renderHook(
      () => useRenderRows(rows, { visibleRowLimit: 2, hydrating: { ready: 100, total: 500 } }),
      { wrapper: createWrapper() }
    );

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.LoadMoreRow,
      RenderRowType.PlaceholderRow,
      RenderRowType.NewRow,
    ]);
    expect(result.current.remainingRowCount).toBe(1);
  });

  it('renders an empty filtered result instead of treating it as loading', () => {
    const { result } = renderHook(() => useRenderRows([]), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.NewRow,
      RenderRowType.CalculateRow,
    ]);
  });

  it('does not limit rows when no visible row limit is provided', () => {
    const rows = [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }];
    const { result } = renderHook(() => useRenderRows(rows), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.NewRow,
      RenderRowType.CalculateRow,
    ]);
    expect(result.current.remainingRowCount).toBe(0);
    expect(result.current.lastVisibleRowId).toBe('row-3');
  });

  it('adds a load-more row when a visible row limit hides rows', () => {
    const rows = [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }, { id: 'row-4' }];
    const { result } = renderHook(() => useRenderRows(rows, { visibleRowLimit: 2 }), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.LoadMoreRow,
      RenderRowType.NewRow,
      RenderRowType.CalculateRow,
    ]);
    expect(result.current.remainingRowCount).toBe(2);
    expect(result.current.lastVisibleRowId).toBe('row-2');
  });

  it('does not add a load-more row when the limit covers every row', () => {
    const rows = [{ id: 'row-1' }, { id: 'row-2' }];
    const { result } = renderHook(() => useRenderRows(rows, { visibleRowLimit: 25 }), {
      wrapper: createWrapper(),
    });

    expect(result.current.rows.map((row) => row.type)).toEqual([
      RenderRowType.Header,
      RenderRowType.Row,
      RenderRowType.Row,
      RenderRowType.NewRow,
      RenderRowType.CalculateRow,
    ]);
    expect(result.current.remainingRowCount).toBe(0);
    expect(result.current.lastVisibleRowId).toBe('row-2');
  });
});
