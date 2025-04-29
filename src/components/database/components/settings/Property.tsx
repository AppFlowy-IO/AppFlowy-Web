import { useReadOnly } from '@/application/database-yjs';
import { useHidePropertyDispatch, useShowPropertyDispatch } from '@/application/database-yjs/dispatch';
import { DropRowIndicator } from '@/components/database/components/grid/drag-and-drop/DropRowIndicator';
import { usePropertyDragContext } from '@/components/database/components/settings/usePropertyDragContext';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';

import React, { useEffect, useRef, useState } from 'react';
import FieldDisplay from 'src/components/database/components/field/FieldDisplay';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';

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

function Property ({ property }: {
  property: {
    id: string;
    visible: boolean
  };
}) {
  const {
    registerProperty,
    instanceId,
  } = usePropertyDragContext();

  const onHideProperty = useHidePropertyDispatch();
  const onShowProperty = useShowPropertyDispatch();

  const { id, visible } = property;
  const innerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement | null>(null);
  const readOnly = useReadOnly();
  const [state, setState] = useState<ItemState>(idleState);

  useEffect(() => {
    const element = innerRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle || readOnly) return;

    const data = {
      instanceId,
      id,
    };

    return combine(
      registerProperty({ id, element }),
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
  }, [readOnly, instanceId, registerProperty, id]);

  return (
    <DropdownMenuItem
      ref={innerRef}
      className={cn('relative', state.type === DragState.DRAGGING && 'opacity-40')}
    >
      <div
        ref={dragHandleRef}
        className={'w-full flex gap-[10px] items-center'}
      >
        <DragIcon className={'!text-icon-secondary'} />
        <FieldDisplay
          className={'gap-[10px] [&_svg]:text-icon-secondary [&_.custom-icon_svg]:w-4 [&_.custom-icon_svg]:h-4  flex-1'}
          fieldId={property.id}
        />
        <Button
          variant={'ghost'}
          size={'icon-sm'}
          onClick={(e) => {
            e.stopPropagation();
            if (visible) {
              onHideProperty(id);
            } else {
              onShowProperty(id);
            }
          }}
        >
          {visible ? <ShowIcon /> : <HideIcon />}
        </Button>

        {state.type === DragState.IS_OVER && state.closestEdge && (
          <DropRowIndicator
            edge={state.closestEdge}
          />
        )}
      </div>

    </DropdownMenuItem>
  );
}

export default Property;