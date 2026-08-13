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
