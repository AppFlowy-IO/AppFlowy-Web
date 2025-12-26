import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useCellSelector, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { YjsDatabaseKey } from '@/application/types';
import ChecklistCell from '@/components/database/components/database-row/checklist/ChecklistCell';
import FileMediaCell from '@/components/database/components/database-row/file-media/FileMediaCell';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { cn } from '@/lib/utils';

import Cell from 'src/components/database/components/cell/Cell';

function RowPropertyCell({
  fieldId,
  rowId,
  onCellUpdated,
}: {
  fieldId: string;
  rowId: string;
  onCellUpdated?: (cell: CellType) => void;
}) {
  const cell = useCellSelector({
    fieldId,
    rowId,
  });
  const { t } = useTranslation();

  const readOnly = useReadOnly();
  const { field, clock } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isReadOnlyCell = readOnly || isFieldEditingDisabled(fieldType);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fieldName = useMemo(() => field?.get(YjsDatabaseKey.name) || '', [field, clock]);
  const [hovering, setHovering] = React.useState<boolean>(false);
  const [editing, setEditing] = React.useState<boolean>(false);

  const isChecklist = fieldType === FieldType.Checklist;
  const isFileMedia = fieldType === FieldType.FileMedia;
  const CellComponent = useMemo(() => {
    if (isChecklist) {
      return ChecklistCell;
    }

    if (isFileMedia) {
      return FileMediaCell;
    }

    return Cell;
  }, [isChecklist, isFileMedia]) as React.FC<CellProps<CellType>>;

  const placeholder = useMemo(() => {
    if (fieldType === FieldType.Rollup) return '';
    return `${t('button.add')} ${fieldName}`;
  }, [fieldName, t, fieldType]);

  return (
    <div
      onClick={() => {
        if (isReadOnlyCell) return;
        setEditing(true);
      }}
      onMouseEnter={() => {
        if (isReadOnlyCell) return;
        setHovering(true);
      }}
      onMouseLeave={() => {
        if (isReadOnlyCell) return;
        setHovering(false);
      }}
      className={cn(
        'relative flex h-fit min-h-[36px] flex-1 flex-wrap items-center overflow-x-hidden rounded-300 px-2 py-2 pr-1 text-sm',
        !isReadOnlyCell && !isChecklist && 'cursor-pointer hover:bg-fill-content-hover'
      )}
    >
      <CellComponent
        cell={cell}
        placeholder={placeholder}
        fieldId={fieldId}
        rowId={rowId}
        readOnly={isReadOnlyCell}
        isHovering={hovering}
        editing={editing}
        setEditing={setEditing}
        wrap={true}
        onCellUpdated={onCellUpdated}
        {...([FieldType.LastEditedTime, FieldType.CreatedTime].includes(fieldType)
          ? {
              attrName:
                fieldType === FieldType.LastEditedTime ? YjsDatabaseKey.last_modified : YjsDatabaseKey.created_at,
            }
          : undefined)}
      />
    </div>
  );
}

export default RowPropertyCell;
