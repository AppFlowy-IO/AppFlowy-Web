import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as FilterFunnelSvg } from '@/assets/icons/filter-funnel.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AdvancedFilterPanel } from './AdvancedFilterPanel';

interface AdvancedFiltersBadgeProps {
  count: number;
}

export function AdvancedFiltersBadge({ count }: AdvancedFiltersBadgeProps) {
  const { t } = useTranslation();

  const label = count === 1 ? t('grid.filter.oneRule') : t('grid.filter.nRules', { count });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className='flex h-7 items-center gap-1 rounded-md bg-fill-primary/10 px-2 text-text-link-default hover:bg-fill-primary/15'
          data-testid='advanced-filters-badge'
        >
          <FilterFunnelSvg className='h-4 w-4' />
          <span className='text-xs font-medium leading-none'>{label}</span>
          <ArrowDownSvg className='h-3 w-3' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-auto min-w-[500px] bg-surface-layer-02 p-0'
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
