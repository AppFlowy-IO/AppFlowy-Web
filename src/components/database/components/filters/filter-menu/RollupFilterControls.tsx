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
import { ConditionSelector, ValueInput } from '@/components/database/components/filters/advanced/FilterControls';
import { useRollupData } from '@/components/database/components/property/rollup/useRollupData';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { FilterEditorContext } from './FilterEditorContext';

export default function RollupFilterControls({ filter }: { filter: Filter }) {
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
  const context = useMemo(() => ({ field: targetField?.field, updateFilter: update }), [targetField?.field, update]);
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

  return (
    <FilterEditorContext.Provider value={context}>
      <div className='flex min-w-0 flex-[14] flex-wrap items-center gap-1.5' data-testid='rollup-filter-controls'>
        {mode !== undefined && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button
                className='h-8 rounded-md border border-border-primary px-2 text-sm'
                data-testid='rollup-filter-mode'
              >
                {t(`grid.rollup.filterMode${RollupFilterMode[mode]}`, { defaultValue: RollupFilterMode[mode] })}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {[RollupFilterMode.Any, RollupFilterMode.None, RollupFilterMode.Every].map((value) => (
                <DropdownMenuItem
                  key={value}
                  onSelect={() =>
                    update({
                      filterId: filter.id,
                      fieldId: filter.fieldId,
                      rollupMetadata: { ...metadata, rollup_filter_mode: value },
                    })
                  }
                >
                  {t(`grid.rollup.filterMode${RollupFilterMode[value]}`, { defaultValue: RollupFilterMode[value] })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {type === FieldType.DateTime && rollupHasEndDate(metadata) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button
                className='h-8 rounded-md border border-border-primary px-2 text-sm'
                data-testid='rollup-filter-date-endpoint'
              >
                {t(endDate ? 'grid.dateFilter.end' : 'grid.dateFilter.start', {
                  defaultValue: endDate ? 'End' : 'Start',
                })}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {[false, true].map((end) => (
                <DropdownMenuItem
                  key={String(end)}
                  onSelect={() => {
                    if (end === endDate) return;
                    const offset = filter.condition >= 16 ? 6 : 8;

                    update({
                      filterId: filter.id,
                      fieldId: filter.fieldId,
                      condition: filter.condition + (end ? offset : -offset),
                    });
                  }}
                >
                  {t(end ? 'grid.dateFilter.end' : 'grid.dateFilter.start', { defaultValue: end ? 'End' : 'Start' })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ConditionSelector
          filter={filter}
          fieldType={type}
          field={targetField?.field}
          disabled={readOnly}
          onConditionChange={(condition) => update({ filterId: filter.id, fieldId: filter.fieldId, condition })}
        />
        <ValueInput
          key={configurationKey}
          filter={filter}
          fieldType={type}
          field={targetField?.field}
          disabled={readOnly}
        />
      </div>
    </FilterEditorContext.Provider>
  );
}
