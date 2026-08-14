import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, FieldType } from '@/application/database-yjs';
import type { DatabaseContextState, GridGrouping } from '@/application/database-yjs';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import type { YDatabase, YDatabaseField, YDatabaseFields, YDoc } from '@/application/types';
import { GridProvider } from '@/components/database/grid/GridProvider';

import { useHoverControlsActions } from '../HoverControls.hooks';

import type { ReactNode } from 'react';

const newRow = jest.fn<Promise<void>, [Record<string, unknown>]>();
const duplicateRow = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => duplicateRow,
  useNewRowDispatch: () => newRow,
}));

function createWrapper() {
  const databaseDoc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, 'status');
  field.set(YjsDatabaseKey.name, 'Status');
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  fields.set('status', field);
  database.set(YjsDatabaseKey.fields, fields);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const contextValue: DatabaseContextState = {
    activeViewId: 'view-id',
    databaseDoc,
    databasePageId: 'database-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
  const grouping: GridGrouping = {
    activeGroupIds: ['status', 'todo'],
    fieldId: 'status',
    fieldName: 'Status',
    fieldType: FieldType.SingleSelect,
    groupId: 'group-config',
    groups: [],
    hideEmptyGroups: true,
    isGrouped: true,
    ready: true,
    rowOrders: [
      { height: 36, id: 'row-a' },
      { height: 36, id: 'row-b' },
    ],
    visibleGroups: [],
  };

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DatabaseContext.Provider value={contextValue}>
        <GridProvider grouping={grouping}>{children}</GridProvider>
      </DatabaseContext.Provider>
    );
  };
}

describe('useHoverControlsActions in a grouped Grid', () => {
  beforeEach(() => {
    newRow.mockReset();
    newRow.mockResolvedValue(undefined);
    duplicateRow.mockReset();
  });

  it('prefills the group cell when inserting above or below a grouped row', async () => {
    const { result } = renderHook(() => useHoverControlsActions('row-b', 'status', 'todo'), {
      wrapper: createWrapper(),
    });

    await act(() => result.current.onAddRowAbove());
    await act(() => result.current.onAddRowBelow());

    expect(newRow).toHaveBeenNthCalledWith(1, {
      beforeRowId: 'row-a',
      cellsData: { status: 'todo' },
    });
    expect(newRow).toHaveBeenNthCalledWith(2, {
      beforeRowId: 'row-b',
      cellsData: { status: 'todo' },
    });
  });

  it('leaves the grouping cell empty when inserting in the default group', async () => {
    const { result } = renderHook(() => useHoverControlsActions('row-b', 'status', 'status'), {
      wrapper: createWrapper(),
    });

    await act(() => result.current.onAddRowBelow());

    expect(newRow).toHaveBeenCalledWith({ beforeRowId: 'row-b', cellsData: { status: '' } });
  });
});
