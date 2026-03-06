
import { memo, useMemo } from 'react';

import { Row, useReadOnly } from '@/application/database-yjs';
import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { useColumnHeaderDrag, StateType } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';

const ColumnHeader = memo(function ColumnHeader ({
  id,
  fieldId,
  rowCount,
  addCardBefore,
  getCards,
  groupId,
}: {
  id: string;
  fieldId: string;
  rowCount: number;
  addCardBefore: (id: string) => void;
  getCards: (id: string) => Row[];
  groupId: string;
}) {
  const {
    columnRef,
    headerRef,
    state,
    isDragging,
  } = useColumnHeaderDrag(id);
  const readOnly = useReadOnly();

  // Memoize style objects to prevent new object references on every render
  const columnStyle = useMemo(() => ({
    opacity: isDragging ? 0.4 : 1,
    pointerEvents: isDragging ? 'none' as const : undefined,
  }), [isDragging]);

  const headerStyle = useMemo(() => ({
    cursor: readOnly ? 'default' : isDragging ? 'grabbing' : 'grab',
  }), [readOnly, isDragging]);

  return (
    <div
      ref={columnRef}
      key={id}
      style={columnStyle}
      className="flex relative items-center flex-col rounded-[8px] pb-0 min-w-[256px] w-[256px] pt-2 h-full"
    >
      <ColumnHeaderPrimitive
        addCardBefore={addCardBefore}
        ref={headerRef}
        id={id}
        fieldId={fieldId}
        rowCount={rowCount}
        style={headerStyle}
        getCards={getCards}
        groupId={groupId}
      />
      {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && (
        <DropColumnIndicator edge={state.closestEdge} />
      )}
    </div>
  );
});

export default ColumnHeader;