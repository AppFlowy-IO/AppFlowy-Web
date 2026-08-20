import { ChangeEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CheckboxFilter,
  CheckboxFilterCondition,
  ChecklistFilterCondition,
  DateFilter,
  DateFilterCondition,
  FieldType,
  Filter,
  isRelativeDateCondition,
  NumberFilter,
  NumberFilterCondition,
  parseSelectOptionTypeOptions,
  PersonFilter,
  PersonFilterCondition,
  RelationFilterCondition,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilter,
  TextFilterCondition,
  useFieldSelector,
  useReadOnly,
} from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import {
  useRemoveAdvancedFilterAndRebuild,
  useUpdateAdvancedFilter,
  useUpdateAdvancedFilterAndRebuild,
} from '@/application/database-yjs/dispatch';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import RelationCellMenuContent from '@/components/database/components/cell/relation/RelationCellMenuContent';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';
import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import AdvancedDateFilterValueInput from './AdvancedDateFilterValueInput';

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

      {/* Condition selector - flex-[7] */}
      <ConditionSelector
        filter={filter}
        fieldType={fieldType}
        field={field}
        onConditionChange={handleConditionChange}
        disabled={readOnly}
      />

      {/* Value input - flex-[7] */}
      <ValueInput filter={filter} fieldType={fieldType} field={field} disabled={readOnly} />

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

// Condition Selector Component - Shows only conditions dropdown
interface ConditionSelectorProps {
  filter: Filter;
  fieldType: FieldType | null;
  field?: YDatabaseField;
  onConditionChange: (condition: number) => void;
  disabled?: boolean;
}

