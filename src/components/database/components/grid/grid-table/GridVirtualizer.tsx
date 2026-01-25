import { useCallback, useEffect, useRef, useState } from 'react';

import { PADDING_END, useDatabaseContext } from '@/application/database-yjs';
import { GridDragContext } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRowType } from '@/components/database/components/grid/grid-row';
import GridNewRow from '@/components/database/components/grid/grid-row/GridNewRow';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import GridStickyHeader from '@/components/database/components/grid/grid-table/GridStickyHeader';
import { useGridDnd } from '@/components/database/components/grid/grid-table/useGridDnd';
import { PADDING_INLINE, useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';
import DatabaseStickyBottomOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay';
import DatabaseStickyHorizontalScrollbar from '@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { useGridContext } from '@/components/database/grid/useGridContext';

import { useColumnResize } from '../grid-column/useColumnResize';

function GridVirtualizer({ columns }: { columns: RenderColumn[] }) {
  const { rows: data, resizeRows, onResizeRowEnd } = useGridContext();
  const { handleResizeStart, isResizing } = useColumnResize(columns);
  const { isDocumentBlock, paddingEnd } = useDatabaseContext();

  const { parentRef, virtualizer, columnVirtualizer, scrollMarginTop, isReady } = useGridVirtualizer({
    data,
    columns,
  });

  const rowItems = virtualizer.getVirtualItems();
  const columnItems = columnVirtualizer.getVirtualItems();
  const totalSize = columnVirtualizer.getTotalSize();

  const contextValue = useGridDnd(columns, virtualizer, columnVirtualizer);
  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [isHover, setIsHover] = useState(false);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const rowsHeightRef = useRef<Map<string, number>>(new Map());
  const [isScrolling, setIsScrolling] = useState(false);
  const { setShowStickyHeader } = useGridContext();

  const onResizeRow = useCallback(
    (id: string, maxCellHeight: number) => {
      const index = data.findIndex((row) => row.rowId === id);

      if (index === -1) return;

      if (rowsHeightRef.current.has(id) && rowsHeightRef.current.get(id) === maxCellHeight) {
        return; // No change in height, no need to resize
      }

      rowsHeightRef.current.set(id, maxCellHeight);

      virtualizer.resizeItem(index, maxCellHeight);
    },
    [data, virtualizer]
  );

  useEffect(() => {
    if (!isResizing) {
      columnVirtualizer.measure();
    }
  }, [columnVirtualizer, isResizing, columns]);

  const isScrollingRef = useRef(false);

  useEffect(() => {
    isScrollingRef.current = isScrolling;
  }, [isScrolling]);

  useEffect(() => {
    const rows = Array.from(resizeRows?.entries() || []);

    rows.forEach(([rowId, maxCellHeight]) => {
      if (!isScrollingRef.current) {
        onResizeRow(rowId, maxCellHeight);
      }

      onResizeRowEnd(rowId);
    });
  }, [isResizing, resizeRows, onResizeRow, onResizeRowEnd]);

  useEffect(() => {
    const scrollElement = virtualizer.scrollElement;
    const gridElement = parentRef.current;

    if (!scrollElement || !gridElement) return;

    let timeout: NodeJS.Timeout;

    const onScroll = () => {
      const scrollMarginTop = gridElement.getBoundingClientRect().top ?? 0;
      const bottom = gridElement.getBoundingClientRect().bottom ?? 0;
      const stickyHeader = stickyHeaderRef.current;

      if (!stickyHeader) return;

      if (scrollMarginTop <= 48 && bottom - PADDING_END >= 48) {
        stickyHeader.style.opacity = '1';
        stickyHeader.style.pointerEvents = 'auto';
        setShowStickyHeader(true);
      } else {
        stickyHeader.style.opacity = '0';
        stickyHeader.style.pointerEvents = 'none';
        setShowStickyHeader(false);
      }

      setIsScrolling(true);

      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    onScroll();
    scrollElement.addEventListener('scroll', onScroll);
    return () => {
      scrollElement.removeEventListener('scroll', onScroll);
    };
  }, [parentRef, scrollMarginTop, virtualizer.scrollElement, setShowStickyHeader]);

  return (
    <GridDragContext.Provider value={contextValue}>
      <div
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        ref={parentRef}
        className={'appflowy-custom-scroller appflowy-hidden-horizontal-scrollbar'}
        style={{
          overflowY: 'auto',
          overflowX: 'auto',
          scrollBehavior: 'auto',
        }}
        onScroll={(e) => {
          const scrollLeft = e.currentTarget.scrollLeft;

          stickyHeaderRef.current?.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });

          bottomScrollbarRef.current?.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            opacity: isReady ? 1 : 0, // Hide content until parent offset is stable to prevent scroll jumps
          }}
        >
          {rowItems.map((row) => {
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
                  transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                  display: 'flex',
                }}
              >
                {rowData.type === RenderRowType.NewRow ? (
                  <div
                    style={{
                      paddingLeft: columnItems[0]?.start,
                      paddingRight: isDocumentBlock ? 0 : PADDING_INLINE,
                      width: totalSize - (paddingEnd ?? 0),
                    }}
                  >
                    <GridNewRow />
                  </div>
                ) : (
                  <GridVirtualRow
                    row={row}
                    columns={columns}
                    data={data}
                    totalSize={totalSize}
                    columnItems={columnItems}
                    onResizeColumnStart={handleResizeStart}
                  />
                )}
              </div>
            );
          })}
        </div>
        <DatabaseStickyTopOverlay>
          <GridStickyHeader
            // eslint-disable-next-line
            // @ts-ignore
            row={{
              index: 0,
            }}
            ref={stickyHeaderRef}
            columns={columns}
            data={data}
            totalSize={totalSize}
            columnItems={columnItems}
            onScrollLeft={(scrollLeft) => {
              parentRef.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
            onResizeColumnStart={handleResizeStart}
          />
        </DatabaseStickyTopOverlay>

        <DatabaseStickyBottomOverlay scrollElement={virtualizer.scrollElement}>
          <DatabaseStickyHorizontalScrollbar
            onScrollLeft={(scrollLeft) => {
              parentRef.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
            ref={bottomScrollbarRef}
            totalSize={totalSize}
            visible={Boolean(isHover && totalSize)}
          />
        </DatabaseStickyBottomOverlay>
      </div>
    </GridDragContext.Provider>
  );
}

export default GridVirtualizer;
