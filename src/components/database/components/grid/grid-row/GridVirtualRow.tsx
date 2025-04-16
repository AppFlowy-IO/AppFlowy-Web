import { DropIndicator } from '@/components/database/components/grid/drag-and-drop/DropIndicator';
import {
  GridDragState,
  ItemState,
  useGridDragContext,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import GridVirtualColumn from '@/components/database/components/grid/grid-column/GridVirtualColumn';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import { cn } from '@/lib/utils';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HoverControls from 'src/components/database/components/grid/controls/HoverControls';

const idleState: ItemState = { type: GridDragState.IDLE };
const draggingState: ItemState = { type: GridDragState.DRAGGING };

function GridVirtualRow ({
  row,
  data,
  columns,
  columnItems,
  totalSize,
}: {
  columnItems: VirtualItem[];
  row: VirtualItem;
  totalSize: number;
  data: RenderRow[]
  columns: RenderColumn[]
}) {
  const { registerRow, instanceId } = useGridDragContext();
  const rowIndex = row.index;
  const rowId = data[rowIndex].rowId as string;

  const rowRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<ItemState>(idleState);

  const [before, after] = useMemo(() => columnItems.length > 0
    ? [
      columnItems[0].start,
      totalSize -
      columnItems[columnItems.length - 1].end,
    ]
    : [0, 0], [columnItems, totalSize]);

  const isRegularRow = data[row.index].type === RenderRowType.Row;

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
        getInitialData: () => data,
        onGenerateDragPreview ({ nativeSetDragImage }) {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: pointerOutsideOfPreview({
              x: '16px',
              y: '8px',
            }),
            render ({ container }) {
              setState({ type: GridDragState.PREVIEW, container });
              return () => setState(draggingState);
            },
          });
        },
        onDragStart () {
          console.log('drag start');
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
  }, [rowId, rowIndex, registerRow, instanceId, dragHandleRef, isRegularRow]);

  const children = useMemo(() => {
    return columnItems.map((column) => {
      return (
        <GridVirtualColumn
          key={column.key}
          columns={columns}
          data={data}
          row={row}
          column={column}
        />
      );
    });
  }, [columnItems, columns, data, row]);

  return (
    <>
      <div
        ref={innerRef}
        className={cn(
          'relative flex',
        )}
      >
        <div style={{ width: `${before}px` }}>
          {isRegularRow && <HoverControls
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
          {state.type === GridDragState.IS_OVER && state.closestEdge && (
            <DropIndicator
              rowIndex={row.index}
              edge={state.closestEdge}
            />
          )}
        </div>

        <div style={{ width: `${after}px` }} />
      </div>

      {state.type === GridDragState.PREVIEW && createPortal(
        <div className={'flex'}>
          {children}
        </div>,
        state.container,
      )}
    </>
  );
}

export default memo(GridVirtualRow);