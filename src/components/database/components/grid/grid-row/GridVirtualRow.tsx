import { useReadOnly, useSortsSelector } from '@/application/database-yjs';
import ClearSortingConfirm from '@/components/database/components/sorts/ClearSortingConfirm';
import { DropRowIndicator } from '@/components/database/components/grid/drag-and-drop/DropRowIndicator';
import {
  GridDragState,
  ItemState,
  useGridDragContext,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import GridVirtualColumn from '@/components/database/components/grid/grid-column/GridVirtualColumn';
import { GridRowProvider } from '@/components/database/components/grid/grid-row/GridRowContext';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { cn } from '@/lib/utils';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import HoverControls from 'src/components/database/components/grid/controls/HoverControls';

const idleState: ItemState = { type: GridDragState.IDLE };
const draggingState: ItemState = { type: GridDragState.DRAGGING };

function GridVirtualRow ({
  row,
  data,
  columns,
  columnItems,
  totalSize,
  onResizeColumnStart,
  isSticky,
}: {
  isSticky?: boolean;
  columnItems: VirtualItem[];
  row: VirtualItem;
  totalSize: number;
  data: RenderRow[];
  columns: RenderColumn[];
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const { registerRow, rowInstanceId: instanceId } = useGridDragContext();
  const rowIndex = row.index;
  const rowId = data[rowIndex].rowId as string;
  const rowType = data[rowIndex].type;
  const {
    setHoverRowId,
  } = useGridContext();
  const rowRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<ItemState>(idleState);
  const sorts = useSortsSelector();
  const [openClearSortsConfirmed, setOpenClearSortsConfirmed] = useState(false);

  const hasSorted = sorts.length > 0;
  const [before, after] = useMemo(() => columnItems.length > 0
    ? [
      columnItems[0].start,
      totalSize -
      columnItems[columnItems.length - 1].end,
    ]
    : [0, 0], [columnItems, totalSize]);

  const isRegularRow = rowType === RenderRowType.Row;

  useEffect(() => {
    const element = innerRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle || !isRegularRow) return;

    const data = {
      instanceId,
      rowId,
      index: rowIndex,
    };

    return combine(
      registerRow({ rowId, element }),
      draggable({
        element,
        dragHandle,
        canDrag: () => {
          if (hasSorted) {
            setOpenClearSortsConfirmed(true);
          }

          return !hasSorted;
        },
        getInitialData: () => data,
        onGenerateDragPreview () {
          setState({ type: GridDragState.PREVIEW });
        },
        onDragStart () {
          setState(draggingState);
        },
        onDrop () {
          setState(idleState);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data &&
          source.data.instanceId === instanceId &&
          source.data.rowId !== rowId,
        getIsSticky: () => true,
        getData ({ input }) {
          return attachClosestEdge(data, {
            element,
            input,
            allowedEdges: ['top', 'bottom'],
          });
        },
        onDrag ({ self }) {
          const closestEdge = extractClosestEdge(self.data);

          setState((current) => {
            if (current.type === GridDragState.IS_OVER && current.closestEdge === closestEdge) {
              return current;
            }

            return { type: GridDragState.IS_OVER, closestEdge };
          });
        },
        onDragLeave () {
          setState(idleState);
        },
        onDrop () {
          setState(idleState);
        },
      }),
    );
  }, [hasSorted, rowId, rowIndex, registerRow, instanceId, dragHandleRef, isRegularRow]);
  const readOnly = useReadOnly();

  const children = useMemo(() => {

    return columnItems.map((column) => {
      return (
        <GridVirtualColumn
          key={column.key}
          columns={columns}
          data={data}
          row={row}
          column={column}
          onResizeColumnStart={onResizeColumnStart}
        />
      );
    });
  }, [columnItems, columns, data, row, onResizeColumnStart]);

  return (
    <GridRowProvider
      value={{
        isSticky,
      }}
    >
      <div
        onMouseMove={() => setHoverRowId(rowId)}
        onMouseLeave={() => setHoverRowId(undefined)}
        ref={innerRef}
        className={cn(
          'relative flex',
        )}
      >
        <div style={{ width: `${before}px` }}>
          {isRegularRow && !readOnly && <HoverControls
            state={state}
            dragHandleRef={el => {
              dragHandleRef.current = el;
            }}
            rowId={data[row.index].rowId as string}
          />}
        </div>
        <div
          ref={rowRef}
          className={cn(
            'relative flex',
            state.type === GridDragState.DRAGGING && 'opacity-40',
          )}
        >
          {children}
          {state.type === GridDragState.IS_OVER && isRegularRow && state.closestEdge && (
            <DropRowIndicator
              edge={state.closestEdge}
            />
          )}
        </div>

        <div style={{ width: `${after}px` }} />
      </div>
      <ClearSortingConfirm
        onClose={() => setOpenClearSortsConfirmed(false)}
        open={openClearSortsConfirmed}
      />
    </GridRowProvider>
  );
}

export default memo(GridVirtualRow);