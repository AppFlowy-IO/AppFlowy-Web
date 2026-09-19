import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { useDashboardContextOptional } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { GlobalFilterMenu } from './GlobalFilterMenu';
import { useGlobalFilterActions } from './useGlobalFilterActions';

function GlobalFilterButtonContent({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const { filters } = useGlobalFilterActions();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const count = filters.length;
  const label = t('dashboard.globalFilters.button', { defaultValue: 'Filter' });

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size={compact ? 'icon-sm' : 'icon'}
              aria-label={label}
              className='relative'
              data-testid='dashboard-global-filter-button'
              data-count={count}
              style={{ color: count > 0 ? 'var(--icon-info-thick)' : undefined }}
            >
              <FilterIcon aria-hidden='true' className='h-5 w-5' />
              {count > 0 && (
                <span
                  data-testid='dashboard-global-filter-button-badge'
                  className='absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-fill-theme-thick px-1 text-[10px] font-medium leading-none text-text-on-fill'
                >
                  {count}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t('dashboard.globalFilters.title', { defaultValue: 'Filter multiple sources' })}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align='end'
        className='w-[360px]'
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        <GlobalFilterMenu onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Toolbar button that opens "Filter multiple sources". Available in View mode
 * too, so readers can adjust the filters for themselves. Renders nothing
 * outside a `DashboardProvider`.
 */
export function GlobalFilterButton({ compact = false }: { compact?: boolean }) {
  const context = useDashboardContextOptional();

  if (!context) return null;
  return <GlobalFilterButtonContent compact={compact} />;
}

export default GlobalFilterButton;
