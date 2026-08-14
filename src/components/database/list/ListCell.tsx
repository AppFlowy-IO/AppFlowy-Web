import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, parseSelectOptionTypeOptions, useFieldSelector } from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';
import type { Cell as DatabaseCell, FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ReactComponent as CheckboxCheckIcon } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckIcon } from '@/assets/icons/uncheck.svg';
import { Cell } from '@/components/database/components/cell/Cell';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';

function ListCheckboxCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const checked = getChecked(cell?.data as string | number | boolean | undefined);

  return (
    <span
      aria-checked={checked}
      aria-readonly='true'
      className='flex h-5 w-5 shrink-0 items-center justify-start text-text-action'
      data-checked={checked}
      data-testid={`list-checkbox-cell-${rowId}-${fieldId}`}
      role='checkbox'
    >
      {checked ? (
        <CheckboxCheckIcon aria-hidden='true' className='h-3.5 w-3.5' />
      ) : (
        <CheckboxUncheckIcon aria-hidden='true' className='h-3.5 w-3.5 text-border-primary' />
      )}
    </span>
  );
}

function ListSelectOptionCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const { clock, field } = useFieldSelector(fieldId);
  const typeOption = useMemo(() => {
    void clock;
    return field ? parseSelectOptionTypeOptions(field) : null;
  }, [clock, field]);
  const selectedOptionIds = useMemo(() => {
    if (typeof cell?.data !== 'string' || !cell.data) return [];

    const optionIds = cell.data.split(',');

    return cell.fieldType === FieldType.MultiSelect ? optionIds : optionIds.slice(0, 1);
  }, [cell]);
  const optionsById = useMemo(
    () => new Map((typeOption?.options ?? []).map((option) => [option.id, option] as const)),
    [typeOption]
  );

  return (
    <div
      className='flex h-5 min-w-0 max-w-full items-center gap-1 overflow-hidden'
      data-testid={`list-select-option-cell-${rowId}-${fieldId}`}
    >
      {selectedOptionIds.map((optionId) => {
        const option = optionsById.get(optionId);

        if (!option) return null;

        const backgroundToken = SelectOptionColorMap[option.color];
        const textToken = SelectOptionFgColorMap[option.color];

        return (
          <span
            className='flex min-w-[22px] max-w-[120px] shrink-0 items-center justify-center truncate rounded-[6px] px-1.5 py-px text-[11px] leading-4'
            data-background-color-token={backgroundToken}
            data-testid='list-select-option-tag'
            data-text-color-token={textToken}
            key={option.id}
            style={{
              backgroundColor: backgroundToken ? `var(${backgroundToken})` : undefined,
              color: `var(${textToken || '--text-primary'})`,
            }}
          >
            <span className='truncate'>{option.name}</span>
          </span>
        );
      })}
    </div>
  );
}

function ListMediaCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const { t } = useTranslation();
  const data = cell?.data;
  const files = Array.isArray(data) ? (data.filter(Boolean) as FileMediaCellDataItem[]) : [];

  if (files.length === 0) return null;

  const attachmentLabel = t('grid.media.attachmentsHint').replace('{}', String(files.length));

  return (
    <span
      className='flex h-5 min-w-0 items-center gap-1.5 overflow-hidden px-1 text-xs text-text-secondary'
      data-testid={`list-media-cell-${rowId}-${fieldId}`}
    >
      <AttachmentIcon aria-hidden='true' className='h-3 w-3 shrink-0 text-icon-secondary' />
      <span className='truncate'>{attachmentLabel}</span>
    </span>
  );
}

interface ListSpecialCellProps {
  cell?: DatabaseCell;
  fieldId: string;
  rowId: string;
}

export function ListCell({
  cell,
  field,
  rowId,
  style,
}: {
  cell?: DatabaseCell;
  field: Column;
  rowId: string;
  style: CSSProperties;
}) {
  switch (field.fieldType) {
    case FieldType.Checkbox:
      return <ListCheckboxCell cell={cell} fieldId={field.fieldId} rowId={rowId} />;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return <ListSelectOptionCell cell={cell} fieldId={field.fieldId} rowId={rowId} />;
    case FieldType.Media:
      return <ListMediaCell cell={cell} fieldId={field.fieldId} rowId={rowId} />;
    default:
      return <Cell cell={cell} fieldId={field.fieldId} readOnly rowId={rowId} style={style} wrap={false} />;
  }
}
