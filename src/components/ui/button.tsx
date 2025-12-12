import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap  disabled:pointer-events-none  [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick-hover aria-readonly:cursor-not-allowed',
  {
    variants: {
      variant: {
        default:
          'bg-fill-theme-thick text-text-on-fill hover:bg-fill-theme-thick-hover disabled:bg-fill-content-hover disabled:text-text-tertiary',
        destructive:
          'bg-fill-error-thick text-text-on-fill hover:bg-fill-error-thick-hover disabled:bg-fill-content-hover disabled:text-text-tertiary',
        outline:
          'border border-border-primary bg-fill-content text-text-primary hover:bg-fill-content-hover hover:border-border-primary-hover disabled:text-text-tertiary',
        'destructive-outline':
          'bg-fill-content text-text-error hover:bg-fill-error-select hover:text-text-error-hover border border-border-error-thick hover:border-border-error-thick-hover disabled:text-text-tertiary disabled:border-border-primary',
        ghost: 'hover:bg-fill-content-hover text-text-primary disabled:bg-fill-content disabled:text-text-tertiary',
        link: 'hover:bg-fill-content text-text-action hover:text-text-action-hover !h-fit',
        loading: 'opacity-50 cursor-not-allowed',
      },
      size: {
        sm: 'text-sm px-3 py-1 rounded-300 gap-2 font-normal',
        default: 'text-sm px-3 py-1.5 rounded-300 gap-2 font-normal',
        lg: 'rounded-400 text-sm px-4 py-[10px] gap-2 font-medium',
        xl: 'rounded-500 px-4 text-xl py-[14px] gap-2 font-medium',
        'icon-sm': 'w-6 h-6 rounded-300 p-0.5 text-icon-primary disabled:text-icon-tertiary',
        icon: 'w-7 h-7 rounded-300 p-1 text-icon-primary disabled:text-icon-tertiary',
        'icon-lg': 'w-8 h-8 rounded-300 p-2 text-icon-primary disabled:text-icon-tertiary',
        'icon-xl': 'w-10 h-10 rounded-400 p-[10px] text-icon-primary disabled:text-icon-tertiary',
      },
      loading: {
        true: 'opacity-70 cursor-not-allowed',
        false: '',
      },
      danger: {
        true: 'hover:text-text-error',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      loading: false,
      danger: false,
    },
  }
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(({ className, variant, size, loading, asChild = false, children, danger, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      ref={ref}
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className, loading, danger }))}
      onClick={(e) => {
        if (loading) {
          e.stopPropagation();
          return;
        }

        if (props.onClick) {
          props.onClick(e);
        }
      }}
      {...props}
    >
      {children}
    </Comp>
  );
});

export { Button, buttonVariants };
