import { ReactElement, ReactNode, useCallback, useState } from 'react';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TooltipTrigger } from '@/components/ui/tooltip';

import { DashboardSurface } from '../mobile/DashboardSurface';

import { LazyGlobalFilterMenu, preloadGlobalFilterMenu } from './LazyGlobalFilterMenu';

import type { GlobalFilterMenuEntry } from './GlobalFilterMenu';

/**
 * Spread on the element that opens a `GlobalFilterPopover`: the menu's code
 * starts loading when the pointer or the focus reaches the trigger.
 */
export const globalFilterTriggerProps = {
  onFocus: preloadGlobalFilterMenu,
  onPointerEnter: preloadGlobalFilterMenu,
} as const;

/**
 * A desktop trigger's tooltip: its trigger goes around the popover's, which
 * forwards the ref, so both reach the element.
 */
export function wrapInTooltipTrigger(trigger: ReactElement) {
  return <TooltipTrigger asChild>{trigger}</TooltipTrigger>;
}

const POPOVER_STYLE = {
  width: DASHBOARD_GEOMETRY.popover.globalFilterWidth,
  borderRadius: DASHBOARD_GEOMETRY.popover.radius,
} as const;

const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation();
const keepFocus = (event: Event) => event.preventDefault();

export interface GlobalFilterPopoverProps {
  /** Which edge of the trigger the popover lines up with. */
  align: 'start' | 'end';
  /** Where the menu was opened: the toolbar button, the bar's `+ Filter`, or a pill. */
  entry: GlobalFilterMenuEntry;
  /** The pill's filter. */
  filterId?: string;
  /** Controlled open state (a pill opens itself on a pending-editor request). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * A mobile context (WP14 §1.4.2): a bottom sheet titled `sheetTitle` instead
   * of the popover ("global-filter-pill" for a pill, else "global-filter").
   */
  mobile?: boolean;
  /** The sheet's title: "Filter", or the pill's label. */
  sheetTitle: ReactNode;
  /**
   * The element that opens the menu (with `globalFilterTriggerProps`); the
   * surface makes it the popover trigger. The function form gets the open
   * state.
   */
  trigger: ReactElement | ((open: boolean) => ReactElement);
  /** Desktop only: wraps the popover trigger (the tooltip's trigger). */
  wrapTrigger?: (trigger: ReactElement) => ReactElement;
}

/**
 * The dashboard's global filter menu, for every entry point (a pill, the
 * bar's `+ Filter`, the toolbar button): the open state, the lazily loaded
 * menu, and its container. On desktop a popover, the one place its size is set
 * (290 wide, radius 10; `geometry.popover` in `tokens.json`); on a phone a
 * bottom sheet (`DashboardSurface`) whose header carries the back chevron of
 * the menu's pushed screens.
 *
 * The desktop popover is a backdrop popover: it behaves as a modal one (an
 * outside press closes it and reaches nothing under it) without restyling the
 * whole page on open and close (W11).
 */
export function GlobalFilterPopover({
  align,
  entry,
  filterId,
  open: controlledOpen,
  onOpenChange,
  mobile = false,
  sheetTitle,
  trigger,
  wrapTrigger,
}: GlobalFilterPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // The back action of the screen the sheet shows (the menu reports it).
  const [sheetBack, setSheetBack] = useState<{ onBack: () => void } | null>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const handleSheetBackChange = useCallback(
    (onBack: (() => void) | null) => setSheetBack(onBack ? { onBack } : null),
    []
  );

  const triggerElement = typeof trigger === 'function' ? trigger(open) : trigger;
  const menu = (
    <LazyGlobalFilterMenu
      entry={entry}
      filterId={filterId}
      onClose={close}
      onSheetBackChange={mobile ? handleSheetBackChange : undefined}
      variant={mobile ? 'sheet' : 'popover'}
    />
  );

  if (mobile) {
    return (
      <DashboardSurface
        mobile
        onOpenChange={setOpen}
        open={open}
        sheet={{
          sheet: entry === 'pill' ? 'global-filter-pill' : 'global-filter',
          title: sheetTitle,
          onBack: sheetBack?.onBack,
        }}
        trigger={triggerElement}
      >
        {menu}
      </DashboardSurface>
    );
  }

  const popoverTrigger = <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>;

  return (
    <Popover modal='backdrop' onOpenChange={setOpen} open={open}>
      {wrapTrigger ? wrapTrigger(popoverTrigger) : popoverTrigger}
      <PopoverContent
        align={align}
        className='!rounded-[10px] bg-surface-primary p-1 shadow-menu'
        data-parity-id='dash-global-filter-popover'
        data-testid='dashboard-global-filter-popover'
        onClick={stopPropagation}
        onCloseAutoFocus={keepFocus}
        sideOffset={4}
        style={POPOVER_STYLE}
      >
        {menu}
      </PopoverContent>
    </Popover>
  );
}

export default GlobalFilterPopover;
