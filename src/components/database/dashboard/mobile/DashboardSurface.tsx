import { Slot } from '@radix-ui/react-slot';
import { ComponentProps, ReactElement, ReactNode, useCallback } from 'react';

import { MobileSheet, MobileSheetProps } from '@/components/_shared/mobile-drawer/MobileSheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** What the desktop popover's content gets (its size, alignment, test and parity ids). */
export type DashboardSurfacePopoverProps = Omit<ComponentProps<typeof PopoverContent>, 'children'> & {
  [dataAttribute: `data-${string}`]: string | undefined;
};

/** What the phone sheet gets (its title, kind, height and back chevron). */
export type DashboardSurfaceSheetProps = Omit<MobileSheetProps, 'open' | 'onOpenChange' | 'children'>;

export interface DashboardSurfaceProps {
  /** A mobile context (WP14 §1.4): a bottom sheet instead of the popover. */
  mobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The element that opens the surface: a `PopoverTrigger` on desktop; on a
   * phone a tap opens the sheet. One element that forwards its ref and props.
   */
  trigger: ReactElement;
  /**
   * Desktop only: wraps the popover trigger (a tooltip trigger around it, so
   * the popover's ref still reaches the element).
   */
  wrapTrigger?: (trigger: ReactElement) => ReactElement;
  popover?: DashboardSurfacePopoverProps;
  sheet: DashboardSurfaceSheetProps;
  children: ReactNode;
}

/**
 * A dashboard surface that is a popover on desktop and a bottom sheet on a
 * phone (WP14 §1.4.2): the global filter menus and the widget filter panel.
 * The content is the same; only its container changes. The popover keeps its
 * modal behaviour (an outside press closes it); the sheet is a Radix dialog,
 * so the popovers its content opens (value editors, date pickers) still nest.
 */
export function DashboardSurface({
  mobile,
  open,
  onOpenChange,
  trigger,
  wrapTrigger,
  popover,
  sheet,
  children,
}: DashboardSurfaceProps) {
  const openSheet = useCallback(() => onOpenChange(true), [onOpenChange]);

  if (mobile) {
    return (
      <>
        <Slot aria-haspopup='dialog' data-state={open ? 'open' : 'closed'} onClick={openSheet}>
          {trigger}
        </Slot>
        <MobileSheet {...sheet} onOpenChange={onOpenChange} open={open}>
          {children}
        </MobileSheet>
      </>
    );
  }

  const popoverTrigger = <PopoverTrigger asChild>{trigger}</PopoverTrigger>;

  return (
    <Popover modal onOpenChange={onOpenChange} open={open}>
      {wrapTrigger ? wrapTrigger(popoverTrigger) : popoverTrigger}
      <PopoverContent {...popover}>{children}</PopoverContent>
    </Popover>
  );
}

export default DashboardSurface;
