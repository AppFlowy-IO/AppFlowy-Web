import { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { AITextCell } from '@/components/database/components/cell/ai-text/AITextCell';
import { CheckboxCell } from '@/components/database/components/cell/checkbox';
import { ChecklistCell } from '@/components/database/components/cell/checklist';
import { RowCreateModifiedTime } from '@/components/database/components/cell/created-modified';
import { DateTimeCell } from '@/components/database/components/cell/date';
import { NumberCell } from '@/components/database/components/cell/number';
import { RelationCell } from '@/components/database/components/cell/relation';
import { RollupCell } from '@/components/database/components/cell/rollup';
import { SelectOptionCell } from '@/components/database/components/cell/select-option';
import { TextCell } from '@/components/database/components/cell/text';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { FileMediaCell } from 'src/components/database/components/cell/file-media';

import { PersonCell } from './person';

export function Cell(props: CellProps<CellType>) {
  const { rowId, fieldId, style, wrap, isHovering } = props;
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const disableRelationRollupEdit = isFieldEditingDisabled(fieldType);

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
      case FieldType.Person:
        return PersonCell;
      case FieldType.Rollup:
        return RollupCell;
      default:
        return TextCell;
    }
  }, [fieldType]) as FC<CellProps<CellType>>;

  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    const attrName = fieldType === FieldType.CreatedTime ? YjsDatabaseKey.created_at : YjsDatabaseKey.last_modified;

    return (
      <RowCreateModifiedTime
        style={style}
        rowId={rowId}
        fieldId={fieldId}
        attrName={attrName}
        wrap={wrap}
        isHovering={isHovering}
      />
    );
  }

  const cellProps = disableRelationRollupEdit
    ? {
      ...props,
      readOnly: true,
      editing: false,
      setEditing: undefined,
    }
    : props;

  const content = <Component {...cellProps} />;

  if (disableRelationRollupEdit) {
    return (
      <Tooltip delayDuration={500} disableHoverableContent>
        <TooltipTrigger asChild>
          <div className="w-full min-h-[20px] h-full flex-1 self-stretch">{content}</div>
        </TooltipTrigger>
        <TooltipContent side="top">{t('common.editNotSupported')}</TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export default Cell;
