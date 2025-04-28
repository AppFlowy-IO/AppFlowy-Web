import { forwardRef } from 'react';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';

// Base input styles that apply to all variants and sizes
const baseInputStyles = cn(
  // Text and placeholder styling
  'text-text-primary placeholder:text-text-tertiary',

  // Selection styling
  'selection:bg-fill-theme-thick selection:text-text-on-fill focus:caret-fill-theme-thick',

  'bg-fill-content',

  // Layout
  'flex min-w-0',

  // Typography
  'text-sm',

  // Effects
  'outline-none',

  // File input styling
  'file:inline-flex file:border-0 file:bg-fill-content file:text-sm file:font-medium',

  // Disabled state
  'disabled:pointer-events-none disabled:cursor-not-allowed',
);

const inputVariants = cva(
  'flex items-center gap-1',
  {
    variants: {
      variant: {
        // Default variant with focus styles
        default: 'border-border-primary border data-[focused=true]:border-border-theme-thick data-[focused=true]:ring-border-theme-thick data-[focused=true]:ring-[0.5px] disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary hover:border-border-primary-hover',
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
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
}

const SearchInput = forwardRef<HTMLInputElement, InputProps>(({
  className,
  type,
  variant,
  size,
  inputProps,
  inputRef,
  ...props
}, ref) => {
  const [focused, setFocused] = React.useState(false);

  return (
    <div
      ref={ref}
      data-slot="input"
      className={cn(
        inputVariants({ variant, size }),
        className,
      )}
      data-focused={focused}
    >
      <SearchIcon className={'h-5 w-5'} />
      <input
        ref={inputRef}
        type={type}
        className={cn(
          'flex-1',
          baseInputStyles,
          // Invalid state styling (applied via aria-invalid attribute)
          'aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick',
          inputProps?.className,
        )}
        {...props}
        {...inputProps}
        onFocus={(e) => {
          setFocused(true);
          props?.onFocus?.(e);
        }}

        onBlur={(e) => {
          setFocused(false);
          props?.onBlur?.(e);
        }}
      />
    </div>

  );
});

export { SearchInput };