function ConditionSelector({ filter, fieldType, field, onConditionChange, disabled }: ConditionSelectorProps) {
  const { t } = useTranslation();
  const conditions = useConditionsForFieldType(fieldType, t, field);

  const selectedCondition = useMemo(() => {
    // For Checkbox, always show "Is" (the actual condition is in the value dropdown)
    if (fieldType === FieldType.Checkbox) {
      return conditions[0]; // Returns { value: -1, text: 'Is' }
    }

    return conditions.find((c) => c.value === filter.condition);
  }, [filter.condition, conditions, fieldType]);

  // For Checkbox, the condition dropdown is non-interactive (just shows "Is")
  if (fieldType === FieldType.Checkbox) {
    return (
      <div className={cn(selectBoxClass, 'min-w-0 flex-[7] border-transparent')}>
        <span className='truncate'>{selectedCondition?.text}</span>
      </div>
    );
  }

  return (
    <div className='min-w-0 flex-[7]'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            className={cn(selectBoxClass, 'w-full')}
            title={selectedCondition?.text}
            data-testid='filter-condition-selector'
          >
            <span className='truncate'>{selectedCondition?.text || t('grid.filter.conditon')}</span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='max-h-[300px] w-[240px] overflow-y-auto'>
          {conditions.map((condition) => (
            <DropdownMenuItem
              key={condition.value}
              data-testid={`filter-condition-${condition.value}`}
              onSelect={() => onConditionChange(condition.value)}
            >
              {condition.text}
              {condition.value === filter.condition && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Get conditions based on field type
function useConditionsForFieldType(
  fieldType: FieldType | null,
  t: (key: string) => string,
  field?: YDatabaseField
): { value: number; text: string }[] {
  // Numeric rollups must use Number conditions; non-numeric rollups stay as text.
  // Mirrors RollupFilterMenu's branching so every Rollup surface (FilterMenu,
  // advanced editor, badge, runtime eval) agrees on which condition vocabulary applies.
  const isNumericRollup = fieldType === FieldType.Rollup && isNumericRollupField(field);

  return useMemo(() => {
    if (fieldType === null) return [];

    const textTypes = [FieldType.RichText, FieldType.URL];
    const dateTypes = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];
    const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];

    if (fieldType === FieldType.Rollup && !isNumericRollup) {
      // Non-numeric rollup → text conditions
      return [
        { value: TextFilterCondition.TextContains, text: t('grid.textFilter.contains') },
        { value: TextFilterCondition.TextDoesNotContain, text: t('grid.textFilter.doesNotContain') },
        { value: TextFilterCondition.TextStartsWith, text: t('grid.textFilter.startWith') },
        { value: TextFilterCondition.TextEndsWith, text: t('grid.textFilter.endsWith') },
        { value: TextFilterCondition.TextIs, text: t('grid.textFilter.is') },
        { value: TextFilterCondition.TextIsNot, text: t('grid.textFilter.isNot') },
        { value: TextFilterCondition.TextIsEmpty, text: t('grid.textFilter.isEmpty') },
        { value: TextFilterCondition.TextIsNotEmpty, text: t('grid.textFilter.isNotEmpty') },
      ];
    }

    if (textTypes.includes(fieldType)) {
      return [
        { value: TextFilterCondition.TextContains, text: t('grid.textFilter.contains') },
        { value: TextFilterCondition.TextDoesNotContain, text: t('grid.textFilter.doesNotContain') },
        { value: TextFilterCondition.TextStartsWith, text: t('grid.textFilter.startWith') },
        { value: TextFilterCondition.TextEndsWith, text: t('grid.textFilter.endsWith') },
        { value: TextFilterCondition.TextIs, text: t('grid.textFilter.is') },
        { value: TextFilterCondition.TextIsNot, text: t('grid.textFilter.isNot') },
        { value: TextFilterCondition.TextIsEmpty, text: t('grid.textFilter.isEmpty') },
        { value: TextFilterCondition.TextIsNotEmpty, text: t('grid.textFilter.isNotEmpty') },
      ];
    }

    if (fieldType === FieldType.Relation) {
      return [
        { value: RelationFilterCondition.RelationContains, text: t('grid.personFilter.contains') },
        { value: RelationFilterCondition.RelationDoesNotContain, text: t('grid.personFilter.doesNotContain') },
        { value: RelationFilterCondition.RelationIsEmpty, text: t('grid.personFilter.isEmpty') },
        { value: RelationFilterCondition.RelationIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
      ];
    }

    if (fieldType === FieldType.Number || fieldType === FieldType.Time || isNumericRollup) {
      return [
        { value: NumberFilterCondition.Equal, text: t('grid.numberFilter.equal') },
        { value: NumberFilterCondition.NotEqual, text: t('grid.numberFilter.notEqual') },
        { value: NumberFilterCondition.GreaterThan, text: t('grid.numberFilter.greaterThan') },
        { value: NumberFilterCondition.LessThan, text: t('grid.numberFilter.lessThan') },
        { value: NumberFilterCondition.GreaterThanOrEqualTo, text: t('grid.numberFilter.greaterThanOrEqualTo') },
        { value: NumberFilterCondition.LessThanOrEqualTo, text: t('grid.numberFilter.lessThanOrEqualTo') },
        { value: NumberFilterCondition.NumberIsEmpty, text: t('grid.textFilter.isEmpty') },
        { value: NumberFilterCondition.NumberIsNotEmpty, text: t('grid.textFilter.isNotEmpty') },
      ];
    }

    if (dateTypes.includes(fieldType)) {
      return [
        { value: DateFilterCondition.DateStartsOn, text: t('grid.dateFilter.is') },
        { value: DateFilterCondition.DateStartsBefore, text: t('grid.dateFilter.before') },
        { value: DateFilterCondition.DateStartsAfter, text: t('grid.dateFilter.after') },
        { value: DateFilterCondition.DateStartsOnOrBefore, text: t('grid.dateFilter.onOrBefore') },
        { value: DateFilterCondition.DateStartsOnOrAfter, text: t('grid.dateFilter.onOrAfter') },
        { value: DateFilterCondition.DateStartsBetween, text: t('grid.dateFilter.between') },
        { value: DateFilterCondition.DateStartsToday, text: t('relativeDates.today') },
        { value: DateFilterCondition.DateStartsYesterday, text: t('relativeDates.yesterday') },
        { value: DateFilterCondition.DateStartsTomorrow, text: t('relativeDates.tomorrow') },
        { value: DateFilterCondition.DateStartsThisWeek, text: t('relativeDates.thisWeek') },
        { value: DateFilterCondition.DateStartsLastWeek, text: t('relativeDates.lastWeek') },
        { value: DateFilterCondition.DateStartsNextWeek, text: t('relativeDates.nextWeek') },
        { value: DateFilterCondition.DateStartIsEmpty, text: t('grid.dateFilter.empty') },
        { value: DateFilterCondition.DateStartIsNotEmpty, text: t('grid.dateFilter.notEmpty') },
      ];
    }

    if (selectTypes.includes(fieldType)) {
      return [
        { value: SelectOptionFilterCondition.OptionIs, text: t('grid.selectOptionFilter.is') },
        { value: SelectOptionFilterCondition.OptionIsNot, text: t('grid.selectOptionFilter.isNot') },
        { value: SelectOptionFilterCondition.OptionContains, text: t('grid.selectOptionFilter.contains') },
        { value: SelectOptionFilterCondition.OptionDoesNotContain, text: t('grid.selectOptionFilter.doesNotContain') },
        { value: SelectOptionFilterCondition.OptionIsEmpty, text: t('grid.textFilter.isEmpty') },
        { value: SelectOptionFilterCondition.OptionIsNotEmpty, text: t('grid.textFilter.isNotEmpty') },
      ];
    }

    if (fieldType === FieldType.Checkbox) {
      // Checkbox shows "Is" as condition, with separate value dropdown for Checked/Unchecked
      return [{ value: -1, text: t('grid.checkboxFilter.is') }];
    }

    if (fieldType === FieldType.Checklist) {
      return [
        { value: ChecklistFilterCondition.IsComplete, text: t('grid.checklistFilter.isComplete') },
        { value: ChecklistFilterCondition.IsIncomplete, text: t('grid.checklistFilter.isIncomplted') },
      ];
    }

    if ([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(fieldType)) {
      return [
        { value: PersonFilterCondition.PersonContains, text: t('grid.personFilter.contains') },
        { value: PersonFilterCondition.PersonDoesNotContain, text: t('grid.personFilter.doesNotContain') },
        { value: PersonFilterCondition.PersonIsEmpty, text: t('grid.personFilter.isEmpty') },
        { value: PersonFilterCondition.PersonIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
      ];
    }

    return [];
  }, [fieldType, t, isNumericRollup]);
}

// Value Input Component - Renders appropriate input based on field type
interface ValueInputProps {
  filter: Filter;
  fieldType: FieldType | null;
  field?: YDatabaseField;
  disabled?: boolean;
}

function ValueInput({ filter, fieldType, field, disabled }: ValueInputProps) {
  if (fieldType === null) return null;

  const textTypes = [FieldType.RichText, FieldType.URL];
  const dateTypes = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];
  const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];
  const isNumericRollup = fieldType === FieldType.Rollup && isNumericRollupField(field);

  // Numeric rollup → number input. Non-numeric rollup → text input.
  if (fieldType === FieldType.Rollup) {
    return isNumericRollup
      ? <NumberValueInput filter={filter as NumberFilter} disabled={disabled} />
      : <TextValueInput filter={filter as TextFilter} disabled={disabled} />;
  }

  // Text/URL fields - editable text input
  if (textTypes.includes(fieldType)) {
    return <TextValueInput filter={filter as TextFilter} disabled={disabled} />;
  }

  if (fieldType === FieldType.Relation) {
    return <RelationValueInput filter={filter} disabled={disabled} />;
  }

  // Number / Time field - editable number input
  if (fieldType === FieldType.Number || fieldType === FieldType.Time) {
    return <NumberValueInput filter={filter as NumberFilter} disabled={disabled} />;
  }

  // Date fields - date picker
  if (dateTypes.includes(fieldType)) {
    return <DateValueInput filter={filter as DateFilter} disabled={disabled} />;
  }

  // Select fields - option picker
  if (selectTypes.includes(fieldType)) {
    return <SelectOptionValueInput filter={filter as SelectOptionFilter} disabled={disabled} />;
  }

  // Checkbox - shows Checked/Unchecked dropdown (which sets the condition)
  if (fieldType === FieldType.Checkbox) {
    return <CheckboxValueInput filter={filter as CheckboxFilter} disabled={disabled} />;
  }

  // Checklist - no value input needed (condition IS the value)
  if (fieldType === FieldType.Checklist) {
    return null;
  }

  // Person field - person picker
  if ([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(fieldType)) {
    return <PersonValueInput filter={filter as PersonFilter} fieldType={fieldType} disabled={disabled} />;
  }

  return null;
}

// Text Value Input — uses lightweight in-place updater (no tree rebuild on every keystroke)
function TextValueInput({ filter, disabled }: { filter: TextFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const { value, updateValue } = useDebouncedFilterInput({
    content: filter.content || '',
    filterId: filter.id,
    fieldId: filter.fieldId,
    updateFilter,
  });

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![TextFilterCondition.TextIsEmpty, TextFilterCondition.TextIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      updateValue(e.target.value);
    },
    [updateValue]
  );

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <input
        className='h-8 w-full rounded-md border border-border-primary bg-transparent px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-theme-thick focus:outline-none disabled:opacity-50'
        placeholder={t('grid.settings.typeAValue')}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        data-testid='advanced-filter-text-input'
      />
    </div>
  );
}

function parseRelationFilterRowIds(content: string | undefined) {
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);

    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function RelationValueInput({ filter, disabled }: { filter: Filter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [open, setOpen] = useState(false);
  const showInput = useMemo(() => {
    return [
      RelationFilterCondition.RelationContains,
      RelationFilterCondition.RelationDoesNotContain,
    ].includes(filter.condition);
  }, [filter.condition]);
  const selectedRowIds = useMemo(() => parseRelationFilterRowIds(filter.content), [filter.content]);
  const { loading, selectedView, relatedDatabaseId } = useRelationData(filter.fieldId, {
    enabled: showInput && open,
  });

  const updateSelectedRowIds = useCallback(
    (rowIds: string[]) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: JSON.stringify(rowIds),
      });
    },
    [filter.fieldId, filter.id, updateFilter]
  );

  const handleAddRelationRowId = useCallback(
    (rowId: string) => {
      if (selectedRowIds.includes(rowId)) return;
      updateSelectedRowIds([...selectedRowIds, rowId]);
    },
    [selectedRowIds, updateSelectedRowIds]
  );

  const handleRemoveRelationRowId = useCallback(
    (rowId: string) => {
      updateSelectedRowIds(selectedRowIds.filter((id) => id !== rowId));
    },
    [selectedRowIds, updateSelectedRowIds]
  );

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            className={cn(selectBoxClass, 'w-full')}
            data-testid='advanced-filter-relation-input'
          >
            <span className={cn('truncate text-sm', selectedRowIds.length > 0 ? 'text-text-primary' : 'text-text-tertiary')}>
              {selectedRowIds.length > 0 ? `${selectedRowIds.length} selected` : t('grid.settings.typeAValue')}
            </span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[340px] p-1'>
          {loading || !selectedView || !relatedDatabaseId ? (
            <div className='flex min-h-[100px] items-center justify-center'>
              {loading ? <Progress variant='primary' /> : t('grid.relation.inRelatedDatabase')}
            </div>
          ) : (
            <RelationCellMenuContent
              relationRowIds={selectedRowIds}
              selectedView={selectedView}
              relatedDatabaseId={relatedDatabaseId}
              loading={loading}
              onAddRelationRowId={handleAddRelationRowId}
              onRemoveRelationRowId={handleRemoveRelationRowId}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Number Value Input — uses lightweight in-place updater (no tree rebuild on every keystroke)
function NumberValueInput({ filter, disabled }: { filter: NumberFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const { value, updateValue } = useDebouncedFilterInput({
    content: filter.content || '',
    filterId: filter.id,
    fieldId: filter.fieldId,
    updateFilter,
  });

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![NumberFilterCondition.NumberIsEmpty, NumberFilterCondition.NumberIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      updateValue(e.target.value);
    },
    [updateValue]
  );

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <input
        className='h-8 w-full rounded-md border border-border-primary bg-transparent px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-theme-thick focus:outline-none disabled:opacity-50'
        placeholder={t('grid.settings.typeAValue')}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        inputMode='numeric'
        data-testid='advanced-filter-number-input'
      />
    </div>
  );
}

// Date Value Input - uses the existing DateTimeFilterDatePicker
function DateValueInput({ filter, disabled }: { filter: DateFilter; disabled?: boolean }) {
  // Don't show input for isEmpty/isNotEmpty or relative date conditions (Today, This week, …)
  const showInput = useMemo(() => {
    if (isRelativeDateCondition(filter.condition)) return false;

    return ![
      DateFilterCondition.DateStartIsEmpty,
      DateFilterCondition.DateStartIsNotEmpty,
      DateFilterCondition.DateEndIsEmpty,
      DateFilterCondition.DateEndIsNotEmpty,
    ].includes(filter.condition);
  }, [filter.condition]);

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <AdvancedDateFilterValueInput filter={filter} disabled={disabled} />
    </div>
  );
}

// Select Option Value Input — shows selected options as inline tags (matching desktop UI).
// Uses Popover for the option list. The outer AdvancedFiltersBadge Popover has
// onPointerDownOutside to prevent dismissal when clicking inside this nested popover.
function SelectOptionValueInput({ filter, disabled }: { filter: SelectOptionFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const { field } = useFieldSelector(filter.fieldId);
  const [open, setOpen] = useState(false);

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![SelectOptionFilterCondition.OptionIsEmpty, SelectOptionFilterCondition.OptionIsNotEmpty].includes(
      filter.condition
    );
  }, [filter.condition]);

  // Not memoized: `field` is a Yjs map with a stable identity that mutates in
  // place, so a [field]-keyed memo would serve stale options after edits.
  const typeOption = field ? parseSelectOptionTypeOptions(field) : null;

  const selectedIds = filter.optionIds?.filter((id) => id !== '') || [];
  const selectedIdSet = new Set(selectedIds);
  const selectedOptions = typeOption ? typeOption.options.filter((opt) => selectedIdSet.has(opt.id)) : [];

  const handleToggleOption = useCallback(
    (optionId: string) => {
      const currentIds = filter.optionIds || [];
      const newIds = currentIds.slice();
      const index = newIds.indexOf(optionId);

      if (index > -1) {
        newIds.splice(index, 1);
      } else {
        newIds.push(optionId);
      }

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: newIds.filter((id) => id !== '').join(','),
      });
    },
    [filter, updateFilter]
  );

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(selectBoxClass, 'w-full')}
            disabled={disabled}
            data-testid='advanced-filter-select-input'
          >
            <div className='flex min-w-0 flex-1 items-center gap-1 overflow-hidden'>
              {selectedOptions.length > 0 ? (
                selectedOptions.map((opt) => (
                  <Tooltip key={opt.id}>
                    <TooltipTrigger asChild>
                      <span className='shrink-0'>
                        <Tag
                          label={opt.name}
                          textColor={SelectOptionFgColorMap[opt.color]}
                          bgColor={SelectOptionColorMap[opt.color]}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top'>{opt.name}</TooltipContent>
                  </Tooltip>
                ))
              ) : (
                <span className='truncate text-sm text-text-tertiary'>{t('grid.settings.typeAValue')}</span>
              )}
            </div>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[240px] p-1'>
          <SelectOptionList
            fieldId={filter.fieldId}
            selectedIds={filter.optionIds || []}
            onSelect={handleToggleOption}
            showTooltips
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Checkbox Value Input — uses lightweight in-place updater (condition-only change, no tree restructure)
function CheckboxValueInput({ filter, disabled }: { filter: CheckboxFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();

  const handleSelect = useCallback(
    (condition: CheckboxFilterCondition) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        condition,
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  const selectedText = useMemo(() => {
    return filter.condition === CheckboxFilterCondition.IsChecked
      ? t('grid.checkboxFilter.checked')
      : t('grid.checkboxFilter.unChecked');
  }, [filter.condition, t]);

  return (
    <div className='min-w-0 flex-[7]'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            className={cn(selectBoxClass, 'w-full')}
            data-testid='advanced-filter-checkbox-input'
          >
            <span className='truncate text-sm text-text-primary'>{selectedText}</span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='min-w-[120px]'>
          <DropdownMenuItem
            onSelect={() => handleSelect(CheckboxFilterCondition.IsChecked)}
            data-testid='checkbox-filter-checked'
          >
            {t('grid.checkboxFilter.checked')}
            {filter.condition === CheckboxFilterCondition.IsChecked && <DropdownMenuItemTick />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleSelect(CheckboxFilterCondition.IsUnChecked)}
            data-testid='checkbox-filter-unchecked'
          >
            {t('grid.checkboxFilter.unChecked')}
            {filter.condition === CheckboxFilterCondition.IsUnChecked && <DropdownMenuItemTick />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Person Value Input — uses lightweight in-place updater (content-only change)
function PersonValueInput({
  filter,
  fieldType,
  disabled,
}: {
  filter: PersonFilter;
  fieldType: FieldType;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [open, setOpen] = useState(false);

  // Use cached mentionable users - only fetch when popover is open
  const { users: mentionableUsers, loading } = useMentionableUsersWithAutoFetch(open);
  const isAttributionField = fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;
  const mentionableUserOptions = useMemo(
    () =>
      mentionableUsers.flatMap((user) => {
        const identifier = isAttributionField ? canonicalizeUserUid(user.uid) : user.person_id;

        return identifier ? [{ identifier, user }] : [];
      }),
    [isAttributionField, mentionableUsers]
  );

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![PersonFilterCondition.PersonIsEmpty, PersonFilterCondition.PersonIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  const selectedUserIds = useMemo(() => {
    return filter.userIds || [];
  }, [filter.userIds]);

  const handleToggleUser = useCallback(
    (userId: string) => {
      const isSelected = selectedUserIds.includes(userId);
      const newSelectedIds = isSelected
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId];

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: JSON.stringify(newSelectedIds),
      });
    },
    [filter.id, filter.fieldId, selectedUserIds, updateFilter]
  );

  // Get display text for selected users
  const displayText = useMemo(() => {
    if (selectedUserIds.length === 0) {
      return t('grid.personFilter.selectPerson');
    }

    if (mentionableUserOptions.length === 0) {
      return `${selectedUserIds.length} selected`;
    }

    const selectedUsers = mentionableUserOptions
      .filter(({ identifier }) => selectedUserIds.includes(identifier))
      .map(({ user }) => user);

    if (selectedUsers.length === 0) {
      return `${selectedUserIds.length} selected`;
    }

    if (selectedUsers.length === 1) {
      return selectedUsers[0].name || selectedUsers[0].email || 'Unknown';
    }

    return `${selectedUsers.length} selected`;
  }, [mentionableUserOptions, selectedUserIds, t]);

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(selectBoxClass, 'w-full')}
            disabled={disabled}
            data-testid='advanced-filter-person-input'
          >
            <span
              className={cn(
                'truncate text-sm',
                selectedUserIds.length > 0 ? 'text-text-primary' : 'text-text-tertiary'
              )}
            >
              {displayText}
            </span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[280px] p-0'>
          <div className='max-h-[240px] overflow-y-auto p-2'>
            {loading ? (
              <div className='flex items-center justify-center py-4'>
                <Progress />
              </div>
            ) : mentionableUserOptions.length === 0 ? (
              <div className='py-4 text-center text-sm text-text-tertiary'>
                {t('grid.field.person.noMatches')}
              </div>
            ) : (
              mentionableUserOptions.map(({ identifier, user }) => {
                const isSelected = selectedUserIds.includes(identifier);
                const displayName = user.name || user.email || '?';

                return (
                  <div
                    key={identifier}
                    className={cn(
                      'flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1',
                      'hover:bg-fill-content-hover',
                      isSelected && 'bg-fill-content-hover'
                    )}
                    onClick={() => handleToggleUser(identifier)}
                  >
                    <Avatar className='h-6 w-6'>
                      <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                      <AvatarFallback className='text-xs' name={displayName}>
                        {displayName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className='flex flex-1 flex-col overflow-hidden'>
                      <span className='truncate text-sm'>{user.name || user.email}</span>
                      {user.name && user.email && (
                        <span className='truncate text-sm text-text-tertiary'>{user.email}</span>
                      )}
                    </div>
                    {isSelected && <CheckIcon className='h-4 w-4 flex-shrink-0 text-text-action' />}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default FilterPanelRow;
