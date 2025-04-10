import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Base input styles that apply to all variants and sizes
const baseInputStyles = cn(
  // Text and placeholder styling
  'text-text-primary placeholder:text-text-tertiary',

  // Selection styling
  'selection:bg-fill-theme-thick selection:text-text-on-fill focus:caret-fill-theme-thick',

  'bg-fill-transparent',

  // Layout
  'flex min-w-0',

  // Typography
  'text-sm',

  // Effects
  'outline-none',

  // File input styling
  'file:inline-flex file:border-0 file:bg-fill-transparent file:text-sm file:font-medium',

  // Disabled state
  'disabled:pointer-events-none disabled:cursor-not-allowed',
);

const inputVariants = cva(
  baseInputStyles,
  {
    variants: {
      variant: {
        // Default variant with focus styles
        default: 'border-border-grey-tertiary border focus-visible:border-border-theme-thick focus-visible:ring-border-theme-thick focus-visible:ring-[0.5px] disabled:border-border-grey-tertiary disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary hover:border-border-grey-tertiary-hover',

        // Destructive variant for error states
        destructive: 'border border-border-error-thick focus-visible:border-border-error-thick focus-visible:ring-border-error-thick focus-visible:ring-[0.5px] focus:caret-text-primary disabled:border-border-grey-tertiary disabled:bg-fill-primary-alpha-5 disabled:text-text-tertiary',

        // Ghost variant without visible borders
        ghost: 'border-fill-transparent focus-visible:border-transparent focus-visible:ring-transparent disabled:border-fill-transparent disabled:bg-fill-transparent disabled:text-text-tertiary',
      },
      size: {
        // Small size input
        sm: 'h-8 px-2 rounded-300',

        // Medium size input (default)
        md: 'h-10 px-2 rounded-400',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'variant'>,
    VariantProps<typeof inputVariants> {
  helpText?: string;
}

function Input ({
  className,
  type,
  variant,
  size,
  helpText,
  ...props
}: InputProps) {
  return (
    <div className={'flex flex-col gap-1'}>
      <input
        type={type}
        data-slot="input"
        className={cn(
          inputVariants({ variant, size }),
          // Invalid state styling (applied via aria-invalid attribute)
          'aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick',
          className,
        )}
        {...props}
      />
      {helpText && <div className={cn('help-text text-xs', variant === 'destructive' && 'text-text-error')}>
        {helpText}
      </div>}

    </div>

  );
}

export { Input };