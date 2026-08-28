import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as FilterSvg } from '@/assets/icons/filter.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AdvancedFilterPanel } from './AdvancedFilterPanel';

interface AdvancedFiltersBadgeProps {
  count: number;
}

export function AdvancedFiltersBadge({ count }: AdvancedFiltersBadgeProps) {
  const { t } = useTranslation();
  const context = useConditionsContext();
  const open = context?.advancedPanelOpen ?? false;
  const setAdvancedPanelOpen = context?.setAdvancedPanelOpen;

  const onOpenChange = useCallback(
    (open: boolean) => {
      setAdvancedPanelOpen?.(open);
    },
    [setAdvancedPanelOpen]
  );

  const label = count === 1 ? t('grid.filter.oneRule') : t('grid.filter.nRules', { count });

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={
            'flex h-7 items-center rounded-full border border-border-theme-thick bg-fill-theme-select px-2 py-1 outline-none'
          }
          data-testid='advanced-filters-badge'
        >
          <FilterSvg className='h-4 w-4 text-other-colors-text-event' />
          <span className='ml-1 whitespace-nowrap text-sm font-medium text-other-colors-text-event'>{label}</span>
          <ArrowDownSvg className='ml-1 h-5 w-5 text-icon-info-thick' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[520px] max-w-[520px] rounded-xl border border-border-primary bg-surface-layer-04 p-0 shadow-[0px_2px_16px_rgba(0,0,0,0.12)]'
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking inside nested floating elements
          // (select option picker, condition dropdown, field selector).
          // These render in portals outside this popover's DOM tree, so Radix
          // sees the click as "outside" and tries to dismiss.
          const target = e.target as HTMLElement | null;

          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
      >
        <AdvancedFilterPanel />
      </PopoverContent>
    </Popover>
  );
}

export default AdvancedFiltersBadge;
