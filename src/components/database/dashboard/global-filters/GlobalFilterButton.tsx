import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { useDashboardContextOptional, useDashboardFilters } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { LazyGlobalFilterMenu, preloadGlobalFilterMenu } from './LazyGlobalFilterMenu';

function GlobalFilterButtonContent() {
  const { t } = useTranslation();
  // Only the count is read while closed (as `data-count`); the menu reads the rest itself.
  const { effectiveGlobalFilters } = useDashboardFilters();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const count = effectiveGlobalFilters.length;
  const label = t('dashboard.globalFilters.button', { defaultValue: 'Filter' });

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={label}
              // The dashboard toolbar button: 28×28, radius 6, a 16px glyph. No count badge.
              className='relative h-7 w-7 !rounded-200 p-1.5 text-dash-tool-icon data-[state=open]:bg-dash-hover-fill [&_svg]:h-4 [&_svg]:w-4'
              data-parity-id='dash-toolbar-filter'
              // Set here: the tooltip trigger around it would otherwise put its own state on the button.
              data-state={open ? 'open' : 'closed'}
              data-testid='dashboard-global-filter-button'
              data-count={count}
              onFocus={preloadGlobalFilterMenu}
              onPointerEnter={preloadGlobalFilterMenu}
            >
              <FilterIcon aria-hidden='true' data-parity-id='dash-toolbar-filter__icon' />
              {/* The unsaved-changes dot (WP07), out of the flow so the glyph stays centred. */}
              <span className='absolute right-1 top-1' data-slot='unsaved-dot' />
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
        data-parity-id='dash-global-filter-popover'
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        <LazyGlobalFilterMenu onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Toolbar button that opens "Filter multiple sources". Available in View mode
 * too, so readers can adjust the filters for themselves. Renders nothing
 * outside a `DashboardProvider`.
 */
export function GlobalFilterButton() {
  const context = useDashboardContextOptional();

  if (!context) return null;
  return <GlobalFilterButtonContent />;
}

export default GlobalFilterButton;
