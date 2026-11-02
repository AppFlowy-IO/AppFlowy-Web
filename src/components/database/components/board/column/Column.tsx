import { memo, useCallback, useMemo } from 'react';

import { Row, useReadOnly } from '@/application/database-yjs';
import CardList, { CardType, RenderCard } from '@/components/database/components/board/column/CardList';
import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { StateType as CardDropState, useCardsDrag } from '@/components/database/components/board/column/useCardsDrag';
import { StateType, useColumnHeaderDrag } from '@/components/database/components/board/column/useColumnHeaderDrag';
import { useBoardColumnTint } from '@/components/database/components/board/column/useRenderColumn';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';
import { useBoardColumnDisplay } from '@/components/database/components/board/group/board-display-context';
import { cn } from '@/lib/utils';

import { ColumnDragContext } from '../drag-and-drop/column-context';

export interface ColumnProps {
  id: string;
  rows: Row[];
  fieldId: string;
  addCardBefore: (id: string) => void;
  groupId: string;
}

function areRowsEqual(prevRows: Row[], nextRows: Row[]) {
  if (prevRows === nextRows) return true;
  if (prevRows.length !== nextRows.length) return false;

  for (let index = 0; index < prevRows.length; index += 1) {
    const prevRow = prevRows[index];
    const nextRow = nextRows[index];

    if (prevRow.id !== nextRow.id || prevRow.height !== nextRow.height) {
      return false;
    }
  }

  return true;
}

function areColumnPropsEqual(prev: ColumnProps, next: ColumnProps) {
  return (
    prev.id === next.id &&
    prev.fieldId === next.fieldId &&
    prev.groupId === next.groupId &&
    prev.addCardBefore === next.addCardBefore &&
    areRowsEqual(prev.rows, next.rows)
  );
}

export const Column = memo(
  ({ id, rows, fieldId, addCardBefore, groupId }: ColumnProps) => {
    const readOnly = useReadOnly();

    const data: RenderCard[] = useMemo(() => {
      const cards = rows.map((row) => ({
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

    const { columnRef, headerRef, state, isDragging } = useColumnHeaderDrag(id);
    const { contextValue, columnInnerRef, state: cardDropState } = useCardsDrag(id, rows);
    const { sorted } = useBoardColumnDisplay();
    const tint = useBoardColumnTint(id, fieldId);
    // A sorted board drops a card on the column, never between cards (WP09 §1.4).
    const dropHighlighted = sorted && cardDropState.type === CardDropState.IS_CARD_OVER;

    const getCards = useCallback(
      (_columnId: string): Row[] => {
        return rows;
      },
      [rows]
    );

    return (
      <ColumnDragContext.Provider value={contextValue}>
        <div
          data-column-id={id}
          data-drop-highlighted={dropHighlighted ? 'true' : undefined}
          data-testid={'board-column'}
          data-tint={tint?.index}
          className={cn(
            'relative flex h-full min-h-0 w-[256px]',
            (tint || dropHighlighted) && 'rounded-200',
            dropHighlighted && 'bg-fill-content-hover'
          )}
          ref={columnInnerRef}
          style={tint && !dropHighlighted ? { backgroundColor: tint.background } : undefined}
        >
          <div
            style={{
              opacity: isDragging ? 0.4 : 1,
              pointerEvents: isDragging ? 'none' : undefined,
            }}
            ref={columnRef}
            className={'flex h-full min-h-0 w-[256px] min-w-[256px] flex-col items-center pt-2'}
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
              getCards={getCards}
              groupId={groupId}
            />

            <CardList
              columnId={id}
              data={data}
              fieldId={fieldId}
            />
          </div>
          {state.type === StateType.IS_COLUMN_OVER && state.closestEdge && (
            <DropColumnIndicator edge={state.closestEdge} />
          )}
        </div>
      </ColumnDragContext.Provider>
    );
  },
  areColumnPropsEqual
);
