import {
  useTaskDragContext,
} from '@/components/database/components/cell/checklist/useTaskDragContext';
import { cn } from '@/lib/utils';

import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { DropRowIndicator } from '@/components/database/components/grid/drag-and-drop/DropRowIndicator';

export enum DragState {
  IDLE = 'idle',
  DRAGGING = 'dragging',
  IS_OVER = 'is-over',
  PREVIEW = 'preview',
}

export type ItemState =
  | { type: DragState.IDLE }
  | { type: DragState.PREVIEW }
  | { type: DragState.DRAGGING }
  | { type: DragState.IS_OVER; closestEdge: string | null };

const idleState: ItemState = { type: DragState.IDLE };
const draggingState: ItemState = { type: DragState.DRAGGING };

function DragTask ({ id, children }: { id: string, children: React.ReactNode }) {
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const {
    registerTask,
    instanceId,
  } = useTaskDragContext();

  const [state, setState] = useState<ItemState>(idleState);

  useEffect(() => {
    const element = innerRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle) return;

    const data = {
      instanceId,
      id,
    };

    return combine(
      registerTask({ id, element }),
      draggable({
        element,
        dragHandle,
        getInitialData: () => data,
        onGenerateDragPreview () {
          setState({ type: DragState.PREVIEW });
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
          source.data.id !== id,
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
            if (current.type === DragState.IS_OVER && current.closestEdge === closestEdge) {
              return current;
            }

            return { type: DragState.IS_OVER, closestEdge };
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
  }, [instanceId, registerTask, id]);
  return (
    <div
      ref={innerRef}
      className={cn('w-full relative flex items-center gap-1', state.type === DragState.DRAGGING && 'opacity-40')}
    >
      <div
        onMouseDown={e => {
          e.stopPropagation();
        }}
        ref={dragHandleRef}
      >
        <DragIcon className={'w-5 h-5 text-icon-secondary'} />
      </div>

      <div className={'flex items-center'}>{children}</div>

      {state.type === DragState.IS_OVER && state.closestEdge && (
        <DropRowIndicator
          edge={state.closestEdge}
        />
      )}
    </div>
  );
}

export default DragTask;