import { forwardRef, HTMLAttributes } from 'react';
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

function Tabs ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-background-primary text-text-primary text-sm font-semibold inline-flex w-fit gap-3 items-center justify-center whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Base Styles
        'flex min-w-[60px] w-fit relative h-[40px] items-start justify-center',
        'gap-[10px]',
        'border border-transparent',

        // Text Styles
        'text-sm font-medium whitespace-nowrap',
        'text-text-secondary',

        // Active State
        'data-[state=active]:bg-background-primary',
        'data-[state=active]:text-text-primary',

        'data-[state=active]:after:absolute data-[state=active]:after:bottom-[-1px]',
        'data-[state=active]:after:left-0 data-[state=active]:after:right-0',
        'data-[state=active]:after:h-[3px]',
        'data-[state=active]:after:bg-fill-theme-thick',
        'data-[state=active]:after:content-[\'\']',

        // Disabled state
        'disabled:pointer-events-none',
        'disabled:opacity-50',

        'focus:outline-none',

        'transition-[color]',

        // Svg
        '[&_svg]:pointer-events-none',
        '[&_svg]:shrink-0',
        '[&_svg]:text-text-primary',
        '[&_svg:not([class*=\'size-\'])]:size-4',

        className,
      )}
      {...props}
    />
  );
}

const TabLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-300 px-1.5 w-fit py-1.5 hover:bg-fill-content-hover',
        className)}
      {...props}
    />
  );
});

function TabsContent ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabLabel };
