import { useBoardContext } from '@/components/database/components/board/drag-and-drop/board-context';

import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useRef, useState } from 'react';

export enum StateType {
  IDLE = 'idle',
  IS_COLUMN_OVER = 'is-column-over',
  GENERATE_COLUMN_PREVIEW = 'generate-column-preview',
}

type State =
  | { type: StateType.IDLE }
  | { type: StateType.IS_COLUMN_OVER; closestEdge: Edge | null }
  | { type: StateType.GENERATE_COLUMN_PREVIEW };

// preventing re-renders with stable state objects
const idle: State = { type: StateType.IDLE };

export function useColumnHeaderDrag (columnId: string) {
  const { instanceId, registerColumn } = useBoardContext();
  const columnRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(idle);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  useEffect(() => {
    if (!columnRef.current || !headerRef.current) {
      return;
    }

    return combine(
      registerColumn({
        columnId,
        entry: {
          element: columnRef.current,
        },
      }),
      draggable({
        element: columnRef.current,
        dragHandle: headerRef.current,
        getInitialData: () => ({ columnId, type: 'column', instanceId }),
        onGenerateDragPreview: () => {
          setState({ type: StateType.GENERATE_COLUMN_PREVIEW });
        },
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop () {
          setState(idle);
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element: columnRef.current,
        canDrop: ({ source }) => {
          return source.data.instanceId === instanceId && source.data.type === 'column';
        },
        getIsSticky: () => true,
        getData: ({ input, element }) => {
          const data = {
            columnId,
          };

          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges: ['left', 'right'],
          });
        },
        onDragEnter: (args) => {
          setState({
            type: StateType.IS_COLUMN_OVER,
            closestEdge: extractClosestEdge(args.self.data),
          });
        },
        onDrag: (args) => {
          // skip react re-render if edge is not changing
          setState((current) => {
            const closestEdge: Edge | null = extractClosestEdge(args.self.data);

            if (current.type === StateType.IS_COLUMN_OVER && current.closestEdge === closestEdge) {
              return current;
            }

            return {
              type: StateType.IS_COLUMN_OVER,
              closestEdge,
            };
          });
        },
        onDragLeave: () => {
          setState(idle);
        },
        onDrop: () => {
          setState(idle);
        },
      }),
    );

  }, [columnId, instanceId, registerColumn]);

  return {
    columnRef,
    headerRef,
    state,
    isDragging,
  };
}