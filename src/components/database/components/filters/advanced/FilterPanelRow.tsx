import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CheckboxFilter,
  CheckboxFilterCondition,
  ChecklistFilterCondition,
  DateFilter,
  DateFilterCondition,
  FieldType,
  Filter,
  NumberFilter,
  NumberFilterCondition,
  PersonFilter,
  PersonFilterCondition,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilter,
  TextFilterCondition,
  useFieldSelector,
  useReadOnly,
  useRootFilterInfo,
} from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import {
  useRemoveAdvancedFilter,
  useUpdateAdvancedFilter,
  useUpdateRootFilterType,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FieldDisplay } from '@/components/database/components/field';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';
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
import { cn } from '@/lib/utils';

import AdvancedDateFilterValueInput from './AdvancedDateFilterValueInput';

interface FilterPanelRowProps {
  filter: Filter;
  isFirst: boolean;
}

export function FilterPanelRow({ filter, isFirst }: FilterPanelRowProps) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const removeFilter = useRemoveAdvancedFilter();
  const updateFilter = useUpdateAdvancedFilter();
  const updateRootFilterType = useUpdateRootFilterType();
  const { field } = useFieldSelector(filter.fieldId);
  const rootFilterInfo = useRootFilterInfo();

  const [fieldSelectorOpen, setFieldSelectorOpen] = useState(false);

  const fieldType: FieldType | null = useMemo(() => {
    if (!field) return null;
    return Number(field.get(YjsDatabaseKey.type)) as FieldType;
  }, [field]);

  const handleRemove = useCallback(() => {
    removeFilter(filter.id);
  }, [filter.id, removeFilter]);

  const handleFieldChange = useCallback(
    (newFieldId: string) => {
      updateFilter({
        filterId: filter.id,
        fieldId: newFieldId,
      });
      setFieldSelectorOpen(false);
    },
    [filter.id, updateFilter]
  );

  const handleOperatorChange = useCallback(
    (operator: FilterType.And | FilterType.Or) => {
      updateRootFilterType(operator);
    },
    [updateRootFilterType]
  );

  const handleConditionChange = useCallback(
    (condition: number) => {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        condition,
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  if (!field) return null;

  return (
    <div className='flex items-center gap-2 px-2 py-1.5' data-testid='advanced-filter-row'>
      {/* Where / And / Or selector - fixed width */}
      <div className='w-[56px] shrink-0'>
        {isFirst ? (
          <span className='pl-1 text-sm text-text-primary'>{t('grid.filter.where')}</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button className='flex h-7 w-full items-center justify-between gap-1 rounded-md px-2 hover:bg-fill-list-hover'>
                <span className='text-xs text-text-primary'>
                  {rootFilterInfo?.rootType === FilterType.Or ? t('grid.filter.or') : t('grid.filter.and')}
                </span>
                <ArrowDownSvg className='h-3 w-3 text-text-primary' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='min-w-[80px]'>
              <DropdownMenuItem onSelect={() => handleOperatorChange(FilterType.And)}>
                {t('grid.filter.and')}
                {rootFilterInfo?.rootType === FilterType.And && <DropdownMenuItemTick />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleOperatorChange(FilterType.Or)}>
                {t('grid.filter.or')}
                {rootFilterInfo?.rootType === FilterType.Or && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Field selector - flex-[2] */}
      <PropertiesMenu
        asChild
        searchPlaceholder={t('grid.settings.filterBy')}
        onSelect={handleFieldChange}
        open={fieldSelectorOpen}
        onOpenChange={setFieldSelectorOpen}
      >
        <button
          className='flex h-7 flex-[2] items-center justify-between gap-1 overflow-hidden rounded-md px-2 hover:bg-fill-list-hover disabled:opacity-50'
          disabled={readOnly}
        >
          <FieldDisplay fieldId={filter.fieldId} className='truncate text-xs' />
          <ArrowDownSvg className='h-3 w-3 shrink-0 text-text-primary' />
        </button>
      </PropertiesMenu>

      {/* Condition selector - flex-[2] */}
      <ConditionSelector
        filter={filter}
        fieldType={fieldType}
        onConditionChange={handleConditionChange}
        disabled={readOnly}
      />

      {/* Value input - flex-[3] */}
      <ValueInput filter={filter} fieldType={fieldType} disabled={readOnly} />

      {/* Delete button - 24px */}
      {!readOnly && (
        <button
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-fill-list-hover'
          onClick={handleRemove}
          data-testid='delete-advanced-filter-button'
        >
          <DeleteIcon className='h-4 w-4 text-text-caption' />
        </button>
      )}
    </div>
  );
}

// Condition Selector Component - Shows only conditions dropdown
interface ConditionSelectorProps {
  filter: Filter;
  fieldType: FieldType | null;
  onConditionChange: (condition: number) => void;
  disabled?: boolean;
}

function ConditionSelector({ filter, fieldType, onConditionChange, disabled }: ConditionSelectorProps) {
  const { t } = useTranslation();
  const conditions = useConditionsForFieldType(fieldType, t);

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
      <div className='flex h-7 flex-[2] items-center gap-1 overflow-hidden rounded-md px-2'>
        <span className='truncate text-xs text-text-primary'>{selectedCondition?.text}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className='flex h-7 flex-[2] items-center justify-between gap-1 overflow-hidden rounded-md px-2 hover:bg-fill-list-hover disabled:opacity-50'
          data-testid='filter-condition-selector'
        >
          <span className='truncate text-xs text-text-primary'>
            {selectedCondition?.text || t('grid.filter.conditon')}
          </span>
          <ArrowDownSvg className='h-3 w-3 shrink-0 text-text-primary' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[140px]'>
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
  );
}

// Get conditions based on field type
function useConditionsForFieldType(
  fieldType: FieldType | null,
  t: (key: string) => string
): { value: number; text: string }[] {
  return useMemo(() => {
    if (fieldType === null) return [];

    const textTypes = [FieldType.RichText, FieldType.URL, FieldType.Relation, FieldType.Rollup];
    const dateTypes = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];
    const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];

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

    if (fieldType === FieldType.Number) {
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

    if (fieldType === FieldType.Person) {
      return [
        { value: PersonFilterCondition.PersonContains, text: t('grid.personFilter.contains') },
        { value: PersonFilterCondition.PersonDoesNotContain, text: t('grid.personFilter.doesNotContain') },
        { value: PersonFilterCondition.PersonIsEmpty, text: t('grid.personFilter.isEmpty') },
        { value: PersonFilterCondition.PersonIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
      ];
    }

    return [];
  }, [fieldType, t]);
}

// Value Input Component - Renders appropriate input based on field type
interface ValueInputProps {
  filter: Filter;
  fieldType: FieldType | null;
  disabled?: boolean;
}

function ValueInput({ filter, fieldType, disabled }: ValueInputProps) {
  if (fieldType === null) return null;

  const textTypes = [FieldType.RichText, FieldType.URL, FieldType.Relation, FieldType.Rollup];
  const dateTypes = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];
  const selectTypes = [FieldType.SingleSelect, FieldType.MultiSelect];

  // Text/URL fields - editable text input
  if (textTypes.includes(fieldType)) {
    return <TextValueInput filter={filter as TextFilter} disabled={disabled} />;
  }

  // Number field - editable number input
  if (fieldType === FieldType.Number) {
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

  // Person field - person picker (placeholder for now)
  if (fieldType === FieldType.Person) {
    return <PersonValueInput filter={filter as PersonFilter} disabled={disabled} />;
  }

  return null;
}

// Text Value Input
function TextValueInput({ filter, disabled }: { filter: TextFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [value, setValue] = useState<string>(filter.content || '');

  // Sync local state when filter.content changes externally (e.g., from Yjs sync)
  useEffect(() => {
    setValue(filter.content || '');
  }, [filter.content]);

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![TextFilterCondition.TextIsEmpty, TextFilterCondition.TextIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: e.target.value,
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  if (!showInput) return <div className='min-w-0 flex-[3]' />;

  return (
    <div className='min-w-0 flex-[3]'>
      <input
        className='h-7 w-full rounded-md border border-line-border bg-transparent px-2 text-xs text-text-primary placeholder:text-text-caption focus:border-content-blue-400 focus:outline-none disabled:opacity-50'
        placeholder={t('grid.settings.typeAValue')}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        data-testid='advanced-filter-text-input'
      />
    </div>
  );
}

// Number Value Input
function NumberValueInput({ filter, disabled }: { filter: NumberFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [value, setValue] = useState<string>(filter.content || '');

  // Sync local state when filter.content changes externally (e.g., from Yjs sync)
  useEffect(() => {
    setValue(filter.content || '');
  }, [filter.content]);

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![NumberFilterCondition.NumberIsEmpty, NumberFilterCondition.NumberIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: e.target.value,
      });
    },
    [filter.id, filter.fieldId, updateFilter]
  );

  if (!showInput) return <div className='min-w-0 flex-[3]' />;

  return (
    <div className='min-w-0 flex-[3]'>
      <input
        className='h-7 w-full rounded-md border border-line-border bg-transparent px-2 text-xs text-text-primary placeholder:text-text-caption focus:border-content-blue-400 focus:outline-none disabled:opacity-50'
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
  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![
      DateFilterCondition.DateStartIsEmpty,
      DateFilterCondition.DateStartIsNotEmpty,
      DateFilterCondition.DateEndIsEmpty,
      DateFilterCondition.DateEndIsNotEmpty,
    ].includes(filter.condition);
  }, [filter.condition]);

  if (!showInput) return <div className='min-w-0 flex-[3]' />;

  return (
    <div className='min-w-0 flex-[3]'>
      <AdvancedDateFilterValueInput filter={filter} disabled={disabled} />
    </div>
  );
}

// Select Option Value Input
function SelectOptionValueInput({ filter, disabled }: { filter: SelectOptionFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [open, setOpen] = useState(false);

  // Don't show input for isEmpty/isNotEmpty conditions
  const showInput = useMemo(() => {
    return ![SelectOptionFilterCondition.OptionIsEmpty, SelectOptionFilterCondition.OptionIsNotEmpty].includes(
      filter.condition
    );
  }, [filter.condition]);

  const handleToggleOption = useCallback(
    (optionId: string) => {
      const selectedIds = filter.optionIds || [];
      const newSelectedIds = selectedIds.slice();
      const index = newSelectedIds.indexOf(optionId);

      if (index > -1) {
        newSelectedIds.splice(index, 1);
      } else {
        newSelectedIds.push(optionId);
      }

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: newSelectedIds.filter((id) => id !== '').join(','),
      });
    },
    [filter, updateFilter]
  );

  if (!showInput) return <div className='min-w-0 flex-[3]' />;

  const selectedCount = filter.optionIds?.filter((id) => id !== '').length || 0;

  return (
    <div className='min-w-0 flex-[3]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className='flex h-7 w-full items-center justify-between gap-1 overflow-hidden rounded-md px-2 hover:bg-fill-list-hover disabled:opacity-50'
            disabled={disabled}
            data-testid='advanced-filter-select-input'
          >
            <span className='truncate text-xs text-text-primary'>
              {selectedCount > 0 ? `${selectedCount} selected` : t('grid.settings.typeAValue')}
            </span>
            <ArrowDownSvg className='h-3 w-3 shrink-0 text-text-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[200px] p-1'>
          <SelectOptionList fieldId={filter.fieldId} selectedIds={filter.optionIds || []} onSelect={handleToggleOption} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Checkbox Value Input - dropdown showing Checked/Unchecked
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
    <div className='min-w-0 flex-[3]'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            className='flex h-7 w-full items-center justify-between gap-1 overflow-hidden rounded-md border border-line-border bg-transparent px-2 hover:border-content-blue-400 disabled:opacity-50'
            data-testid='advanced-filter-checkbox-input'
          >
            <span className='truncate text-xs text-text-primary'>{selectedText}</span>
            <ArrowDownSvg className='h-3 w-3 shrink-0 text-text-primary' />
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

// Person Value Input - shows person picker
function PersonValueInput({ filter, disabled }: { filter: PersonFilter; disabled?: boolean }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateAdvancedFilter();
  const [open, setOpen] = useState(false);

  // Use cached mentionable users - only fetch when popover is open
  const { users: mentionableUsers, loading } = useMentionableUsersWithAutoFetch(open);

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

    if (!mentionableUsers || mentionableUsers.length === 0) {
      return `${selectedUserIds.length} selected`;
    }

    const selectedUsers = mentionableUsers.filter((u) => selectedUserIds.includes(u.person_id));

    if (selectedUsers.length === 0) {
      return `${selectedUserIds.length} selected`;
    }

    if (selectedUsers.length === 1) {
      return selectedUsers[0].name || selectedUsers[0].email || 'Unknown';
    }

    return `${selectedUsers.length} selected`;
  }, [selectedUserIds, mentionableUsers, t]);

  if (!showInput) return <div className='min-w-0 flex-[3]' />;

  return (
    <div className='min-w-0 flex-[3]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className='flex h-7 w-full items-center justify-between gap-1 overflow-hidden rounded-md border border-line-border bg-transparent px-2 hover:border-content-blue-400 disabled:opacity-50'
            disabled={disabled}
            data-testid='advanced-filter-person-input'
          >
            <span
              className={cn(
                'truncate text-xs',
                selectedUserIds.length > 0 ? 'text-text-primary' : 'text-text-caption'
              )}
            >
              {displayText}
            </span>
            <ArrowDownSvg className='h-3 w-3 shrink-0 text-text-primary' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[280px] p-0'>
          <div className='max-h-[240px] overflow-y-auto p-2'>
            {loading ? (
              <div className='flex items-center justify-center py-4'>
                <Progress />
              </div>
            ) : !mentionableUsers || mentionableUsers.length === 0 ? (
              <div className='py-4 text-center text-sm text-text-tertiary'>
                {t('grid.field.person.noMatches')}
              </div>
            ) : (
              mentionableUsers.map((user) => {
                const isSelected = selectedUserIds.includes(user.person_id);
                const displayName = user.name || user.email || '?';

                return (
                  <div
                    key={user.person_id}
                    className={cn(
                      'flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1',
                      'hover:bg-fill-content-hover',
                      isSelected && 'bg-fill-content-hover'
                    )}
                    onClick={() => handleToggleUser(user.person_id)}
                  >
                    <Avatar className='h-6 w-6'>
                      <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                      <AvatarFallback className='text-xs'>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className='flex flex-1 flex-col overflow-hidden'>
                      <span className='truncate text-sm'>{user.name || user.email}</span>
                      {user.name && user.email && (
                        <span className='truncate text-xs text-text-tertiary'>{user.email}</span>
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
