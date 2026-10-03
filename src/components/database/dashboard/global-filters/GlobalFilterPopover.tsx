import { ReactNode, useCallback, useState } from 'react';

import { Popover, PopoverContent } from '@/components/ui/popover';

import { LazyGlobalFilterMenu, preloadGlobalFilterMenu } from './LazyGlobalFilterMenu';

import type { GlobalFilterMenuScreen } from './GlobalFilterMenu';

/**
 * Spread on the element that opens a `GlobalFilterPopover`: the menu's code
 * starts loading when the pointer or the focus reaches the trigger.
 */
export const globalFilterTriggerProps = {
  onFocus: preloadGlobalFilterMenu,
  onPointerEnter: preloadGlobalFilterMenu,
} as const;

export interface GlobalFilterPopoverProps {
  /** Which edge of the trigger the popover lines up with. */
  align: 'start' | 'end';
  /** Where the menu opens: the filter list (default), the property picker, or one filter's editor. */
  initialScreen?: GlobalFilterMenuScreen;
  /**
   * The trigger: a `PopoverTrigger` around the caller's element (with
   * `globalFilterTriggerProps`). The function form gets the open state.
   */
  children: ReactNode | ((open: boolean) => ReactNode);
}

/**
 * The popover of the dashboard's global filters, for every entry point (a
 * filter chip, the bar's "Add global filter", the toolbar button): the open
 * state, the lazily loaded menu and the one place its size is set.
 */
export function GlobalFilterPopover({ align, initialScreen, children }: GlobalFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      {typeof children === 'function' ? children(open) : children}
      <PopoverContent
        align={align}
        // WP08: the width becomes `DASHBOARD_GEOMETRY.popover.globalFilterWidth` (290), on both clients together.
        className='w-[360px]'
        data-parity-id='dash-global-filter-popover'
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        <LazyGlobalFilterMenu initialScreen={initialScreen} onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

export default GlobalFilterPopover;
