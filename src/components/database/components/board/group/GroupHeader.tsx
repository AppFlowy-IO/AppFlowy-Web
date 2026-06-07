import { forwardRef, useCallback, useMemo } from 'react';

import {
  FieldType,
  GroupColumn,
  Row,
  useBoardLayoutSettings,
  useFieldType,
  useReadOnly,
} from '@/application/database-yjs';
import ColumnHeader from '@/components/database/components/board/column/ColumnHeader';
import HiddenGroupColumnHeader from '@/components/database/components/board/column/HiddenGroupColumnHeader';
import AddGroupColumn from '@/components/database/components/board/group/AddGroupColumn';

const GroupHeader = forwardRef<
  HTMLDivElement,
  {
    columns: GroupColumn[];
    fieldId: string;

    groupResult: Map<string, Row[]>;
    addCardBefore: (id: string) => void;
    groupId: string;
  }
>(({ columns, fieldId, groupResult, addCardBefore, groupId }, ref) => {
  const readOnly = useReadOnly();
  const { showColorColumns } = useBoardLayoutSettings();

  const getCards = useCallback((id: string) => groupResult.get(id) || [], [groupResult]);
  const fieldType = useFieldType(fieldId);
  const isSelectField = useMemo(() => {
    return [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
  }, [fieldType]);

  return (
    <div ref={ref} className='columns-header flex w-fit min-w-full gap-2'>
      {!readOnly && <HiddenGroupColumnHeader />}

      {columns.map((data) => (
        <ColumnHeader
          key={data.id}
          id={data.id}
          fieldId={fieldId}
          getCards={getCards}
          rowCount={groupResult.get(data.id)?.length || 0}
          addCardBefore={addCardBefore}
          groupId={groupId}
          showColorColumns={showColorColumns}
        />
      ))}
      {isSelectField && !readOnly && <AddGroupColumn groupId={groupId} fieldId={fieldId} />}
    </div>
  );
});

export default GroupHeader;
