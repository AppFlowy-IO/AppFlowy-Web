import { memo, type UIEvent, useCallback, useEffect, useRef, useState } from 'react';

import { PADDING_END, useDatabaseContext } from '@/application/database-yjs';
import { GridDragContext } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import GridGroupHeader from '@/components/database/components/grid/grid-group/GridGroupHeader';
import { getRenderRowKey, type RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row';
import GridLoadMoreRow from '@/components/database/components/grid/grid-row/GridLoadMoreRow';
import GridNewRow from '@/components/database/components/grid/grid-row/GridNewRow';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import GridStickyHeader from '@/components/database/components/grid/grid-table/GridStickyHeader';
import { useGridDnd } from '@/components/database/components/grid/grid-table/useGridDnd';
import { PADDING_INLINE, useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';
import { RowsLoadingRow } from '@/components/database/components/loading/RowsLoadingRow';
import DatabaseStickyBottomOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay';
import DatabaseStickyHorizontalScrollbar from '@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { useGridContext, useGridHydration } from '@/components/database/grid/useGridContext';
import { getEmbeddedGridViewportStyle } from '@/components/database/layout';
import { TooltipGroupProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useColumnResize } from '../grid-column/useColumnResize';

/** The header row the sticky header draws; one object, so its memoized row keeps its render. */
const STICKY_HEADER_ROW: RenderRow = Object.freeze({ key: 'sticky-header', type: RenderRowType.Header });

/**
 * The loading row. For a view still reading its rows it reports how many it
 * read, so a slow, large source never looks like an empty result.
 */
function GridLoadingRow() {
  return (
    <RowsLoadingRow
      hydration={useGridHydration()}
      testId={'grid-loading-indicator'}
      progressTestId={'grid-loading-progress'}
    />
  );
}

function GridVirtualizer({ columns }: { columns: RenderColumn[] }) {
  const { rows: data, rowOrders } = useGridContext();
  const { handleResizeStart, isResizing } = useColumnResize(columns);
  const { dataSource, embeddedHeight, isDocumentBlock, paddingEnd } = useDatabaseContext();
  const isHistoryPreview = dataSource?.type === 'history';

  const { parentRef, virtualizer, columnVirtualizer, scrollMarginTop, isReady, pinColumnHeader } = useGridVirtualizer({
    data,
    columns,
  });

  const rowItems = virtualizer.getVirtualItems();
  const columnItems = columnVirtualizer.getVirtualItems();
  const totalSize = columnVirtualizer.getTotalSize();
  const gridContentHeight = virtualizer.getTotalSize();
  const embeddedViewportStyle = getEmbeddedGridViewportStyle({
    contentHeight: gridContentHeight,
    embeddedHeight,
    isDocumentBlock,
    isLoading: rowOrders === undefined,
  });

  const contextValue = useGridDnd(columns, virtualizer, columnVirtualizer);
  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [isHover, setIsHover] = useState(false);
  const handleMouseEnter = useCallback(() => setIsHover(true), []);
  const handleMouseLeave = useCallback(() => setIsHover(false), []);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const { setShowStickyHeader } = useGridContext();
  const stickyHeaderVisibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isResizing) {
      columnVirtualizer.measure();
    }
  }, [columnVirtualizer, isResizing, columns]);

  useEffect(() => {
    const scrollElement = virtualizer.scrollElement;
    const gridElement = parentRef.current;

    // Embedded grids have no external sticky header to position.
    if (!scrollElement || !gridElement || !stickyHeaderRef.current) return;

    const onScroll = () => {
      const gridRect = gridElement.getBoundingClientRect();
      const gridTop = gridRect.top ?? 0;
      const bottom = gridRect.bottom ?? 0;
      const stickyHeader = stickyHeaderRef.current;

      if (!stickyHeader) return;

      // History scrolls inside a dialog, whose top differs from the page header.
      const stickyTop = isHistoryPreview ? scrollElement.getBoundingClientRect().top : 48;
      const shouldShowStickyHeader = gridTop <= stickyTop && bottom - PADDING_END >= stickyTop;

      if (stickyHeaderVisibleRef.current !== shouldShowStickyHeader) {
        stickyHeaderVisibleRef.current = shouldShowStickyHeader;
        stickyHeader.style.opacity = shouldShowStickyHeader ? '1' : '0';
        stickyHeader.style.pointerEvents = shouldShowStickyHeader ? 'auto' : 'none';
        setShowStickyHeader(shouldShowStickyHeader);
      }
    };

    onScroll();
    const scrollListenerOptions: AddEventListenerOptions = { passive: true };

    scrollElement.addEventListener('scroll', onScroll, scrollListenerOptions);
    return () => {
      scrollElement.removeEventListener('scroll', onScroll, scrollListenerOptions);
    };
  }, [isHistoryPreview, parentRef, scrollMarginTop, virtualizer.scrollElement, setShowStickyHeader]);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;

    stickyHeaderRef.current?.scroll({
      left: scrollLeft,
      behavior: 'auto',
    });

    bottomScrollbarRef.current?.scroll({
      left: scrollLeft,
      behavior: 'auto',
    });
  }, []);

  const handleScrollLeft = useCallback(
    (scrollLeft: number) => {
      parentRef.current?.scrollTo({
        left: scrollLeft,
        behavior: 'auto',
      });
    },
    [parentRef]
  );

  return (
    <GridDragContext.Provider value={contextValue}>
      {/* One tooltip provider for the grid's rows and cells, not one per tooltip (W8). */}
      <TooltipGroupProvider>
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          ref={parentRef}
          data-parity-id='dash-widget-grid-scrollbar'
          className={cn(
            'appflowy-custom-scroller appflowy-hidden-horizontal-scrollbar',
            isDocumentBlock && 'min-h-0',
            isDocumentBlock && embeddedViewportStyle?.height === undefined && 'flex-1'
          )}
          style={{
            height: embeddedViewportStyle?.height,
            maxHeight: embeddedViewportStyle?.maxHeight,
            overflowY: 'auto',
            overflowX: 'auto',
            scrollBehavior: 'auto',
          }}
          onScroll={handleScroll}
        >
          <div
            style={{
              height: gridContentHeight,
              position: 'relative',
              opacity: isReady ? 1 : 0, // Hide content until parent offset is stable to prevent scroll jumps
            }}
          >
            {rowItems.map((row) => {
              const rowData = data[row.index];
              const rowId = rowData.rowId;
              const isPlaceholderRow = rowData.type === RenderRowType.PlaceholderRow;
              const isPinnedHeader = pinColumnHeader && rowData.type === RenderRowType.Header;
              const isFullWidthControlRow =
                rowData.type === RenderRowType.NewRow ||
                rowData.type === RenderRowType.LoadMoreRow ||
                rowData.type === RenderRowType.GroupHeader ||
                rowData.type === RenderRowType.GroupSeparator;

              return (
                <div
                  key={row.key}
                  data-row-id={rowId}
                  data-row-key={getRenderRowKey(rowData)}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className={isPinnedHeader ? 'bg-dash-card-bg' : undefined}
                  style={{
                    position: isPinnedHeader ? 'sticky' : 'absolute',
                    top: 0,
                    left: isPinnedHeader ? undefined : 0,
                    width: isPinnedHeader ? totalSize : undefined,
                    transform: isPinnedHeader
                      ? undefined
                      : `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                    display: 'flex',
                    right: isPlaceholderRow ? 0 : undefined,
                    pointerEvents: isPlaceholderRow ? 'none' : undefined,
                    zIndex: isPinnedHeader ? 2 : rowData.type === RenderRowType.NewRow ? 1 : undefined,
                  }}
                >
                  {isPlaceholderRow ? (
                    <GridLoadingRow />
                  ) : isFullWidthControlRow ? (
                    <div
                      style={{
                        paddingLeft: columnItems[0]?.start,
                        paddingRight: isDocumentBlock ? 0 : PADDING_INLINE,
                        width: totalSize - (paddingEnd ?? 0),
                      }}
                    >
                      {rowData.type === RenderRowType.LoadMoreRow ? (
                        <GridLoadMoreRow remainingCount={rowData.remainingRowCount ?? 0} />
                      ) : rowData.type === RenderRowType.GroupHeader ? (
                        <GridGroupHeader data={rowData} />
                      ) : rowData.type === RenderRowType.GroupSeparator ? (
                        <div aria-hidden className='h-3 min-w-full bg-fill-content' />
                      ) : (
                        <GridNewRow groupFieldId={rowData.groupFieldId} groupId={rowData.groupId} />
                      )}
                    </div>
                  ) : (
                    <GridVirtualRow
                      rowIndex={row.index}
                      rowData={rowData}
                      columns={columns}
                      totalSize={totalSize}
                      columnItems={columnItems}
                      onResizeColumnStart={handleResizeStart}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!isDocumentBlock && (
            <DatabaseStickyTopOverlay>
              <GridStickyHeader
                ref={stickyHeaderRef}
                columns={columns}
                rowData={STICKY_HEADER_ROW}
                totalSize={totalSize}
                columnItems={columnItems}
                onScrollLeft={handleScrollLeft}
                onResizeColumnStart={handleResizeStart}
              />
            </DatabaseStickyTopOverlay>
          )}

          <DatabaseStickyBottomOverlay scrollElement={virtualizer.scrollElement}>
            <DatabaseStickyHorizontalScrollbar
              onScrollLeft={handleScrollLeft}
              ref={bottomScrollbarRef}
              totalSize={totalSize}
              visible={Boolean(isHover && totalSize)}
            />
          </DatabaseStickyBottomOverlay>
        </div>
      </TooltipGroupProvider>
    </GridDragContext.Provider>
  );
}

/**
 * Memoized: its only prop is memoized and the contexts it reads keep their
 * values on a tick that only moves the loading progress, so such a tick stops
 * at the grid provider instead of re-rendering every row and cell.
 */
export default memo(GridVirtualizer);
