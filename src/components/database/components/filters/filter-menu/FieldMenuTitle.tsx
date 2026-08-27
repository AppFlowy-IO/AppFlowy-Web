import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import { useEnterAdvancedMode, useRemoveFilter } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useConditionsContext } from '../../conditions/context';

/**
 * Shared editor header, mirroring the desktop filter popover header:
 * `[field name] [condition select(s)] ......... [⋯ menu]`
 * The field name is rendered without an icon, in tertiary caption style.
 */
function FieldMenuTitle({
  filterId,
  fieldId,
  renderConditionSelect,
  nameMaxWidthClassName,
}: {
  filterId: string;
  fieldId: string;
  renderConditionSelect: React.ReactNode;
  /** Desktop caps the field name at 150px, except the date editor which uses 120px. */
  nameMaxWidthClassName?: string;
}) {
  const deleteFilter = useRemoveFilter();
  const enterAdvancedMode = useEnterAdvancedMode();
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { field } = useFieldSelector(fieldId);
  const fieldName = field?.get(YjsDatabaseKey.name) ?? '';

  const context = useConditionsContext();
  const setAdvancedMode = context?.setAdvancedMode;
  const setOpenFilterId = context?.setOpenFilterId;

  const handleDeleteFilter = useCallback(() => {
    deleteFilter(filterId);
    setMenuOpen(false);
  }, [deleteFilter, filterId]);

  const handleSwitchToAdvancedFilter = useCallback(() => {
    // Enter advanced mode - this will wrap existing filters in a hierarchical structure
    // Use AND as the default root operator
    enterAdvancedMode(FilterType.And);
    // Switch to advanced mode in UI
    setAdvancedMode?.(true);
    // Close the filter popover
    setOpenFilterId?.(undefined);
    setMenuOpen(false);
  }, [enterAdvancedMode, setAdvancedMode, setOpenFilterId]);

  return (
    <div className={'flex items-center gap-1'}>
      <span
        className={cn(
          'truncate whitespace-nowrap text-xs font-medium text-text-tertiary',
          nameMaxWidthClassName ?? 'max-w-[150px]'
        )}
      >
        {fieldName}
      </span>
      {renderConditionSelect}
      <div className={'flex-1'} />
      {!readOnly && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size={'icon-sm'}
              variant={'ghost'}
              data-testid='filter-more-options-button'
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon className={'h-5 w-5'} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-[200px]'>
            <DropdownMenuItem onSelect={handleSwitchToAdvancedFilter}>
              <FilterIcon className={'h-5 w-5'} />
              {t('grid.filter.switchToAdvancedFilter')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDeleteFilter} data-testid='delete-filter-button'>
              <DeleteIcon className={'h-5 w-5'} />
              {t('grid.settings.deleteFilter')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default FieldMenuTitle;
