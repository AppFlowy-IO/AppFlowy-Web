import { renderHook } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc } from '@/application/types';

import { RenderRowType, useRenderRows } from '../useRenderRows';

function createWrapper() {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: new Y.Doc() as unknown as YDoc,
    databasePageId: 'database-id',
    activeViewId: 'view-id',
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: React.ReactNode }) => (
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
