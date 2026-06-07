import { Row, useReadOnly } from '@/application/database-yjs';
import { useBoardColumnColor } from '@/components/database/components/board/column/boardColumnColor';
import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { useColumnHeaderDrag, StateType } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';

function ColumnHeader({
  id,
  fieldId,
  rowCount,
  addCardBefore,
  getCards,
  groupId,
  groupColor,
  showColorColumns,
}: {
  id: string;
  fieldId: string;
  rowCount: number;
  addCardBefore: (id: string) => void;
  getCards: (id: string) => Row[];
  groupId: string;
  groupColor?: string;
  showColorColumns: boolean;
}) {
  const { columnRef, headerRef, state, isDragging } = useColumnHeaderDrag(id);
  const readOnly = useReadOnly();
  const { style: colorStyle, option: colorOption } = useBoardColumnColor({
    id,
    fieldId,
    groupColor,
    showColorColumns,
  });

  return (
    <div
      ref={columnRef}
      key={id}
      style={{
        opacity: isDragging ? 0.4 : 1,
        pointerEvents: isDragging ? 'none' : undefined,
        backgroundColor: colorStyle?.backgroundColor,
      }}
      className='relative flex h-fit w-[256px] min-w-[256px] flex-col items-center rounded-[8px] pb-0 pt-2'
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
        getCards={getCards}
        groupId={groupId}
        colorStyle={colorStyle}
        colorOption={colorOption}
        showColorColumns={showColorColumns}
      />
      {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && <DropColumnIndicator edge={state.closestEdge} />}
    </div>
  );
}

export default ColumnHeader;
