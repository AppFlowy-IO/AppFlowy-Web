import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { VirtualItem } from '@tanstack/react-virtual';
import { uniqBy } from 'lodash-es';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useReadOnly, useRowData, useSortsSelector } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { HOVER_CONTROLS_WIDTH, HoverControls } from '@/components/database/components/grid/controls/HoverControls';
import {
  GridDragState,
  ItemState,
  useGridDragContext,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import GridVirtualColumn from '@/components/database/components/grid/grid-column/GridVirtualColumn';
import { GridRowProvider } from '@/components/database/components/grid/grid-row/GridRowContext';
import { useGridRowDraggable } from '@/components/database/components/grid/grid-row/useGridRowDraggable';
import { getRenderRowKey, RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import { ClearSortingConfirm } from '@/components/database/components/sorts/ClearSortingConfirm';
import {
  useGridContext,
  useGridInteractionActions,
  useGridOptions,
  useIsGridRowActive,
} from '@/components/database/grid/useGridContext';
import { cn } from '@/lib/utils';

const idleState: ItemState = { type: GridDragState.IDLE };

/**
 * One row of the grid. It takes its index and its own render row, not the
 * virtualizer's item or the whole stream: both are new whenever rows are
 * added, and a row that did not change keeps its render then.
 */
function GridVirtualRow({
  rowIndex,
  rowData,
  columns,
  columnItems,
  totalSize,
  onResizeColumnStart,
  isSticky,
}: {
  isSticky?: boolean;
  columnItems: VirtualItem[];
  rowIndex: number;
  rowData: RenderRow;
  totalSize: number;
  columns: RenderColumn[];
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const { registerRow, rowInstanceId: instanceId } = useGridDragContext();
  const rowId = rowData.rowId as string;
  const rowKey = getRenderRowKey(rowData);
  const rowType = rowData.type;
  const { isGrouped, rowResizeStore } = useGridContext();
  const { rowMeasure } = useGridOptions();
  const { setHoverRowKey } = useGridInteractionActions();
  const hasActiveCell = useIsGridRowActive(rowKey);
  const databaseRow = useRowData(rowId);
  const cells = databaseRow?.get(YjsDatabaseKey.cells);
  const cellsCount = cells?.size;

  const rowRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ItemState>(idleState);
  const sorts = useSortsSelector();

  const [openClearSortsConfirmed, setOpenClearSortsConfirmed] = useState(false);

  const hasSorted = sorts.length > 0;
  const [before, after] = useMemo(
    () =>
      columnItems.length > 0 ? [columnItems[0].start, totalSize - columnItems[columnItems.length - 1].end] : [0, 0],
    [columnItems, totalSize]
  );

  const isRegularRow = rowType === RenderRowType.Row;

  useEffect(() => {
    const element = innerRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle || !isRegularRow || isGrouped) return;

    const data = {
      instanceId,
      rowId,
      index: rowIndex,
    };

    return combine(
      registerRow({ rowId, element }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          if (hasSorted) {
            setOpenClearSortsConfirmed(true);
            return false;
          }

          return source.data && source.data.instanceId === instanceId && source.data.rowId !== rowId;
        },
        getIsSticky: () => true,
        getData({ input }) {
          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: ['top', 'bottom'],
          });
        },
        onDrag({ self }) {
          const closestEdge = extractClosestEdge(self.data);

          setState((current) => {
            if (current.type === GridDragState.IS_OVER && current.closestEdge === closestEdge) {
              return current;
            }

            return { type: GridDragState.IS_OVER, closestEdge };
          });
        },
        onDragLeave() {
          setState(idleState);
        },
        onDrop() {
          setState(idleState);
        },
      })
    );
  }, [hasSorted, rowId, rowIndex, registerRow, instanceId, dragHandleRef, isGrouped, isRegularRow]);

  useGridRowDraggable({
    elementRef: innerRef,
    dragHandleRef,
    // Firefox prevents text selection inside a native draggable ancestor.
    enabled: isRegularRow && !hasActiveCell && !isGrouped,
    instanceId,
    rowId,
    rowIndex,
    setState,
  });
  const readOnly = useReadOnly();

  const children = useMemo(() => {
    return uniqBy(columnItems, 'key').map((column) => {
      return (
        <GridVirtualColumn
          key={column.key}
          columns={columns}
          rowIndex={rowIndex}
          rowData={rowData}
          column={column}
          onResizeColumnStart={onResizeColumnStart}
        />
      );
    });
  }, [columnItems, columns, rowIndex, rowData, onResizeColumnStart]);

  const measureRow = useCallback(() => {
    const row = rowRef.current;
    // `row`: the reported size includes the row's 1px divider, so the pitch is
    // the 37px the row draws (addendum A5.2) and rows never overlap.
    const cells = row?.querySelectorAll(rowMeasure === 'row' ? '.grid-row-cell' : '.grid-cell');

    if (!cells || !rowId) return undefined;
    return Array.from(cells).reduce((acc, cell) => {
      const cellHeight = cell.getBoundingClientRect().height;

      return Math.max(acc, cellHeight, 35); // Ensure minimum height
    }, 0);
  }, [rowMeasure, rowId]);

  // Inside a ResizeObserver callback the layout is clean, so the row reads it at once.
  const onResize = useCallback(() => {
    const maxCellHeight = measureRow();

    if (maxCellHeight !== undefined) rowResizeStore.report(rowKey, maxCellHeight);
  }, [measureRow, rowKey, rowResizeStore]);

  // Anywhere else a read would force a layout per row: the grid measures every
  // row that asked in one pass at the next frame (W18).
  const scheduleResize = useCallback(
    () => rowResizeStore.schedule(rowKey, measureRow),
    [measureRow, rowKey, rowResizeStore]
  );

  // The grid's one ResizeObserver, not one per row (W15).
  useEffect(() => {
    const el = innerRef.current;

    if (!el) return;

    return rowResizeStore.observe(el, onResize);
  }, [onResize, rowResizeStore]);

  useEffect(() => {
    if (!cells || !cellsCount) return;

    if (isRegularRow && cells) {
      scheduleResize();
    }

    cells.observeDeep(scheduleResize);

    return () => {
      cells.unobserveDeep(scheduleResize);
    };
  }, [isRegularRow, scheduleResize, cells, cellsCount]);

  // Every cell of the row reads it: a new object would re-render them all.
  const rowContextValue = useMemo(() => ({ isSticky, resizeRow: scheduleResize }), [isSticky, scheduleResize]);

  return (
    <GridRowProvider value={rowContextValue}>
      <div
        onMouseMove={() => setHoverRowKey(rowKey)}
        onMouseLeave={() => setHoverRowKey(undefined)}
        ref={innerRef}
        className={cn('relative flex')}
      >
        <div style={{ width: `${before}px` }}>
          {isRegularRow && !readOnly && (
            <HoverControls
              compact={before < HOVER_CONTROLS_WIDTH}
              state={state}
              dragHandleRef={(el) => {
                dragHandleRef.current = el;
              }}
              rowId={rowId}
              rowKey={rowKey}
              groupFieldId={rowData.groupFieldId}
              groupId={rowData.groupId}
              canDrag={!isGrouped}
            />
          )}
        </div>
        <div
          ref={rowRef}
          data-testid={`grid-row-${rowId}`}
          data-row-key={rowKey}
          data-parity-id={
            rowType === RenderRowType.Header
              ? 'dash-widget-grid-header'
              : isRegularRow
              ? 'dash-widget-grid-row'
              : undefined
          }
          className={cn(
            'grid-table-row-content relative flex min-h-[36px]',
            state.type === GridDragState.DRAGGING && 'opacity-40'
          )}
        >
          {children}
          {state.type === GridDragState.IS_OVER && isRegularRow && state.closestEdge && (
            <DropRowIndicator edge={state.closestEdge} />
          )}
        </div>

        <div style={{ width: `${after}px` }} />
      </div>
      {openClearSortsConfirmed && (
        <ClearSortingConfirm onClose={() => setOpenClearSortsConfirmed(false)} open={openClearSortsConfirmed} />
      )}
    </GridRowProvider>
  );
}

export default memo(GridVirtualRow);
