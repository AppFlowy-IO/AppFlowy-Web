import { Row, useReadOnly } from '@/application/database-yjs';
import { useBoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { ColumnContextProps } from '@/components/database/components/board/drag-and-drop/column-context';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export enum StateType {
  IDLE = 'idle',
  IS_CARD_OVER = 'is-card-over',
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

// preventing re-renders with stable state objects
const idle: State = { type: StateType.IDLE };
const isCardOver: State = { type: StateType.IS_CARD_OVER };

export function useCardsDrag (columnId: string, rows: Row[], scrollerContainer: HTMLDivElement | null) {
  const { instanceId, registerColumn } = useBoardContext();
  const columnInnerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(idle);
  const stableItems = useRef(rows);
  const readOnly = useReadOnly();

  useEffect(() => {
    stableItems.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!columnInnerRef.current || !scrollerContainer || readOnly) {
      return;
    }

    return combine(
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
      autoScrollForElements({
        element: scrollerContainer,
        canScroll: ({ source }) =>
          source.data.instanceId === instanceId && source.data.type === 'card',
      }),
    );

  }, [readOnly, columnId, instanceId, registerColumn, scrollerContainer]);

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
    columnInnerRef,
    state,
    contextValue,
  };
}