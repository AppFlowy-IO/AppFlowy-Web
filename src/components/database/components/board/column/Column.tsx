import { Row } from '@/application/database-yjs';
import CardList from '@/components/database/components/board/column/CardList';
import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import React, { memo, useRef } from 'react';

export interface ColumnProps {
  id: string;
  rows?: Row[];
  fieldId: string;
  onRendered?: (height: number) => void;
}

export const Column = memo(
  ({ id, rows, fieldId }: ColumnProps) => {
    const { header } = useRenderColumn(id, fieldId);
    const containerRef = useRef<HTMLDivElement>(null);
    const rowCount = rows?.length || 0;

    return (
      <div
        ref={containerRef}
        key={id}
        className="column rounded-[8px] pb-0 flex w-[256px] pt-2 items-center flex-col gap-2"
      >
        <div
          className="column-header flex overflow-hidden justify-start w-[240px] items-center gap-2 h-[26px] py-0.5 text-sm leading-[16px] font-medium whitespace-nowrap"
        >
          <div className={'max-w-[180px] w-auto overflow-hidden'}>{header}</div>
          <span className={'text-text-secondary text-xs'}>{rowCount}</span>
        </div>

        <div className={'flex-1 w-[256px]'}>
          {rows && <CardList
            data={rows}
            fieldId={fieldId}
          />}
        </div>
      </div>
    );
  },
  (prev, next) => JSON.stringify(prev) === JSON.stringify(next),
);
