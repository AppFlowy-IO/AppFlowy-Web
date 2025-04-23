import { PADDING_END } from '@/application/database-yjs';
import { GridDragContext } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRowType } from '@/components/database/components/grid/grid-row';
import GridNewRow from '@/components/database/components/grid/grid-row/GridNewRow';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import GridStickyHeader from '@/components/database/components/grid/grid-table/GridStickyHeader';
import { useGridDnd } from '@/components/database/components/grid/grid-table/useGridDnd';
import { useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';
import DatabaseStickyBottomOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay';
import DatabaseStickyHorizontalScrollbar
  from '@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { useGridContext } from '@/components/database/grid/useGridContext';
import React, { useEffect, useRef, useState } from 'react';
import { useColumnResize } from '../grid-column/useColumnResize';

function GridVirtualizer ({
  columns,
}: {
  columns: RenderColumn[];
}) {
  const {
    rows: data,
    setShowStickyHeader,
    showStickyHeader,
  } = useGridContext();
  const {
    handleResizeStart,
    isResizing,
  } = useColumnResize(columns);

  const {
    parentRef,
    virtualizer,
    columnVirtualizer,
    scrollMarginTop,
  } = useGridVirtualizer({
    data,
    columns,
  });

  useEffect(() => {
    if (!isResizing) {
      columnVirtualizer.measure();
    }
  }, [columns, isResizing, columnVirtualizer]);

  const rowItems = virtualizer.getVirtualItems();
  const columnItems = columnVirtualizer.getVirtualItems();
  const totalSize = columnVirtualizer.getTotalSize();

  const contextValue = useGridDnd(columns, virtualizer, columnVirtualizer);
  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [isHover, setIsHover] = useState(false);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollElement = virtualizer.scrollElement;
    const gridElement = parentRef.current;

    if (!scrollElement || !gridElement) return;

    const onScroll = () => {
      const scrollMarginTop = gridElement.getBoundingClientRect().top ?? 0;
      const bottom = gridElement.getBoundingClientRect().bottom ?? 0;

      // console.log(header, scrollMarginTop);
      if (scrollMarginTop <= 48 && bottom - PADDING_END >= 48) {
        setShowStickyHeader(true);
      } else {
        setShowStickyHeader(false);
      }
    };

    onScroll();
    scrollElement.addEventListener('scroll', onScroll);
    return () => {
      scrollElement.removeEventListener('scroll', onScroll);
    };

  }, [parentRef, scrollMarginTop, setShowStickyHeader, virtualizer.scrollElement]);

  return (
    <GridDragContext.Provider value={contextValue}>
      <div
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        ref={parentRef}
        className={'appflowy-custom-scroller'}
        style={{ overflowY: 'auto', scrollBehavior: 'auto' }}
        onScroll={e => {
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
                  transform: `translateY(${
                    row.start - virtualizer.options.scrollMargin
                  }px)`,
                  display: 'flex',
                }}
              >
                {rowData.type === RenderRowType.NewRow ? <div
                  style={{
                    paddingLeft: columnItems[0].start,
                    paddingRight: columnItems[0].start,
                    width: totalSize,
                  }}
                >
                  <GridNewRow />
                </div> : <GridVirtualRow
                  row={row}
                  columns={columns}
                  data={data}
                  totalSize={totalSize}
                  columnItems={columnItems}
                  onResizeColumnStart={handleResizeStart}
                />}

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
            style={{
              opacity: showStickyHeader ? 1 : 0,
              pointerEvents: showStickyHeader ? 'auto' : 'none',
            }}
            columns={columns}
            data={data}
            totalSize={totalSize}
            columnItems={columnItems}
            onScrollLeft={scrollLeft => {
              parentRef.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
          />
        </DatabaseStickyTopOverlay>

        <DatabaseStickyBottomOverlay scrollElement={virtualizer.scrollElement}>
          <DatabaseStickyHorizontalScrollbar
            onScrollLeft={scrollLeft => {
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