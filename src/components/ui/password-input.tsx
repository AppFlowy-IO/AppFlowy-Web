import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { forwardRef } from 'react';

import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  'disabled:pointer-events-none disabled:cursor-not-allowed'
);

const inputVariants = cva('flex items-center gap-1', {
  variants: {
    variant: {
      // Default variant with focus styles
      default:
        'border-border-primary border data-[focused=true]:border-border-theme-thick data-[focused=true]:ring-border-theme-thick data-[focused=true]:ring-[0.5px] disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary hover:border-border-primary-hover',
      // Destructive variant for error states
      destructive:
        'border border-border-error-thick focus-visible:border-border-error-thick focus-visible:ring-border-error-thick focus-visible:ring-[0.5px] focus:caret-text-primary disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary',
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
});

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'variant' | 'type'>,
    VariantProps<typeof inputVariants> {
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
}

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, variant, size, inputProps, inputRef, disabled, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const [showPassword, setShowPassword] = React.useState(false);
    const isDisabled = Boolean(disabled || inputProps?.disabled);

    const togglePasswordVisibility = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setShowPassword(!showPassword);
    };

    return (
      <div
        ref={ref}
        data-slot='input'
        className={cn(inputVariants({ variant, size }), className)}
        data-focused={focused}
        aria-disabled={isDisabled || undefined}
      >
        <input
          ref={inputRef}
          type={showPassword ? 'text' : 'password'}
          className={cn(
            'flex-1',
            baseInputStyles,
            // Invalid state styling (applied via aria-invalid attribute)
            'aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick',
            inputProps?.className
          )}
          {...props}
          {...inputProps}
          disabled={isDisabled}
          onFocus={(e) => {
            setFocused(true);
            props?.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props?.onBlur?.(e);
          }}
        />
        <Button
          type='button'
          size='icon-sm'
          onMouseDown={togglePasswordVisibility}
          tabIndex={-1}
          variant='ghost'
          disabled={isDisabled}
          aria-label={showPassword ? 'hide password' : 'show password'}
        >
          {showPassword ? <HideIcon className='h-5 w-5' /> : <ShowIcon className='h-5 w-5' />}
        </Button>
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export { PasswordInput, inputVariants, baseInputStyles };
