import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

function Switch ({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // Base layout and dimensions
        'inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full',

        // Background color states
        'data-[state=checked]:bg-fill-theme-thick',
        'data-[state=unchecked]:bg-fill-secondary',

        // State-specific hover effects
        'data-[state=unchecked]:hover:bg-fill-secondary-hover', // Unchecked hover state
        'data-[state=checked]:hover:bg-fill-theme-thick-hover', // Checked hover state

        // Border styles
        'border border-transparent',

        // Focus states
        'outline-none',
        'focus-visible:border-border-theme-thick',
        'focus-visible:ring-[3px]',
        'focus-visible:ring-ring/50',

        // Transition effects
        'transition-all',

        // Disabled states
        'disabled:bg-fill-theme-thick-hover',
        'disabled:cursor-not-allowed',
        'disabled:opacity-40',

        // Custom className passed as prop
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Base styles
          'pointer-events-none block h-4 w-4 rounded-full',

          // Ring styles
          'ring-0',

          // Background color
          'bg-background-primary',

          // Transition and positioning
          'transition-transform',
          'data-[state=checked]:translate-x-[calc(100%-3px)]',
          'data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
