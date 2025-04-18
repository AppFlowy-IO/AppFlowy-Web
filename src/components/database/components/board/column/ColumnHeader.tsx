import { useColumnHeaderDrag, StateType } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';
import React from 'react';

function ColumnHeader ({
  id,
  fieldId,
  rowCount,
}: {
  id: string;
  fieldId: string;
  rowCount: number
}) {
  const { header } = useRenderColumn(id, fieldId);
  const {
    columnRef,
    headerRef,
    state,
    isDragging,
  } = useColumnHeaderDrag(id);

  return (
    <div
      ref={columnRef}
      key={id}
      style={{
        opacity: isDragging ? 0.4 : 1,
        pointerEvents: isDragging ? 'none' : undefined,
      }}
      className="flex relative items-center flex-col rounded-[8px] pb-0 w-[256px] pt-2 h-full"
    >
      <div
        ref={headerRef}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        className="column-header select-none flex overflow-hidden justify-start w-[240px] items-center gap-2 h-[26px] text-sm leading-[16px] font-medium whitespace-nowrap"
      >
        <div className={'max-w-[180px] w-auto overflow-hidden'}>{header}</div>
        <span className={'text-text-secondary text-xs'}>{rowCount}</span>
      </div>
      {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && (
        <DropColumnIndicator edge={state.closestEdge} />
      )}
    </div>
  );
}

export default ColumnHeader;