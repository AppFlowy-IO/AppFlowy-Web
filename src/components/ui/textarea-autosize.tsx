import * as React from 'react';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Base textarea styles that match the input base styles
const baseTextareaStyles = cn(
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

  // Disabled state
  'disabled:pointer-events-none disabled:cursor-not-allowed',

  // Textarea specific - no resize when auto-sizing
  'resize-none overflow-hidden',
);

const textareaVariants = cva(
  baseTextareaStyles,
  {
    variants: {
      variant: {
        default: 'border-border-primary border focus-visible:border-border-theme-thick focus-visible:ring-border-theme-thick focus-visible:ring-[0.5px] disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary hover:border-border-primary-hover',
        destructive: 'border border-border-error-thick focus-visible:border-border-error-thick focus-visible:ring-border-error-thick focus-visible:ring-[0.5px] focus:caret-text-primary disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary',
        ghost: 'border-none focus-visible:border-transparent focus-visible:ring-transparent disabled:border-fill-transparent disabled:bg-fill-transparent disabled:text-text-tertiary',
      },
      size: {
        sm: 'px-2 rounded-300 min-h-8',
        md: 'px-2 rounded-400 min-h-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface TextareaAutosizeProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size' | 'variant'>,
    VariantProps<typeof textareaVariants> {
  minRows?: number;
  maxRows?: number;
}

const TextareaAutosize = forwardRef<HTMLTextAreaElement, TextareaAutosizeProps>(({
  className,
  variant,
  size,
  minRows = 1,
  maxRows = 8,
  value,
  defaultValue,
  onChange,
  ...props
}, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [currentValue, setCurrentValue] = React.useState(value || defaultValue || '');

  // Get the combined ref
  const setRefs = React.useCallback((element: HTMLTextAreaElement | null) => {
    innerRef.current = element;

    if (typeof ref === 'function') {
      ref(element);
    } else if (ref) {
      ref.current = element;
    }
  }, [ref]);

  // Auto-resize logic
  const adjustHeight = React.useCallback(() => {
    if (!innerRef.current) return;

    const textarea = innerRef.current;

    // Calculate line height based on computed styles
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseInt(style.lineHeight) || 20; // fallback to 20px

    // Calculate padding
    const paddingTop = parseInt(style.paddingTop) || 0;
    const paddingBottom = parseInt(style.paddingBottom) || 0;

    // Calculate min/max heights based on rows
    const minHeight = minRows * lineHeight + paddingTop + paddingBottom;
    const maxHeight = maxRows * lineHeight + paddingTop + paddingBottom;

    // Reset height to auto for proper scrollHeight calculation
    textarea.style.height = 'auto';

    // Set new height within constraints
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);

    textarea.style.height = `${newHeight}px`;

    // Enable scrolling if content exceeds max height
    textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [minRows, maxRows]);

  // Handle controlled/uncontrolled input
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // For uncontrolled component
    if (value === undefined) {
      setCurrentValue(e.target.value);
    }

    // Call the original onChange handler
    onChange?.(e);
  };

  // Update height when value changes
  React.useEffect(() => {
    // Handle controlled component
    if (value !== undefined && value !== currentValue) {
      setCurrentValue(value);
    }

    // Adjust height after render
    requestAnimationFrame(() => {
      adjustHeight();
    });
  }, [value, currentValue, adjustHeight]);

  // Handle initial render and window resize
  React.useEffect(() => {
    adjustHeight();

    const handleResize = () => adjustHeight();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [adjustHeight]);

  return (
    <textarea
      ref={setRefs}
      data-slot="textarea"
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      className={cn(
        textareaVariants({ variant, size }),
        // Invalid state styling
        'aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick',
        className,
      )}
      {...props}
    />
  );
});

TextareaAutosize.displayName = 'TextareaAutosize';

export { TextareaAutosize };