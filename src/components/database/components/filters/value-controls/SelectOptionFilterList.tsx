import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { FilterSearchInput } from '@/components/database/components/filters/filter-menu/FilterSearchInput';
import { DropdownMenuItemTick } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { filterValueItemClassName } from './filter-value-item';

const SelectOptionFilterRow = memo(function SelectOptionFilterRow({
  option,
  checked,
  showTooltip,
  testId,
  onToggle,
}: {
  option: SelectOption;
  checked: boolean;
  showTooltip: boolean;
  testId: string;
  onToggle: (optionId: string) => void;
}) {
  const tag = (
    <Tag label={option.name} textColor={SelectOptionFgColorMap[option.color]} bgColor={SelectOptionColorMap[option.color]} />
  );

  return (
    <button
      type='button'
      data-testid={testId}
      data-option-id={option.id}
      data-checked={checked}
      className={filterValueItemClassName}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(option.id);
      }}
    >
      {showTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='min-w-0 truncate'>{tag}</span>
          </TooltipTrigger>
          <TooltipContent side='top'>{option.name}</TooltipContent>
        </Tooltip>
      ) : (
        tag
      )}
      {checked && <DropdownMenuItemTick />}
    </button>
  );
});

export interface SelectOptionFilterListProps {
  options: readonly SelectOption[];
  selectedIds: readonly string[];
  /** A stable callback keeps the rows from re-rendering on every toggle. */
  onToggle: (optionId: string) => void;
  /** Desktop parity: the advanced panel shows the full option name in a tooltip above the tag. */
  showTooltips?: boolean;
  optionTestId?: string;
  /** Height limit of the scrolling list. */
  listClassName?: string;
}

/**
 * The option picker of a select filter: a search box above the field's
 * options. Presentational: it reads no database context, so the view filter
 * menus, the advanced panel and the dashboard's global filter editor share it.
 * The list returns to the top when the search changes.
 */
export function SelectOptionFilterList({
  options,
  selectedIds,
  onToggle,
  showTooltips = false,
  optionTestId = 'select-option-list',
  listClassName = 'max-h-[300px]',
}: SelectOptionFilterListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const keyword = search.trim().toLocaleLowerCase();
  const visible = options.filter(
    (option) => Boolean(option && option.id) && option.name.toLocaleLowerCase().includes(keyword)
  );

  return (
    <div>
      <FilterSearchInput value={search} onChange={setSearch} />
      <div
        key={search}
        data-testid='filter-option-results'
        className={cn('appflowy-scroller flex flex-col overflow-y-auto', listClassName)}
      >
        {visible.map((option) => (
          <SelectOptionFilterRow
            key={option.id}
            option={option}
            checked={selectedIds.includes(option.id)}
            showTooltip={showTooltips}
            testId={optionTestId}
            onToggle={onToggle}
          />
        ))}
        {visible.length === 0 && (
          <div className='py-4 text-center text-sm text-text-tertiary'>{t('inlineActions.noResults')}</div>
        )}
      </div>
    </div>
  );
}

export default SelectOptionFilterList;
