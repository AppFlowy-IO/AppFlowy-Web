import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-border-theme-thick focus-visible:ring-border-theme-thick-hover focus-visible:ring-[0.5px] aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick-hover',
  {
    variants: {
      variant: {
        default:
          'bg-fill-theme-thick text-text-on-fill hover:bg-fill-theme-thick-hover disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary',
        destructive:
          'bg-fill-error-thick text-text-on-fill hover:bg-fill-error-thick-hover focus-visible:ring-border-error-thick disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary',
        outline:
          'border border-border-grey-tertiary bg-transparent text-text-primary hover:bg-fill-primary-alpha-5 hover:border-border-grey-tertiary-hover disabled:text-text-tertiary',
        'destructive-outline':
          'bg-transparent text-text-error hover:bg-fill-error-select hover:text-text-error-hover border border-border-error-thick hover:border-border-error-thick-hover disabled:text-text-tertiary disabled:border-border-grey-tertiary',
        ghost:
          'hover:bg-fill-primary-alpha-5 text-text-primary disabled:bg-fill-transparent disabled:text-text-tertiary',
        link: 'hover:bg-transparent text-text-theme hover:text-text-theme-hover !h-fit',
      },
      size: {
        sm: 'h-7 text-sm px-4 rounded-300 gap-2 font-normal',
        default: 'h-8 text-sm px-4 rounded-300 gap-2 font-normal',
        lg: 'h-10 rounded-400 text-sm px-4 gap-2 font-medium',
        xl: 'h-14 rounded-500 px-4 text-xl gap-2 font-medium',
        icon: 'size-7 p-1 text-icon-primary disabled:text-icon-tertiary',
        'icon-lg': 'size-10 p-[10px] text-icon-primary disabled:text-icon-tertiary',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
  asChild?: boolean
}>(({
  className,
  variant,
  size,
  asChild = false,
  ...props
}, ref) => {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
