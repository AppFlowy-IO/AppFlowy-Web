import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  useFieldSelector,
  useReadOnly,
} from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';
import type { Cell as DatabaseCell, FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ReactComponent as CheckboxCheckIcon } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckIcon } from '@/assets/icons/uncheck.svg';
import { Cell } from '@/components/database/components/cell/Cell';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { cn } from '@/lib/utils';

function ListCheckboxCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { field } = useFieldSelector(fieldId);
  const updateCell = useUpdateCellDispatch(rowId, fieldId);
  const checked = getChecked(cell?.data as string | number | boolean | undefined);
  const fieldName =
    field && typeof (field as { get?: unknown }).get === 'function' ? field.get(YjsDatabaseKey.name) : undefined;
  const stateLabel = checked ? t('button.checked') : t('button.unchecked');

  return (
    <button
      aria-checked={checked}
      aria-label={fieldName ? `${fieldName}: ${stateLabel}` : stateLabel}
      aria-readonly={readOnly}
      className='flex h-5 w-5 shrink-0 items-center justify-center text-text-action'
      data-checked={checked}
      data-list-interactive='true'
      data-testid={`list-checkbox-cell-${rowId}-${fieldId}`}
      disabled={readOnly}
      onClick={(event) => {
        event.stopPropagation();
        updateCell(checked ? 'No' : 'Yes');
      }}
      role='checkbox'
      type='button'
    >
      {checked ? (
        <CheckboxCheckIcon aria-hidden='true' className='h-3.5 w-3.5' />
      ) : (
        <CheckboxUncheckIcon aria-hidden='true' className='h-3.5 w-3.5 text-border-primary' />
      )}
    </button>
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
            className='flex min-w-[22px] shrink-0 items-center justify-center rounded-[6px] px-1.5 py-px text-[11px] leading-4'
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

export function formatListTime(data: unknown): string {
  if ((typeof data !== 'string' && typeof data !== 'number') || String(data).trim() === '') return '';

  const minutes = Number(data);

  if (!Number.isSafeInteger(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function ListTimeCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const content = formatListTime(cell?.data);

  if (!content) return null;

  return (
    <span className='truncate text-xs text-text-secondary' data-testid={`list-time-cell-${rowId}-${fieldId}`}>
      {content}
    </span>
  );
}

function ListChecklistCell({ cell, fieldId, rowId }: ListSpecialCellProps) {
  const data = typeof cell?.data === 'string' ? parseChecklistFlexible(cell.data) : null;
  const tasks = data?.options ?? [];
  const selectedTaskIds = new Set(data?.selectedOptionIds ?? []);

  if (tasks.length === 0 || !data || !Number.isFinite(data.percentage)) return null;

  const selectedTaskCount = tasks.reduce((count, task) => count + Number(selectedTaskIds.has(task.id)), 0);
  const completed = selectedTaskCount === tasks.length;
  const segmented = tasks.length <= 5;

  return (
    <span
      className='flex h-5 shrink-0 items-center overflow-hidden'
      data-testid={`list-checklist-cell-${rowId}-${fieldId}`}
    >
      <span aria-hidden='true' className='flex w-20 shrink-0 items-center overflow-hidden'>
        {segmented ? (
          tasks.map((task, index) => (
            <span
              className='mx-px h-1 min-w-0 flex-1 rounded-[2px]'
              data-background-color-token={
                index < selectedTaskCount
                  ? completed
                    ? '--fill-success-thick'
                    : '--fill-theme-thick'
                  : '--fill-info-light'
              }
              key={task.id}
              style={{
                backgroundColor:
                  index < selectedTaskCount
                    ? `var(${completed ? '--fill-success-thick' : '--fill-theme-thick'})`
                    : 'var(--fill-info-light)',
              }}
            />
          ))
        ) : (
          <span className='h-1 w-full overflow-hidden rounded-[2px] bg-fill-info-light'>
            <span
              className='block h-full rounded-[2px]'
              style={{
                backgroundColor: `var(${completed ? '--fill-success-thick' : '--fill-theme-thick'})`,
                width: `${Math.round(data.percentage * 100)}%`,
              }}
            />
          </span>
        )}
      </span>
      <span className='w-[45px] shrink-0 text-right text-xs text-text-secondary'>
        {Math.round(data.percentage * 100)}%
      </span>
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
    case FieldType.Time:
      return <ListTimeCell cell={cell} fieldId={field.fieldId} rowId={rowId} />;
    case FieldType.Checklist:
      return <ListChecklistCell cell={cell} fieldId={field.fieldId} rowId={rowId} />;
    case FieldType.Person:
    case FieldType.Relation:
    case FieldType.Rollup:
      return (
        <div
          className={cn(
            'min-w-0 max-w-full',
            field.fieldType === FieldType.Person &&
              '[&_.select-option-cell>div>div>span]:!text-xs [&_.select-option-cell>div>div]:!gap-1.5 [&_.select-option-cell]:!gap-0',
            field.fieldType === FieldType.Relation &&
              '[&_.relation-cell>div]:!text-text-secondary [&_.relation-cell]:!gap-0',
            field.fieldType === FieldType.Rollup && '[&_.rollup-cell>div>div]:!bg-fill-secondary'
          )}
          data-field-type={field.fieldType}
          data-testid={`list-shared-cell-${rowId}-${field.fieldId}`}
        >
          <Cell cell={cell} fieldId={field.fieldId} readOnly rowId={rowId} style={style} wrap={false} />
        </div>
      );
    default:
      return <Cell cell={cell} fieldId={field.fieldId} readOnly rowId={rowId} style={style} wrap={false} />;
  }
}
