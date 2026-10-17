import { forwardRef, useCallback, useMemo } from 'react';

import { FieldType, GroupColumn, Row, useFieldType, useReadOnly } from '@/application/database-yjs';
import { getRenderedBoardColumns } from '@/application/database-yjs/board-grouping';
import { Column } from '@/components/database/components/board/column';
import HiddenGroupColumn from '@/components/database/components/board/column/HiddenGroupColumn';
import AddGroupColumn from '@/components/database/components/board/group/AddGroupColumn';

const Columns = forwardRef<
  HTMLDivElement,
  {
    fieldId: string;
    groupResult: Map<string, Row[]>;
    columns: GroupColumn[];
    addCardBefore: (id: string) => void;
    groupId: string;
    groupRowsReady: boolean;
  }
>(({ columns, groupResult, fieldId, groupRowsReady, ...props }, ref) => {
  const fieldType = useFieldType(fieldId);
  const isSelectField = useMemo(() => {
    return [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
  }, [fieldType]);

  const getRows = useCallback(
    (id: string) => {
      return groupResult.get(id) || [];
    },
    [groupResult]
  );

  const columnsWithRows = useMemo(() => {
    if (!groupResult) return [];

    return getRenderedBoardColumns(columns, groupResult).map((data) => ({
      ...data,
      rows: groupResult.get(data.id) || [],
    }));
  }, [columns, groupResult]);
  const shownColumnIds = useMemo(() => new Set(columnsWithRows.map((column) => column.id)), [columnsWithRows]);

  const readOnly = useReadOnly();

  return (
    <div ref={ref} className={'columns flex h-full min-h-0 w-fit min-w-full flex-1 gap-2'}>
      {!readOnly && (
        <HiddenGroupColumn
          fieldId={fieldId}
          groupId={props.groupId}
          getRows={getRows}
          groupRowsReady={groupRowsReady}
          shownColumnIds={shownColumnIds}
        />
      )}

      {columnsWithRows.map((data) => (
        <Column key={data.id} id={data.id} fieldId={fieldId} rows={data.rows} {...props} />
      ))}
      {isSelectField && !readOnly && <AddGroupColumn groupId={props.groupId} fieldId={fieldId} />}
    </div>
  );
});

export default Columns;
