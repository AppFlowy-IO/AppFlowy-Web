import { ChangeEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, Filter } from '@/application/database-yjs/database.type';
import { toggleFilterId } from '@/application/database-yjs/dispatch/filter-update';
import { CheckboxFilter, CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { ChecklistFilterCondition } from '@/application/database-yjs/fields/checklist/checklist.type';
import { DateFilter, DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { isRelativeDateCondition } from '@/application/database-yjs/fields/date/relativeDate';
import { NumberFilter, NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilter, PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { RelationFilterCondition } from '@/application/database-yjs/fields/relation/relation.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import {
  SelectOptionFilter,
  SelectOptionFilterCondition,
} from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilter, TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { isEndDateCondition } from '@/application/database-yjs/rollup/filter';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import RelationCellMenuContent from '@/components/database/components/cell/relation/RelationCellMenuContent';
import { FilterSearchInput } from '@/components/database/components/filters/filter-menu/FilterSearchInput';
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

import { useFilterEditorContext, useFilterValueUpdater } from '../filter-menu/FilterEditorContext';

import AdvancedDateFilterValueInput from './AdvancedDateFilterValueInput';

const selectBoxClass =
  'flex h-8 items-center justify-between gap-1 overflow-hidden rounded-md border border-border-primary bg-transparent px-2 text-sm text-text-primary data-[state=open]:border-border-theme-thick disabled:opacity-50';

// Condition Selector Component - Shows only conditions dropdown
interface ConditionSelectorProps {
  filter: Filter;
  fieldType: FieldType | null;
  field?: YDatabaseField;
  onConditionChange: (condition: number) => void;
  disabled?: boolean;
}

export function ConditionSelector({ filter, fieldType, field, onConditionChange, disabled }: ConditionSelectorProps) {
  const { t } = useTranslation();
  const baseConditions = useConditionsForFieldType(fieldType, t, field);
  const isEnd = fieldType === FieldType.DateTime && isEndDateCondition(filter.condition);
  const conditions = isEnd
    ? baseConditions.map((item) => ({ ...item, value: item.value >= 16 ? item.value + 6 : item.value + 8 }))
    : baseConditions;

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
        { value: NumberFilterCondition.Equal, text: '=' },
        { value: NumberFilterCondition.NotEqual, text: '≠' },
        { value: NumberFilterCondition.GreaterThan, text: '>' },
        { value: NumberFilterCondition.LessThan, text: '<' },
        { value: NumberFilterCondition.GreaterThanOrEqualTo, text: '≥' },
        { value: NumberFilterCondition.LessThanOrEqualTo, text: '≤' },
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

    if (fieldType === FieldType.Media)
      return [
        { value: 0, text: t('grid.textFilter.isEmpty') },
        { value: 1, text: t('grid.textFilter.isNotEmpty') },
      ];

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

export function ValueInput({ filter, fieldType, field, disabled }: ValueInputProps) {
  if (fieldType === null) return null;

  const textTypes = [FieldType.RichText, FieldType.URL];
  const dateTypes = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];
  const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];
  const isNumericRollup = fieldType === FieldType.Rollup && isNumericRollupField(field);

  // Numeric rollup → number input. Non-numeric rollup → text input.
  if (fieldType === FieldType.Rollup) {
    return isNumericRollup ? (
      <NumberValueInput filter={filter as NumberFilter} disabled={disabled} />
    ) : (
      <TextValueInput filter={filter as TextFilter} disabled={disabled} />
    );
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
  const updateFilter = useFilterValueUpdater();
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
  const updateFilter = useFilterValueUpdater();
  const [open, setOpen] = useState(false);
  const showInput = useMemo(() => {
    return [RelationFilterCondition.RelationContains, RelationFilterCondition.RelationDoesNotContain].includes(
      filter.condition
    );
  }, [filter.condition]);
  const selectedRowIds = useMemo(() => parseRelationFilterRowIds(filter.content), [filter.content]);
  const targetField = useFilterEditorContext()?.field;
  const { loading, selectedView, relatedDatabaseId } = useRelationData(filter.fieldId, {
    field: targetField,
    enabled: showInput && open,
  });

  const handleAddRelationRowId = useCallback(
    (rowId: string) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        transformContent: (current) => toggleFilterId(current, rowId, true, true),
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  const handleRemoveRelationRowId = useCallback(
    (rowId: string) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        transformContent: (current) => toggleFilterId(current, rowId, true, false),
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button className={cn(selectBoxClass, 'w-full')} data-testid='advanced-filter-relation-input'>
            <span
              className={cn('truncate text-sm', selectedRowIds.length > 0 ? 'text-text-primary' : 'text-text-tertiary')}
            >
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
  const updateFilter = useFilterValueUpdater();
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
  const updateFilter = useFilterValueUpdater();
  const { field: localField } = useFieldSelector(filter.fieldId);
  const field = useFilterEditorContext()?.field ?? localField;
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
  const unresolvedRollup = Number(field?.get(YjsDatabaseKey.type)) === FieldType.Rollup;

  const handleToggleOption = useCallback(
    (optionId: string) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        transformContent: (current) => toggleFilterId(current, optionId, false),
      });
    },
    [filter.id, filter.fieldId, updateFilter]
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
              {unresolvedRollup && selectedIds.length > 0 ? (
                <span className='truncate text-sm'>{selectedIds.length}</span>
              ) : selectedOptions.length > 0 ? (
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
            options={typeOption?.options}
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
  const updateFilter = useFilterValueUpdater();

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
          <button className={cn(selectBoxClass, 'w-full')} data-testid='advanced-filter-checkbox-input'>
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
  const updateFilter = useFilterValueUpdater();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

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
  const unknownUserIds = useMemo(() => {
    const knownIds = new Set(mentionableUserOptions.map(({ identifier }) => identifier));

    return selectedUserIds.filter((id) => !knownIds.has(id));
  }, [mentionableUserOptions, selectedUserIds]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleUsers = mentionableUserOptions.filter(({ user }) =>
    `${user.name ?? ''} ${user.email ?? ''}`.toLocaleLowerCase().includes(normalizedSearch)
  );
  const visibleUnknownUserIds = unknownUserIds.filter((id) =>
    `${t('grid.person.unknownUser')} ${id}`.toLocaleLowerCase().includes(normalizedSearch)
  );
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setSearch('');
  }, []);

  const handleToggleUser = useCallback(
    (userId: string) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        transformContent: (current) => toggleFilterId(current, userId),
      });
    },
    [filter.id, filter.fieldId, updateFilter]
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

    if (selectedUserIds.length === 1 && selectedUsers.length === 1) {
      return selectedUsers[0].name || selectedUsers[0].email || 'Unknown';
    }

    return `${selectedUserIds.length} selected`;
  }, [mentionableUserOptions, selectedUserIds, t]);

  if (!showInput) return <div className='min-w-0 flex-[7]' />;

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={cn(selectBoxClass, 'w-full')}
            disabled={disabled}
            data-testid='advanced-filter-person-input'
          >
            <span
              className={cn('truncate text-sm', selectedUserIds.length > 0 ? 'text-text-primary' : 'text-text-tertiary')}
            >
              {displayText}
            </span>
            <ArrowDownSvg className='h-5 w-5 shrink-0 text-icon-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[280px] p-0'>
          <FilterSearchInput value={search} onChange={setSearch} />
          <div key={search} data-testid='filter-option-results' className='max-h-[240px] overflow-y-auto p-2'>
            {loading ? (
              <div className='flex items-center justify-center py-4'>
                <Progress />
              </div>
            ) : visibleUsers.length === 0 && visibleUnknownUserIds.length === 0 ? (
              <div className='py-4 text-center text-sm text-text-tertiary'>{t('grid.field.person.noMatches')}</div>
            ) : (
              visibleUsers.map(({ identifier, user }) => {
                const isSelected = selectedUserIds.includes(identifier);
                const displayName = user.name || user.email || '?';

                return (
                  <button
                    type='button'
                    key={identifier}
                    disabled={disabled}
                    className={cn(
                      'flex min-h-[36px] w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left',
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
                  </button>
                );
              })
            )}
            {visibleUnknownUserIds.map((id) => (
              <button
                type='button'
                key={id}
                disabled={disabled}
                className='flex min-h-[36px] w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-fill-content-hover'
                onClick={() => handleToggleUser(id)}
              >
                <span className='flex-1 truncate text-sm'>{t('grid.person.unknownUser')}</span>
                <CheckIcon className='h-4 w-4 shrink-0 text-text-action' />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
