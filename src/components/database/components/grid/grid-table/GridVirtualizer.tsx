import {
  GridDragContext,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { useGridDnd } from '@/components/database/components/grid/grid-table/useGridDnd';
import { useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';
import React from 'react';

function GridVirtualizer ({
  columns,
  data,
}: {
  data: RenderRow[]
  columns: RenderColumn[]
}) {
  const {
    parentRef,
    virtualizer,
    columnVirtualizer,
  } = useGridVirtualizer({
    data,
    columns,
  });
  const columnItems = columnVirtualizer.getVirtualItems();
  const totalSize = columnVirtualizer.getTotalSize();

  const {
    contextValue,
  } = useGridDnd(data, virtualizer);

  return (
    <GridDragContext.Provider value={contextValue}>
      <div
        ref={parentRef}
        className={'appflowy-scroller'}
        style={{ overflowY: 'auto' }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const rowData = data[row.index];
            const rowId = rowData.rowId;

            return (
              <div
                key={row.key}
                data-row-id={rowId}
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transform: `translateY(${
                    row.start - virtualizer.options.scrollMargin
                  }px)`,
                  display: 'flex',
                }}
              >
                <GridVirtualRow
                  row={row}
                  columns={columns}
                  data={data}
                  totalSize={totalSize}
                  columnItems={columnItems}
                />
              </div>
            );
          })}
        </div>
      </div>
    </GridDragContext.Provider>
  );
}

export default GridVirtualizer;