import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useEffect, useRef, useState } from 'react';

import { SelectOption, useReadOnly } from '@/application/database-yjs';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import OptionMenu from '@/components/database/components/property/select/OptionMenu';
import { useOptionDragContext } from '@/components/database/components/property/select/useOptionDragContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';



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

function Option({
  option,
  fieldId,
  isSelected = false,
  onSelect,
  isHovered,
  onHover,
}: {
  option: SelectOption;
  fieldId: string;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string) => void;
  isHovered?: boolean;
}) {
  const id = option.id;
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const { registerOption, instanceId } = useOptionDragContext();
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
      registerOption({ id, element }),
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
  }, [readOnly, instanceId, registerOption, id]);

  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      <div
        ref={innerRef}
        key={option.id}
        data-testid={`select-option-${option.id}`}
        onClick={(e) => {
          e.preventDefault();
          if (onSelect) {
            onSelect(option.id);
          } else {
            setOpen(true);
          }
        }}
        onMouseEnter={() => {
          if (onHover) {
            onHover(option.id);
          }
        }}
        className={cn(
          'relative',
          state.type === DragState.DRAGGING && 'opacity-40',
          open && 'bg-fill-content-hover',
          'relative flex min-h-[32px] cursor-pointer items-center gap-[10px] rounded-300 px-2 py-1',
          'outline-hidden select-none text-sm text-text-primary',
          'hover:bg-fill-content-hover hover:text-text-primary',
          isHovered && 'bg-fill-content-hover text-text-primary'
        )}
      >
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          ref={dragHandleRef}
        >
          <DragIcon className={'h-5 w-5 text-icon-secondary'} />
        </div>

        <Tag
          key={option.id}
          textColor={SelectOptionFgColorMap[option.color]}
          bgColor={SelectOptionColorMap[option.color]}
          label={option.name}
        />
        <div className={'ml-auto flex h-6 items-center gap-1'}>
          {isSelected && (
            <span className={cn('ml-auto tracking-widest text-icon-info-thick')}>
              <CheckIcon className={'h-5 w-5'} />
            </span>
          )}

          <Button
            variant={'ghost'}
            size={'icon-sm'}
            onClick={(e) => {
              if (onSelect) {
                e.stopPropagation();
                setOpen(true);
              }
            }}
          >
            <MoreIcon className={'h-5 w-5 text-icon-secondary'} />
          </Button>
        </div>

        {state.type === DragState.IS_OVER && state.closestEdge && <DropRowIndicator edge={state.closestEdge} />}
        {<OptionMenu open={open} onOpenChange={setOpen} fieldId={fieldId} option={option} />}
      </div>
    </>
  );
}

export default Option;
