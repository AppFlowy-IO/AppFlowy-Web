import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useEffect, useRef, useState } from 'react';

import { useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { useHidePropertyDispatch, useShowPropertyDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { usePropertyDragContext } from '@/components/database/components/settings/usePropertyDragContext';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import FieldDisplay from 'src/components/database/components/field/FieldDisplay';

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

function Property({
  property,
}: {
  property: {
    id: string;
    visible: boolean;
  };
}) {
  const { registerProperty, instanceId } = usePropertyDragContext();
  const { field } = useFieldSelector(property.id);
  const name = field?.get(YjsDatabaseKey.name);
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
        onGenerateDragPreview() {
          setState({ type: DragState.PREVIEW });
        },
        onDragStart() {
          setState(draggingState);
        },
        onDrop() {
          setState(idleState);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data && source.data.instanceId === instanceId && source.data.id !== id,
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
            if (current.type === DragState.IS_OVER && current.closestEdge === closestEdge) {
              return current;
            }

            return { type: DragState.IS_OVER, closestEdge };
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
  }, [readOnly, instanceId, registerProperty, id]);

  return (
    <DropdownMenuItem
      ref={innerRef}
      onSelect={(e) => {
        e.preventDefault();
        if (visible) {
          onHideProperty(id);
        } else {
          onShowProperty(id);
        }
      }}
      className={cn('relative', state.type === DragState.DRAGGING && 'opacity-40')}
    >
      <div ref={dragHandleRef} className={'flex w-full cursor-grab items-center gap-[10px] overflow-hidden'}>
        <DragIcon className={'!text-icon-secondary'} />
        <Tooltip delayDuration={1000}>
          <TooltipTrigger className={'w-full overflow-hidden text-left'}>
            <FieldDisplay className={'flex-1 gap-[10px]  truncate'} fieldId={property.id} />
          </TooltipTrigger>
          <TooltipContent side={'right'}>{name}</TooltipContent>
        </Tooltip>

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

        {state.type === DragState.IS_OVER && state.closestEdge && <DropRowIndicator edge={state.closestEdge} />}
      </div>
    </DropdownMenuItem>
  );
}

export default Property;
