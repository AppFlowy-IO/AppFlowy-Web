import {
  GridDragContext,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { useGridDnd } from '@/components/database/components/grid/grid-table/useGridDnd';
import { useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useColumnResize } from '../grid-column/useColumnResize';

function GridVirtualizer ({
  columns,
  data,
}: {
  data: RenderRow[]
  columns: RenderColumn[];
}) {
  const {
    handleResizeStart,
    isResizing,
  } = useColumnResize(columns);

  const {
    parentRef,
    virtualizer,
    columnVirtualizer,
  } = useGridVirtualizer({
    data,
    columns,
  });

  useEffect(() => {
    if (!isResizing) {
      columnVirtualizer.measure();
    }
  }, [columns, isResizing, columnVirtualizer]);

  const columnItems = columnVirtualizer.getVirtualItems();
  const totalSize = columnVirtualizer.getTotalSize();

  const contextValue = useGridDnd(data, columns, virtualizer, columnVirtualizer);
  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [draggingBottomScrollbar, setDraggingBottomScrollbar] = useState(false);
  const [isHover, setIsHover] = useState(false);

  return (
    <GridDragContext.Provider value={contextValue}>
      <div
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        ref={parentRef}
        className={'appflowy-custom-scroller'}
        style={{ overflowY: 'auto', scrollBehavior: 'auto' }}
        onScroll={e => {
          if (draggingBottomScrollbar) return;
          const scrollLeft = e.currentTarget.scrollLeft;

          const bottomScrollbar = bottomScrollbarRef.current;

          if (!bottomScrollbar) return;

          bottomScrollbar.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });
        }}
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
                  onResizeColumnStart={handleResizeStart}
                />
              </div>
            );
          })}
        </div>
        {virtualizer.scrollElement && createPortal(<div
          style={{
            width: '100%',
            position: 'sticky',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
          }}
        >
          <div
            ref={bottomScrollbarRef}
            style={{
              scrollBehavior: 'auto',
              visibility: isHover && totalSize > window.innerWidth ? 'visible' : 'hidden',
            }}
            onMouseDown={() => {
              setDraggingBottomScrollbar(true);
            }}
            onMouseUp={() => {
              setDraggingBottomScrollbar(false);
            }}
            onScroll={e => {
              if (!draggingBottomScrollbar) return;
              const scrollLeft = e.currentTarget.scrollLeft;

              parentRef.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
            className={'h-3 w-full opacity-30 hover:opacity-60 overflow-y-hidden overflow-x-auto'}
          >
            <div
              style={{
                width: `${totalSize}px`,
              }}
            >
              &nbsp;
            </div>
          </div>
        </div>, virtualizer.scrollElement)}
      </div>
    </GridDragContext.Provider>
  );
}

export default GridVirtualizer;