import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, Filter, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import {
  useRemoveAdvancedFilterAndRebuild,
  useUpdateAdvancedFilter,
  useUpdateAdvancedFilterAndRebuild,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import RollupFilterControls from '../filter-menu/RollupFilterControls';

import { ConditionSelector, ValueInput } from './FilterControls';

interface FilterPanelRowProps {
  filter: Filter;
  isFirst: boolean;
  onOperatorChange?: (filterId: string, newOperator: FilterType.And | FilterType.Or) => void;
}

// Desktop parity: SingleSelectBox — 32px tall, 6px radius, primary border that
// turns theme-thick while its popover is open.
const selectBoxClass =
  'flex h-8 items-center justify-between gap-1 overflow-hidden rounded-md border border-border-primary bg-transparent px-2 text-sm text-text-primary data-[state=open]:border-border-theme-thick disabled:opacity-50';

export function FilterPanelRow({ filter, isFirst, onOperatorChange }: FilterPanelRowProps) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const removeFilter = useRemoveAdvancedFilterAndRebuild();
  const updateFilterValue = useUpdateAdvancedFilter();
  const updateFilterAndRebuild = useUpdateAdvancedFilterAndRebuild();
  const { field } = useFieldSelector(filter.fieldId);

  const [fieldSelectorOpen, setFieldSelectorOpen] = useState(false);

  // Not memoized: `field` is a Yjs map with a stable identity that mutates in
  // place, so a [field]-keyed memo would go stale after in-place field edits.
  const fieldType: FieldType | null = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : null;

  const handleRemove = useCallback(() => {
    removeFilter(filter.id);
  }, [filter.id, removeFilter]);

  const handleFieldChange = useCallback(
    (newFieldId: string) => {
      updateFilterAndRebuild({
        filterId: filter.id,
        fieldId: newFieldId,
      });
      setFieldSelectorOpen(false);
    },
    [filter.id, updateFilterAndRebuild]
  );

  const handleConditionChange = useCallback(
    (condition: number) => {
      // Condition changes are scalar CRDT updates. Rebuilding the tree here
      // would let this edit overwrite unrelated filters from another client.
      updateFilterValue({
        filterId: filter.id,
        fieldId: filter.fieldId,
        condition,
      });
    },
    [filter.id, filter.fieldId, updateFilterValue]
  );

  if (!field) return null;

  const fieldName = field.get(YjsDatabaseKey.name) ?? '';

  return (
    <div className='flex items-center gap-1.5 px-2' data-testid='advanced-filter-row'>
      {/* Where / And / Or selector - fixed width (desktop: 68px) */}
      <div className='w-[68px] shrink-0'>
        {isFirst ? (
          <div className='text-center text-sm text-text-tertiary'>{t('grid.filter.where')}</div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button className={cn(selectBoxClass, 'w-full')}>
                <span className='truncate'>
                  {filter.operator === FilterType.Or ? t('grid.filter.or') : t('grid.filter.and')}
                </span>
                <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='min-w-[100px]'>
              <DropdownMenuItem onSelect={() => onOperatorChange?.(filter.id, FilterType.And)}>
                {t('grid.filter.and')}
                {filter.operator === FilterType.And && <DropdownMenuItemTick />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOperatorChange?.(filter.id, FilterType.Or)}>
                {t('grid.filter.or')}
                {filter.operator === FilterType.Or && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Field selector - flex-[5] */}
      <div className='min-w-0 flex-[5]'>
        <PropertiesMenu
          asChild
          searchPlaceholder={t('grid.settings.filterBy')}
          excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
          onSelect={handleFieldChange}
          open={fieldSelectorOpen}
          onOpenChange={setFieldSelectorOpen}
        >
          <button className={cn(selectBoxClass, 'w-full')} disabled={readOnly} title={fieldName}>
            <span className='truncate'>{fieldName}</span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </PropertiesMenu>
      </div>

      {fieldType === FieldType.Rollup ? (
        <RollupFilterControls filter={filter} />
      ) : (
        <>
          <ConditionSelector
            filter={filter}
            fieldType={fieldType}
            field={field}
            onConditionChange={handleConditionChange}
            disabled={readOnly}
          />
          <ValueInput filter={filter} fieldType={fieldType} field={field} disabled={readOnly} />
        </>
      )}

      {/* Delete button */}
      {!readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className='group flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-fill-content-hover'
              onClick={handleRemove}
              data-testid='delete-advanced-filter-button'
            >
              <DeleteIcon className='h-5 w-5 text-icon-tertiary group-hover:text-icon-error-thick' />
            </button>
          </TooltipTrigger>
          <TooltipContent side='bottom'>{t('grid.settings.deleteFilter')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default FilterPanelRow;
