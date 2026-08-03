import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { YDatabaseRowOrders, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createRowDoc } from '../../__tests__/test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseFixture() {
  const databaseId = 'database-id';
  const viewId = 'board-view-id';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;

  rowOrders.push([{ id: 'initial-row', height: 44 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return { databaseDoc, databaseId, rowOrders, viewId };
}

describe('useBackgroundRowDocLoader', () => {
  it('hydrates a row inserted collaboratively after the initial loading pass', async () => {
    const { databaseDoc, databaseId, rowOrders, viewId } = createDatabaseFixture();
    const initialRowDoc = createRowDoc('initial-row', databaseId, {});
    const insertedRowDoc = createRowDoc('inserted-row', databaseId, {});
    const loadRowFromSeed = jest.fn(async () => undefined);
    const ensureRow = jest.fn(async () => insertedRowDoc);
    const contextValue: DatabaseContextState = {
      activeViewId: viewId,
      blobPrefetchComplete: true,
      databaseDoc,
      databasePageId: viewId,
      ensureRow,
      loadRowFromSeed,
      readOnly: false,
      rowMap: { 'initial-row': initialRowDoc },
      seedsReady: false,
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { unmount } = renderHook(() => useBackgroundRowDocLoader(true, 'board-grouping'), { wrapper });

    await waitFor(() => {
      expect(loadRowFromSeed).not.toHaveBeenCalled();
    });

    act(() => {
      rowOrders.push([{ id: 'inserted-row', height: 44 }]);
    });

    await waitFor(() => {
      expect(loadRowFromSeed).toHaveBeenCalledWith('inserted-row');
      expect(ensureRow).toHaveBeenCalledWith('inserted-row');
    });

    unmount();
    initialRowDoc.destroy();
    insertedRowDoc.destroy();
    databaseDoc.destroy();
  });
});
