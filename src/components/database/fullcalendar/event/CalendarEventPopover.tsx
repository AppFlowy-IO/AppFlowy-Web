import { ComponentProps } from 'react';

import { PopoverContent } from '@/components/ui/popover';

/**
 * A multi-day anchor can leave neither horizontal side enough room for the editor.
 * Prefer top/bottom placement so collision shifting can keep it inside the viewport.
 */
export function CalendarEventPopover(props: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      collisionPadding={20}
      sticky='always'
      side='bottom'
      align='center'
      sideOffset={8}
      style={{
        width: 'min(360px, calc(100vw - 40px))',
        minWidth: 0,
        maxHeight: 'var(--radix-popover-content-available-height)',
        overflowY: 'auto',
      }}
      {...props}
    />
  );
}
