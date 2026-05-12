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
});
