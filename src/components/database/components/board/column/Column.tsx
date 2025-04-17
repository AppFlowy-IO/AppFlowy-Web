import { Row } from '@/application/database-yjs';
import CardList from '@/components/database/components/board/column/CardList';
import { StateType, useColumnDrag } from '@/components/database/components/board/column/useColumnDrag';
import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import { DropColumnIndicator } from '@/components/database/components/board/drag-and-drop/DropColumnIndicator';
import { GridDragState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { ColumnContext } from '../drag-and-drop/column-context';

export interface ColumnProps {
  id: string;
  rows: Row[];
  fieldId: string;
  onRendered?: (height: number) => void;
}

export const Column = memo(
  ({ id, rows, fieldId }: ColumnProps) => {
    const { header } = useRenderColumn(id, fieldId);
    const rowCount = rows?.length || 0;
    const [scrollerContainer, setScrollerContainer] = React.useState<HTMLDivElement | null>(null);
    const {
      contextValue,
      columnRef,
      columnInnerRef,
      state,
      headerRef,
      isDragging,
    } = useColumnDrag(id, rows, scrollerContainer);

    return (
      <ColumnContext.Provider value={contextValue}>
        <div
          ref={columnRef}
          key={id}
          style={{
            opacity: isDragging ? 0.4 : 1,
            pointerEvents: isDragging ? 'none' : undefined,
          }}
          className="column relative flex flex-col"
        >
          <div
            className={'flex items-center flex-col gap-2 rounded-[8px] pb-0 w-[256px] pt-2 h-full'}
            ref={columnInnerRef}
          >
            <div
              ref={headerRef}
              style={{
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
              className="column-header select-none flex overflow-hidden justify-start w-[240px] items-center gap-2 h-[26px] py-0.5 text-sm leading-[16px] font-medium whitespace-nowrap"
            >
              <div className={'max-w-[180px] w-auto overflow-hidden'}>{header}</div>
              <span className={'text-text-secondary text-xs'}>{rowCount}</span>
            </div>

            <div className={'flex-1 w-[256px]'}>
              {rows && <CardList
                setScrollableContainer={setScrollerContainer}
                data={rows}
                fieldId={fieldId}
              />}
            </div>
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
