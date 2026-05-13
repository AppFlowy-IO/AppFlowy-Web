import { forwardRef, useCallback, useMemo } from 'react';

import { FieldType, GroupColumn, Row, useFieldType, useReadOnly } from '@/application/database-yjs';
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
  }
>(({ columns, groupResult, fieldId, ...props }, ref) => {
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

    return columns
      .map((data) => {
        if (!groupResult.has(data.id)) {
          return null;
        }

        return {
          ...data,
          rows: groupResult.get(data.id) || [],
        };
      })
      .filter(Boolean) as (GroupColumn & { rows: Row[] })[];
  }, [columns, groupResult]);

  const readOnly = useReadOnly();

  return (
    <div ref={ref} className={'columns flex h-full min-h-0 w-fit min-w-full flex-1 gap-2'}>
      {!readOnly && <HiddenGroupColumn fieldId={fieldId} groupId={props.groupId} getRows={getRows} />}

      {columnsWithRows.map((data) => (
        <Column key={data.id} id={data.id} fieldId={fieldId} rows={data.rows} {...props} />
      ))}
      {isSelectField && !readOnly && <AddGroupColumn groupId={props.groupId} fieldId={fieldId} />}
    </div>
  );
});

export default Columns;
