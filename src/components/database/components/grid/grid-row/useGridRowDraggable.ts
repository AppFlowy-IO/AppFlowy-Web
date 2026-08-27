import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Dispatch, RefObject, SetStateAction, useEffect } from 'react';

import {
  GridDragState,
  ItemState,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';

export function useGridRowDraggable({
  elementRef,
  dragHandleRef,
  enabled,
  instanceId,
  rowId,
  rowIndex,
  setState,
}: {
  elementRef: RefObject<HTMLDivElement>;
  dragHandleRef: RefObject<HTMLDivElement>;
  enabled: boolean;
  instanceId: symbol;
  rowId: string;
  rowIndex: number;
  setState: Dispatch<SetStateAction<ItemState>>;
}) {
  useEffect(() => {
    const element = elementRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle || !enabled) return;

    const data = {
      instanceId,
      rowId,
      index: rowIndex,
    };

    return draggable({
      element,
      dragHandle,
      getInitialData: () => data,
      onGenerateDragPreview() {
        setState({ type: GridDragState.PREVIEW });
      },
      onDragStart() {
        setState({ type: GridDragState.DRAGGING });
      },
      onDrop() {
        setState({ type: GridDragState.IDLE });
      },
    });
  }, [dragHandleRef, elementRef, enabled, instanceId, rowId, rowIndex, setState]);
}
