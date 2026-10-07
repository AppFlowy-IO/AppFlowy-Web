import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '@/lib/utils';

function TooltipProvider ({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider
    data-slot="tooltip-provider"
    delayDuration={delayDuration} {...props} />;
}

/** True under a `TooltipGroupProvider`: its tooltips share that provider. */
const TooltipGroupContext = React.createContext(false);

/**
 * One tooltip provider for a whole view (a grid or a board) instead of one per
 * tooltip: a view mounts a tooltip or two per row and per card (W8). The
 * delays stay the same: tooltips open after 0 ms, and a tooltip with its own
 * `delayDuration` keeps its own provider, so another tooltip of the view never
 * shortens its delay.
 */
function TooltipGroupProvider ({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <TooltipGroupContext.Provider value={true}>{children}</TooltipGroupContext.Provider>
    </TooltipProvider>
  );
}

function Tooltip ({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const grouped = React.useContext(TooltipGroupContext);

  if (grouped && props.delayDuration === undefined) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  }

  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger ({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent ({
  className,
  sideOffset = 0,
  children,
  container,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  container?: Element;
}) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Enter animation only
          'animate-in fade-in-0 zoom-in-95',

          // Slide-in effects based on tooltip position
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',

          // Styling and layout
          'shadow-tooltip max-w-[360px] z-50 origin-[--radix-tooltip-content-transform-origin]',
          'w-fit rounded-400 bg-surface-inverse px-3 py-2 text-sm text-text-on-fill',
          'flex flex-col whitespace-pre-wrap break-all',

          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

function TooltipShortcut ({ className, ...props }: React.ComponentProps<'span'>) {
  return <span
    data-slot="tooltip-shortcut"
    className={cn('text-text-secondary', className)} {...props} />;
}

/**
 * `onFocus` of a `TooltipTrigger` whose tooltip is hover-only: Radix skips its
 * open-on-focus when the focus event is prevented, so the focus a closing
 * popover hands back to the trigger opens no tooltip over the popover's
 * neighbours. Pair it with `disableHoverableContent` on the `Tooltip`.
 */
function preventTooltipOnFocus (event: React.FocusEvent) {
  event.preventDefault();
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipGroupProvider,
  TooltipShortcut,
  preventTooltipOnFocus,
};
