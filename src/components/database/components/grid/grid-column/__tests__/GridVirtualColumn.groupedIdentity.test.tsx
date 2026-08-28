import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, FieldType } from '@/application/database-yjs';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import { YDatabase, YDatabaseField, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { GridColumnType } from '@/components/database/components/grid/grid-column/useRenderFields';
import type { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row';
import {
  createGridInteractionStore,
  createGridRowResizeStore,
  GridContext,
  GridInteractionContext,
} from '@/components/database/grid/useGridContext';

import GridVirtualColumn from '../GridVirtualColumn';

import type { VirtualItem } from '@tanstack/react-virtual';

jest.mock('@/components/database/components/grid/grid-cell/GridCell', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-cell-content' />,
}));

jest.mock('@/components/database/components/grid/grid-column/useRenderFields', () => ({
  GridColumnType: { Field: 0, NewProperty: 1 },
}));

jest.mock('@/components/database/components/database-row/OpenAction', () => ({
  __esModule: true,
  default: ({ rowId }: { rowId: string }) => <div data-testid={`open-action-${rowId}`} />,
}));

const rows: RenderRow[] = [
  {
    key: 'group:alpha:row:row-1',
    type: RenderRowType.Row,
    rowId: 'row-1',
    groupId: 'alpha',
  },
  {
    key: 'group:beta:row:row-1',
    type: RenderRowType.Row,
    rowId: 'row-1',
    groupId: 'beta',
  },
];

const columns: RenderColumn[] = [
  {
    type: GridColumnType.Field,
    fieldId: 'tags',
    fieldType: FieldType.MultiSelect,
    width: 180,
    isPrimary: true,
  },
];

function createDatabaseContext(): DatabaseContextState {
  const databaseDoc = new Y.Doc() as YDoc;
  const dataSection = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, 'tags');
  field.set(YjsDatabaseKey.type, FieldType.MultiSelect.toString());
  field.set(YjsDatabaseKey.is_primary, true);
  fields.set('tags', field);
  database.set(YjsDatabaseKey.fields, fields);
  dataSection.set(YjsEditorKey.database, database);

  return {
    activeViewId: 'view-id',
    databaseDoc,
    databasePageId: 'database-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
}

function virtualItem(index: number, key: string | number): VirtualItem {
  return {
    index,
    key,
    start: 0,
    end: 36,
    size: 36,
    lane: 0,
  };
}

function renderColumns({
  activeCell: initialActiveCell,
  hoverRowKey,
  onActiveCellChange = jest.fn(),
}: {
  activeCell?: { rowId: string; rowKey: string; fieldId: string };
  hoverRowKey?: string;
  onActiveCellChange?: jest.Mock;
}) {
  function Harness() {
    const [interactionStore] = useState(() =>
      createGridInteractionStore({ activeCell: initialActiveCell, hoverRowKey })
    );
    const [rowResizeStore] = useState(createGridRowResizeStore);
    const gridContextValue = {
      activePropertyId: undefined,
      isGrouped: true,
      lastVisibleRowId: 'row-1',
      loadMoreRows: jest.fn(),
      remainingRowCount: 0,
      revealCreatedRow: jest.fn(),
      rowResizeStore,
      rowOrders: [],
      rows,
      setActivePropertyId: jest.fn(),
      setRows: jest.fn(),
      setShowStickyHeader: jest.fn(),
      showStickyHeader: false,
    };
    const interactionContextValue = {
      historyScopeId: 'test-history-scope',
      restoreHistoryFocus: jest.fn(),
      setActiveCell: (nextActiveCell?: { rowId: string; rowKey: string; fieldId: string }) => {
        onActiveCellChange(nextActiveCell);
        interactionStore.setActiveCell(nextActiveCell);
      },
      setHoverRowKey: interactionStore.setHoverRowKey,
      store: interactionStore,
    };

    return (
      <DatabaseContext.Provider value={createDatabaseContext()}>
        <GridContext.Provider value={gridContextValue}>
          <GridInteractionContext.Provider value={interactionContextValue}>
            <GridVirtualColumn
              columns={columns}
              data={rows}
              row={virtualItem(0, rows[0].key!)}
              column={virtualItem(0, 'tags')}
            />
            <GridVirtualColumn
              columns={columns}
              data={rows}
              row={virtualItem(1, rows[1].key!)}
              column={virtualItem(0, 'tags')}
            />
          </GridInteractionContext.Provider>
        </GridContext.Provider>
      </DatabaseContext.Provider>
    );
  }

  return render(<Harness />);
}

describe('GridVirtualColumn grouped row identity', () => {
  it('activates only the clicked copy and preserves the database row id for writes', () => {
    const onActiveCellChange = jest.fn();

    renderColumns({ onActiveCellChange });

    const renderedColumns = screen.getAllByTestId('grid-cell-content').map((cell) => cell.parentElement!);

    expect(renderedColumns.every((column) => !column.hasAttribute('data-active-cell'))).toBe(true);

    fireEvent.click(renderedColumns[1]);

    expect(renderedColumns[0].hasAttribute('data-active-cell')).toBe(false);
    expect(renderedColumns[1].getAttribute('data-active-cell')).toBe('true');
    expect(onActiveCellChange).toHaveBeenCalledWith({
      rowId: 'row-1',
      rowKey: rows[1].key,
      fieldId: 'tags',
    });
  });

  it('shows hover actions only for the hovered copy', () => {
    renderColumns({ hoverRowKey: rows[1].key });

    expect(screen.getAllByTestId('open-action-row-1')).toHaveLength(1);
    expect(screen.getByTestId('open-action-row-1').closest('[data-row-key]')?.getAttribute('data-row-key')).toBe(
      rows[1].key
    );
  });
});
