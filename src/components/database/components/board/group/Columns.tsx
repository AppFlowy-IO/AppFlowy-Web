import { GroupColumn, Row } from '@/application/database-yjs';
import { Column } from '@/components/database/components/board/column';
import React, { forwardRef } from 'react';

const Columns = forwardRef<HTMLDivElement, {
  fieldId: string;
  groupResult: Map<string, Row[]>;
  columns: GroupColumn[];
}>(({
  columns,
  groupResult,
  fieldId,
}, ref) => {

  return (
    <div
      ref={ref}
      className={'columns flex flex-1 w-fit min-w-full gap-2'}
    >
      {columns.map((data) => (
        <Column
          key={data.id}
          id={data.id}
          fieldId={fieldId}
          rows={groupResult.get(data.id) || []}
        />
      ))}
    </div>
  );
});

export default Columns;