import { YjsDatabaseKey } from '@/application/types';
import { FieldType } from '@/application/database-yjs/database.type';
import { useCellSelector, useFieldSelector } from '@/application/database-yjs/selector';
import { AITextCell } from '@/components/database/components/cell/ai-text/AITextCell';
import { RowCreateModifiedTime } from '@/components/database/components/cell/created-modified';
import React, { FC, useMemo } from 'react';
import { TextCell } from '@/components/database/components/cell/text';
import { NumberCell } from '@/components/database/components/cell/number';
import { CheckboxCell } from '@/components/database/components/cell/checkbox';
import { SelectOptionCell } from '@/components/database/components/cell/select-option';
import { DateTimeCell } from '@/components/database/components/cell/date';
import { ChecklistCell } from '@/components/database/components/cell/checklist';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { RelationCell } from '@/components/database/components/cell/relation';
import { FileMediaCell } from 'src/components/database/components/cell/file-media';

export function Cell (props: CellProps<CellType>) {
  const { rowId, fieldId, style } = props;
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const cell = useCellSelector({ rowId, fieldId });

  const Component = useMemo(() => {
    switch (fieldType) {
      case FieldType.RichText:
      case FieldType.URL:
        return TextCell;
      case FieldType.Number:
        return NumberCell;
      case FieldType.Checkbox:
        return CheckboxCell;
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return SelectOptionCell;
      case FieldType.DateTime:
        return DateTimeCell;
      case FieldType.Checklist:
        return ChecklistCell;
      case FieldType.Relation:
        return RelationCell;
      case FieldType.FileMedia:
        return FileMediaCell;
      case FieldType.AISummaries:
      case FieldType.AITranslations:
        return AITextCell;
      default:
        return TextCell;
    }
  }, [fieldType]) as FC<CellProps<CellType>>;

  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    const attrName = fieldType === FieldType.CreatedTime ? YjsDatabaseKey.created_at : YjsDatabaseKey.last_modified;

    return <RowCreateModifiedTime
      style={style}
      rowId={rowId}
      fieldId={fieldId}
      attrName={attrName}
    />;
  }

  if (cell && cell.fieldType !== fieldType) {
    return null;
  }

  return <Component {...props} />;
}

export default Cell;
