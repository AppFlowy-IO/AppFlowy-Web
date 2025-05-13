import { useReadOnly } from '@/application/database-yjs';
import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { useColumnHeaderDrag, StateType } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';
import React from 'react';

function ColumnHeader ({
  id,
  fieldId,
  rowCount,
  addCardBefore,
}: {
  id: string;
  fieldId: string;
  rowCount: number;
  addCardBefore: (id: string) => void;
}) {
  const {
    columnRef,
    headerRef,
    state,
    isDragging,
  } = useColumnHeaderDrag(id);
  const readOnly = useReadOnly();

  return (
    <div
      ref={columnRef}
      key={id}
      style={{
        opacity: isDragging ? 0.4 : 1,
        pointerEvents: isDragging ? 'none' : undefined,
      }}
      className="flex relative items-center flex-col rounded-[8px] pb-0 min-w-[256px] w-[256px] pt-2 h-full"
    >
      <ColumnHeaderPrimitive
        addCardBefore={addCardBefore}
        ref={headerRef}
        id={id}
        fieldId={fieldId}
        rowCount={rowCount}
        style={{
          cursor: readOnly ? 'default' : isDragging ? 'grabbing' : 'grab',
        }}
      />
      {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && (
        <DropColumnIndicator edge={state.closestEdge} />
      )}
    </div>
  );
}

export default ColumnHeader;