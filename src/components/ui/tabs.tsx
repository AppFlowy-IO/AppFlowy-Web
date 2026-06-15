import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { forwardRef, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot='tabs' className={cn('flex flex-col gap-2', className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot='tabs-list'
      className={cn(
        'inline-flex w-fit items-center justify-center gap-1 whitespace-nowrap text-sm font-semibold text-text-primary',
        className
      )}
      {...props}
    />
  );
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot='tabs-trigger'
      className={cn(
        // Base Styles
        'relative flex h-[34px] w-fit min-w-[60px] items-start justify-center',
        'gap-[10px]',
        'border border-transparent',

        // Text Styles
        'whitespace-nowrap text-sm font-medium',
        'text-text-tertiary',

        // Active State
        'data-[state=active]:text-text-primary',

        'data-[state=active]:after:absolute data-[state=active]:after:bottom-[-1px]',
        'data-[state=active]:after:left-0 data-[state=active]:after:right-0',
        'data-[state=active]:after:h-[3px]',
        'data-[state=active]:after:bg-fill-theme-thick',
        "data-[state=active]:after:content-['']",

        // Disabled state
        'disabled:pointer-events-none',
        'disabled:opacity-50',

        'focus:outline-none',

        'transition-[color]',

        // Svg
        '[&_svg]:pointer-events-none',
        '[&_svg]:shrink-0',
        '[&_svg]:text-text-primary',
        "[&_svg:not([class*='size-'])]:size-4",

        className
      )}
      {...props}
    />
  );
});

const TabLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
  return (
    <div ref={ref} className={cn('w-fit rounded-300 px-1.5 py-1 hover:bg-fill-content-hover', className)} {...props} />
  );
});

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot='tabs-content' className={cn('flex-1 outline-none', className)} {...props} />;
}

export { TabLabel, Tabs, TabsContent, TabsList, TabsTrigger };
