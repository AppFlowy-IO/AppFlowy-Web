import { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useCellSelector, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { Cell as CellType, CellProps } from '@/application/database-yjs/cell.type';
import { YjsDatabaseKey } from '@/application/types';
import { CheckboxCell } from '@/components/database/components/cell/checkbox';
import { RowCreateModifiedTime } from '@/components/database/components/cell/created-modified';
import { DateTimeCell } from '@/components/database/components/cell/date';
import { FileMediaCell } from '@/components/database/components/cell/file-media';
import { NumberCell } from '@/components/database/components/cell/number';
import { RelationCell } from '@/components/database/components/cell/relation';
import { RollupCell } from '@/components/database/components/cell/rollup';
import { SelectOptionCell } from '@/components/database/components/cell/select-option';
import { TextCell } from '@/components/database/components/cell/text';
import PropertyWrapper from '@/components/database/components/property/PropertyWrapper';
import { TextProperty } from '@/components/database/components/property/text';


import { ChecklistProperty } from 'src/components/database/components/property/cheklist';

import { PersonCell } from '../cell/person';

export function Property ({ fieldId, rowId }: { fieldId: string; rowId: string }) {
  const cell = useCellSelector({
    fieldId,
    rowId,
  });

  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const readOnly = useReadOnly();
  const isRollup = fieldType === FieldType.Rollup;
  const isReadOnlyCell = readOnly || isRollup;

  const { t } = useTranslation();
  const Component = useMemo(() => {
    switch (fieldType) {
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
        return ChecklistProperty;
      case FieldType.Relation:
        return RelationCell;
      case FieldType.URL:
      case FieldType.RichText:
      case FieldType.AISummaries:
      case FieldType.AITranslations:
        return TextCell;
      case FieldType.FileMedia:
        return FileMediaCell;
      case FieldType.Person:
        return PersonCell;
      case FieldType.Rollup:
        return RollupCell;
      default:
        return TextProperty;
    }
  }, [fieldType]) as FC<CellProps<CellType>>;

  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    const attrName = fieldType === FieldType.CreatedTime ? YjsDatabaseKey.created_at : YjsDatabaseKey.last_modified;

    return (
      <PropertyWrapper fieldId={fieldId}>
        <RowCreateModifiedTime
          wrap
          rowId={rowId}
          fieldId={fieldId}
          attrName={attrName}
        />
      </PropertyWrapper>
    );
  }

  return (
    <PropertyWrapper fieldId={fieldId}>
      <Component
        wrap
        cell={cell}
        placeholder={isRollup ? '' : t('grid.row.textPlaceholder')}
        fieldId={fieldId}
        rowId={rowId}
        readOnly={isReadOnlyCell}
      />
    </PropertyWrapper>
  );
}

export default Property;
