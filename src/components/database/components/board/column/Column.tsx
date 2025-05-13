import { Row, useReadOnly } from '@/application/database-yjs';
import CardList, { CardType, RenderCard } from '@/components/database/components/board/column/CardList';
import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { useCardsDrag } from '@/components/database/components/board/column/useCardsDrag';
import { StateType, useColumnHeaderDrag } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';
import React, { memo, useMemo } from 'react';
import { ColumnContext } from '../drag-and-drop/column-context';

export interface ColumnProps {
  id: string;
  rows: Row[];
  fieldId: string;
  addCardBefore: (id: string) => void;
  editingCardId: string | null;
  setEditingCardId: (id: string | null) => void;
}

export const Column = memo(
  ({ id, rows, fieldId, addCardBefore, editingCardId, setEditingCardId }: ColumnProps) => {
    const readOnly = useReadOnly();

    const data: RenderCard[] = useMemo(() => {
      const cards = rows.map(row => ({
        type: CardType.CARD,
        id: row.id,
      }));

      if (!readOnly) {
        cards.push({
          type: CardType.NEW_CARD,
          id: 'new_card',
        });
      }

      return cards;
    }, [rows, readOnly]);

    const {
      columnRef,
      headerRef,
      state,
      isDragging,
    } = useColumnHeaderDrag(id);
    const [scrollerContainer, setScrollerContainer] = React.useState<HTMLDivElement | null>(null);
    const {
      contextValue,
      columnInnerRef,
    } = useCardsDrag(id, rows, scrollerContainer);

    return (
      <ColumnContext.Provider value={contextValue}>
        <div
          className={'w-[256px] relative h-full'}
          ref={columnInnerRef}
        >
          <div
            style={{
              opacity: isDragging ? 0.4 : 1,
              pointerEvents: isDragging ? 'none' : undefined,
            }}
            ref={columnRef}
            className={'flex flex-col items-center min-w-[256px] w-[256px] pt-2'}
          >
            <ColumnHeaderPrimitive
              rowCount={rows.length}
              id={id}
              fieldId={fieldId}
              ref={headerRef}
              style={{
                cursor: readOnly ? 'default' : isDragging ? 'grabbing' : 'grab',
              }}
              addCardBefore={addCardBefore}
            />

            <CardList
              columnId={id}
              data={data}
              fieldId={fieldId}
              setScrollElement={setScrollerContainer}
              editingCardId={editingCardId}
              setEditingCardId={setEditingCardId}
            />

          </div>
          {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && (
            <DropColumnIndicator edge={state.closestEdge} />
          )}
        </div>
      </ColumnContext.Provider>
    );
  },
  (prev, next) => JSON.stringify(prev) === JSON.stringify(next),
);
