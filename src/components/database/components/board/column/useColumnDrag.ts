import { Row } from '@/application/database-yjs';
import { useBoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { ColumnContextProps } from '@/components/database/components/board/drag-and-drop/column-context';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export enum StateType {
  IDLE = 'idle',
  IS_CARD_OVER = 'is-card-over',
  IS_COLUMN_OVER = 'is-column-over',
  GENERATE_COLUMN_PREVIEW = 'generate-column-preview',
  GENERATE_SAFARI_COLUMN_PREVIEW = 'generate-safari-column-preview',
}

/**
 * Note: not making `'is-dragging'` a `State` as it is
 * a _parallel_ state to `'is-column-over'`.
 *
 * Our board allows you to be over the column that is currently dragging
 */
type State =
  | { type: StateType.IDLE }
  | { type: StateType.IS_CARD_OVER }
  | { type: StateType.IS_COLUMN_OVER; closestEdge: Edge | null }
  | { type: StateType.GENERATE_SAFARI_COLUMN_PREVIEW; container: HTMLElement }
  | { type: StateType.GENERATE_COLUMN_PREVIEW };

// preventing re-renders with stable state objects
const idle: State = { type: StateType.IDLE };
const isCardOver: State = { type: StateType.IS_CARD_OVER };

export function useColumnDrag (columnId: string, rows: Row[], scrollerContainer: HTMLDivElement | null) {
  const { instanceId, registerColumn } = useBoardContext();
  const columnRef = useRef<HTMLDivElement | null>(null);
  const columnInnerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(idle);
  const stableItems = useRef(rows);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  useEffect(() => {
    stableItems.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!columnRef.current || !columnInnerRef.current || !headerRef.current || !scrollerContainer) {
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
        element: columnInnerRef.current,
        getData: () => ({ columnId }),
        canDrop: ({ source }) => {
          return source.data.instanceId === instanceId && source.data.type === 'card';
        },
        getIsSticky: () => true,
        onDragEnter: () => setState(isCardOver),
        onDragLeave: () => setState(idle),
        onDragStart: () => setState(isCardOver),
        onDrop: () => setState(idle),
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
      autoScrollForElements({
        element: scrollerContainer,
        canScroll: ({ source }) =>
          source.data.instanceId === instanceId && source.data.type === 'card',
      }),
    );

  }, [columnId, instanceId, registerColumn, scrollerContainer]);

  const getCardIndex = useCallback((rowId: string) => {
    return stableItems.current.findIndex((item) => item.id === rowId);
  }, []);

  const getNumCards = useCallback(() => {
    return stableItems.current.length;
  }, []);

  const contextValue: ColumnContextProps = useMemo(() => {
    return { columnId, getCardIndex, getNumCards };
  }, [columnId, getCardIndex, getNumCards]);

  return {
    columnRef,
    columnInnerRef,
    headerRef,
    state,
    contextValue,
    isDragging,
    setIsDragging,
  };
}