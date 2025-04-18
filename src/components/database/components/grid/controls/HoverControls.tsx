import { useHoverControlsDisplay } from '@/components/database/components/grid/controls/HoverControls.hooks';
import { ItemState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { Button } from '@/components/ui/button';
import React from 'react';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';

export function HoverControls ({ rowId, dragHandleRef }: {
  rowId: string;
  dragHandleRef?: (node: HTMLButtonElement | null) => void;
  state: ItemState
}) {
  const { ref } = useHoverControlsDisplay(rowId);

  return (
    <>
      <div
        ref={ref}
        style={{
          minHeight: 36,
        }}
        className={'flex border w-full border-transparent py-1 items-start left-0 justify-end'}
      >
        <Button
          variant={'ghost'}
          size={'icon'}
          className={'text-icon-secondary'}
        >
          <AddIcon />
        </Button>
        <Button
          ref={dragHandleRef}
          variant={'ghost'}
          size={'icon'}
          className={'text-icon-secondary'}
        >
          <DragIcon />
        </Button>

      </div>

    </>
  );
}

export default HoverControls;