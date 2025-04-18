import { GroupColumn, Row } from '@/application/database-yjs';
import ColumnHeader from '@/components/database/components/board/column/ColumnHeader';
import React, { forwardRef } from 'react';

const GroupHeader = forwardRef<HTMLDivElement, {
  columns: GroupColumn[];
  fieldId: string;
  groupResult: Map<string, Row[]>;
}>(({
  columns,
  fieldId,
  groupResult,
}, ref) => {

  return (
    <div
      ref={ref}
      className="columns-header flex w-fit min-w-full gap-2"
    >
      {columns.map((data) => (
        <ColumnHeader
          key={data.id}
          id={data.id}
          fieldId={fieldId}
          rowCount={groupResult.get(data.id)?.length || 0}
        />
      ))}
    </div>
  );
});

export default GroupHeader;