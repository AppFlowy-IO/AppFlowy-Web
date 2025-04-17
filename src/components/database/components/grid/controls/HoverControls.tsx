import { useHoverControlsDisplay } from '@/components/database/components/grid/controls/HoverControls.hooks';
import { ItemState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { Button } from '@/components/ui/button';
import React from 'react';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';

export function HoverControls ({ rowId, dragHandleRef }: {
  rowId: string;
  dragHandleRef?: (node: HTMLButtonElement | null) => void;
  state: ItemState
}) {
  const { ref } = useHoverControlsDisplay(rowId);

  return (
    <div
      ref={ref}
      style={{
        minWidth: 96,
        minHeight: 36,
      }}
      className={'flex border border-transparent py-1 items-start left-0 justify-end'}
    >
      <Button
        ref={dragHandleRef}
        variant={'ghost'}
        size={'icon'}
      >
        <DragIcon />
      </Button>

    </div>
  );
}

export default HoverControls;