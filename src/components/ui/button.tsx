import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=\'size-\'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-border-theme-thick focus-visible:ring-border-theme-thick-hover focus-visible:ring-[3px] aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick-hover',
  {
    variants: {
      variant: {
        default:
          'bg-fill-theme-thick text-text-on-fill hover:bg-fill-theme-thick-hover disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary',
        destructive:
          'bg-fill-error-thick text-text-on-fill hover:bg-fill-error-thick-hover focus-visible:ring-border-error-thick disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary',
        outline:
          'border border-border-grey-tertiary bg-background-primary text-text-primary hover:bg-fill-primary-alpha-5 hover:border-border-grey-tertiary-hover disabled:text-text-tertiary',
        'destructive-outline':
          'bg-background-primary text-text-error hover:bg-fill-error-select hover:text-text-error-hover border border-border-error-thick hover:border-border-error-thick-hover disabled:text-text-tertiary disabled:border-border-grey-tertiary',
        ghost:
          'hover:bg-fill-primary-alpha-5 text-text-primary disabled:bg-fill-transparent disabled:text-text-tertiary',
      },
      size: {
        sm: 'h-[28px] py-1 px-4 rounded-[8px] gap-2',
        default: 'h-8 px-4 rounded-[8px] py-1.5 gap-2',
        lg: 'h-10 rounded-[10px] px-4 py-[10px] gap-2',
        xl: 'h-[54px] rounded-[16px] px-4 py-[14px] gap-2',
        icon: 'size-[28px] p-1 text-icon-primary disabled:text-icon-tertiary',
        'icon-lg': 'size-10 p-[10px] text-icon-primary disabled:text-icon-tertiary',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button ({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
