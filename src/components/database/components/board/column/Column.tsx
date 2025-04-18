import { Row } from '@/application/database-yjs';
import CardList from '@/components/database/components/board/column/CardList';
import { useCardsDrag } from '@/components/database/components/board/column/useCardsDrag';
import React, { memo } from 'react';
import { ColumnContext } from '../drag-and-drop/column-context';

export interface ColumnProps {
  id: string;
  rows: Row[];
  fieldId: string;
}

export const Column = memo(
  ({ id, rows, fieldId }: ColumnProps) => {
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
          {rows && <CardList
            data={rows}
            fieldId={fieldId}
            setScrollElement={setScrollerContainer}
          />}
        </div>
      </ColumnContext.Provider>
    );
  },
  (prev, next) => JSON.stringify(prev) === JSON.stringify(next),
);
