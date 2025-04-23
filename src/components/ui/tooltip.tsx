import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

function TooltipProvider ({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider
    data-slot="tooltip-provider"
    delayDuration={delayDuration} {...props} />;
}

function Tooltip ({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
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
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Animation behavior
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',

          // Slide-in effects based on tooltip position
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',

          // Styling and layout
          'shadow-tooltip max-w-[360px] z-50 origin-[--radix-tooltip-content-transform-origin]',
          'w-fit rounded-400 bg-surface-secondary px-3 py-2 text-sm text-text-on-fill',
          'flex flex-col',

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

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipShortcut };
