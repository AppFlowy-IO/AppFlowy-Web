import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useReadOnly } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import { useEnterAdvancedMode, useRemoveFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { FieldDisplay } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useConditionsContext } from '../../conditions/context';

function FieldMenuTitle({
  filterId,
  fieldId,
  renderConditionSelect,
}: {
  filterId: string;
  fieldId: string;
  renderConditionSelect: React.ReactNode;
}) {
  const deleteFilter = useRemoveFilter();
  const enterAdvancedMode = useEnterAdvancedMode();
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const context = useConditionsContext();
  const setAdvancedMode = context?.setAdvancedMode;
  const setOpenFilterId = context?.setOpenFilterId;

  const handleDeleteFilter = useCallback(() => {
    deleteFilter(filterId);
    setMenuOpen(false);
  }, [deleteFilter, filterId]);

  const handleAddToAdvancedFilter = useCallback(() => {
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
    <div className={'flex items-center justify-between gap-2 text-sm text-text-primary'}>
      <div className={'max-w-[100px] overflow-hidden'}>
        <FieldDisplay className={'w-full truncate'} fieldId={fieldId} />
      </div>
      <div className={'flex flex-1 items-center justify-end'}>{renderConditionSelect}</div>
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
            <DropdownMenuItem
              variant='destructive'
              onSelect={handleDeleteFilter}
              data-testid='delete-filter-button'
            >
              <DeleteIcon className={'h-5 w-5'} />
              {t('grid.settings.deleteFilter')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddToAdvancedFilter}>
              <FilterIcon className={'h-5 w-5'} />
              {t('grid.filter.addToAdvancedFilter')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default FieldMenuTitle;
