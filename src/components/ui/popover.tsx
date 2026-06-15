import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />;
}

const PopoverTrigger = forwardRef<HTMLButtonElement, React.ComponentProps<typeof PopoverPrimitive.Trigger>>(
  ({ ...props }, ref) => {
    return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} ref={ref} />;
  }
);

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container'];
}) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot='popover-content'
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[240px] rounded-400 bg-surface-layer-03  p-0 shadow-popover',

          'origin-(--radix-popover-content-transform-origin)',

          'data-[state=open]:animate-in',

          'data-[state=open]:fade-in-0',

          'data-[state=open]:zoom-in-95',

          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',

          'focus:outline-none focus-visible:outline-none',

          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot='popover-anchor' {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
