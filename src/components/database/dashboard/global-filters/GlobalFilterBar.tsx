import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useDashboardContextOptional } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { GlobalFilterChip } from './GlobalFilterChip';
import { GlobalFilterMenu } from './GlobalFilterMenu';
import { useDashboardFilterSources, useGlobalFilterActions } from './useGlobalFilterActions';

function GlobalFilterBarContent({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { filters, hasLocalChanges, canEdit, isEditing, resetLocal, saveForEverybody } = useGlobalFilterActions();
  const sources = useDashboardFilterSources();
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => setAdding(false), []);

  if (filters.length === 0 && !isEditing && !hasLocalChanges) return null;

  return (
    <div
      data-testid='dashboard-global-filter-bar'
      className={cn('flex min-h-[36px] flex-wrap items-center gap-1.5 py-1', className)}
    >
      {filters.map((filter) => (
        <GlobalFilterChip key={filter.id} filter={filter} sources={sources} />
      ))}

      {isEditing && canEdit && (
        <Popover modal open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              data-testid='dashboard-global-filter-bar-add'
              className='h-7 rounded-full px-2 font-medium text-text-secondary'
            >
              <PlusIcon className='h-4 w-4 text-icon-secondary' />
              {t('dashboard.globalFilters.add', { defaultValue: 'Add global filter' })}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align='start'
            className='w-[360px]'
            onCloseAutoFocus={(event) => event.preventDefault()}
            onClick={(event) => event.stopPropagation()}
          >
            <GlobalFilterMenu startWithPicker onClose={closeAdd} />
          </PopoverContent>
        </Popover>
      )}

      {hasLocalChanges && (
        <div className='ml-auto flex items-center gap-1'>
          <span
            data-testid='dashboard-global-filter-local-badge'
            className='rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-secondary'
          >
            {t('dashboard.globalFilters.localChanges', { defaultValue: 'Only you see these filter changes' })}
          </span>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 px-2'
            data-testid='dashboard-global-filter-reset'
            onClick={resetLocal}
          >
            {t('dashboard.globalFilters.reset', { defaultValue: 'Reset' })}
          </Button>
          {canEdit && (
            <Button
              size='sm'
              className='h-7 px-2'
              data-testid='dashboard-global-filter-save-for-everybody'
              onClick={saveForEverybody}
            >
              {t('dashboard.globalFilters.saveForEverybody', { defaultValue: 'Save for everybody' })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Chips row of the dashboard's global filters. Hidden while there is nothing
 * to show (no filters, not editing, no local override). Renders nothing
 * outside a `DashboardProvider`.
 */
export function GlobalFilterBar({ className }: { className?: string }) {
  const context = useDashboardContextOptional();

  if (!context) return null;
  return <GlobalFilterBarContent className={className} />;
}

export default GlobalFilterBar;
