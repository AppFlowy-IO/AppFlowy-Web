import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useReadOnly } from '@/application/database-yjs/context';
import { FieldType, Filter } from '@/application/database-yjs/database.type';
import { useUpdateAdvancedFilter, UpdateFilterParams } from '@/application/database-yjs/dispatch/sort-filter';
import { RollupFilterMode } from '@/application/database-yjs/fields/rollup/rollup.type';
import {
  isEndDateCondition,
  newRollupFilterMetadata,
  rollupHasEndDate,
  rollupListMode,
  rollupPredicateType,
} from '@/application/database-yjs/rollup/filter';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import {
  ConditionSelector,
  inlineSelectTriggerClass,
  ValueInput,
} from '@/components/database/components/filters/advanced/FilterControls';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { useRollupData } from '@/components/database/components/property/rollup/useRollupData';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { FilterEditorContext } from './FilterEditorContext';

const ROLLUP_FILTER_MODES = [RollupFilterMode.Any, RollupFilterMode.None, RollupFilterMode.Every];
// Whether the date predicate reads the end date: Start, then End.
const ROLLUP_DATE_ENDPOINTS = [false, true];

/**
 * Rollup predicate controls, shared by both filter surfaces:
 * - 'row': the advanced panel row — bordered boxes inline with the value input.
 * - 'menu': the compact editor — mirrors desktop's FilterEditorHeader,
 *   `[field name] [mode] [condition(s)] ......... [⋯]`, with the value input below.
 */
export default function RollupFilterControls({
  filter,
  layout = 'row',
}: {
  filter: Filter;
  layout?: 'row' | 'menu';
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { field, clock } = useFieldSelector(filter.fieldId);
  const { targetField } = useRollupData(filter.fieldId);
  const updateFilter = useUpdateAdvancedFilter();
  const metadata = filter.rollupMetadata;
  // Legacy rules may have no metadata, or only a source type. Capture the
  // configuration for editor identity and stale-write checks without saving it.
  const expectedMetadata = useMemo(() => {
    // Yjs fields mutate in place; the selector clock refreshes this snapshot.
    void clock;
    return {
      ...(field ? newRollupFilterMetadata(field, targetField?.type) : {}),
      ...metadata,
    };
  }, [clock, field, metadata, targetField?.type]);
  const type = rollupPredicateType(filter, field);
  const mode = rollupListMode(filter);

  const update = useCallback(
    (params: UpdateFilterParams) => {
      if (readOnly) return;
      updateFilter({ ...params, expectedRollupMetadata: expectedMetadata });
    },
    [expectedMetadata, readOnly, updateFilter]
  );
  const inline = layout === 'menu';
  const context = useMemo(
    () => ({ field: targetField?.field, updateFilter: update, collapseEmptyValue: inline }),
    [inline, targetField?.field, update]
  );
  // An old editor may flush a delayed value on unmount. Its metadata is checked by
  // the writer against the live rule, including source IDs and calculation type.
  const configurationKey = JSON.stringify([
    filter.id,
    filter.fieldId,
    type,
    expectedMetadata.relation_field_id,
    expectedMetadata.target_field_id,
    expectedMetadata.target_field_type,
    expectedMetadata.rollup_show_as,
    expectedMetadata.rollup_calculation_type,
  ]);
  const endDate = isEndDateCondition(filter.condition);

  const selects = (
    <>
      {mode !== undefined && (
        <RollupOptionSelect
          testId='rollup-filter-mode'
          value={mode}
          options={ROLLUP_FILTER_MODES.map((value) => ({
            value,
            text: t(`grid.rollup.filterMode${RollupFilterMode[value]}`, { defaultValue: RollupFilterMode[value] }),
          }))}
          inline={inline}
          // Desktop caps the header mode picker at 80px.
          className={inline ? 'max-w-[80px]' : undefined}
          disabled={readOnly}
          onSelect={(value) =>
            update({
              filterId: filter.id,
              fieldId: filter.fieldId,
              rollupMetadata: { ...metadata, rollup_filter_mode: value },
            })
          }
        />
      )}
      {type === FieldType.DateTime && rollupHasEndDate(metadata) && (
        <RollupOptionSelect
          testId='rollup-filter-date-endpoint'
          value={endDate}
          options={ROLLUP_DATE_ENDPOINTS.map((end) => ({
            value: end,
            text: t(end ? 'grid.dateFilter.end' : 'grid.dateFilter.start', { defaultValue: end ? 'End' : 'Start' }),
          }))}
          inline={inline}
          disabled={readOnly}
          onSelect={(end) => {
            if (end === endDate) return;
            const offset = filter.condition >= 16 ? 6 : 8;

            update({
              filterId: filter.id,
              fieldId: filter.fieldId,
              condition: filter.condition + (end ? offset : -offset),
            });
          }}
        />
      )}
      <ConditionSelector
        filter={filter}
        fieldType={type}
        field={targetField?.field}
        disabled={readOnly}
        variant={inline ? 'inline' : 'box'}
        onConditionChange={(condition) => update({ filterId: filter.id, fieldId: filter.fieldId, condition })}
      />
    </>
  );
  const valueInput = (
    <ValueInput key={configurationKey} filter={filter} fieldType={type} field={targetField?.field} disabled={readOnly} />
  );

  return (
    <FilterEditorContext.Provider value={context}>
      {inline ? (
        <div className='flex flex-col' data-testid='rollup-filter-controls'>
          <FieldMenuTitle filterId={filter.id} fieldId={filter.fieldId} renderConditionSelect={selects} />
          {/* A condition without a value renders nothing here, so the row drops its spacing too. */}
          <div className='flex min-w-0 pt-1 empty:hidden' data-testid='rollup-filter-value'>
            {valueInput}
          </div>
        </div>
      ) : (
        <div className='flex min-w-0 flex-[14] flex-wrap items-center gap-1.5' data-testid='rollup-filter-controls'>
          {selects}
          {valueInput}
        </div>
      )}
    </FilterEditorContext.Provider>
  );
}

function RollupOptionSelect<T extends number | boolean>({
  testId,
  value,
  options,
  inline,
  className,
  disabled,
  onSelect,
}: {
  testId: string;
  value: T;
  options: { value: T; text: string }[];
  /** Header trigger of the compact editor instead of the advanced row's bordered box. */
  inline: boolean;
  className?: string;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  const text = options.find((option) => option.value === value)?.text;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            inline ? inlineSelectTriggerClass : 'h-8 rounded-md border border-border-primary px-2 text-sm',
            className
          )}
          title={inline ? text : undefined}
          data-testid={testId}
        >
          {inline ? (
            <>
              <span className='truncate'>{text}</span>
              <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-secondary' />
            </>
          ) : (
            text
          )}
        </button>
      </DropdownMenuTrigger>
      {/* Desktop parity: RollupFilterModeButton — 160px menu, tick on the selected item. */}
      <DropdownMenuContent align='start' className='w-[160px] min-w-0'>
        {options.map((option) => (
          <DropdownMenuItem key={String(option.value)} onSelect={() => onSelect(option.value)}>
            {option.text}
            {option.value === value && <DropdownMenuItemTick />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
