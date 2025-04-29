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
  style,
  ...props
}, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
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

  // Update the content of the hidden div
  const updateContentMirror = React.useCallback(() => {
    if (!contentRef.current || !innerRef.current) return;

    const textarea = innerRef.current;
    const contentMirror = contentRef.current;

    // Copy styles that affect text layout
    const styles = window.getComputedStyle(textarea);

    contentMirror.style.width = `${textarea.clientWidth - parseInt(styles.paddingLeft) - parseInt(styles.paddingRight)}px`;
    contentMirror.style.fontFamily = styles.fontFamily;
    contentMirror.style.fontSize = styles.fontSize;
    contentMirror.style.lineHeight = styles.lineHeight;
    contentMirror.style.letterSpacing = styles.letterSpacing;
    contentMirror.style.fontWeight = styles.fontWeight;
    contentMirror.style.whiteSpace = 'pre-wrap';
    contentMirror.style.boxSizing = 'content-box';

    // Replace newlines with <br> to mimic textarea behavior
    const content = (currentValue as string).replace(/\n/g, '<br>') || '<br>';

    if (contentMirror.innerHTML !== content) {
      contentMirror.innerHTML = content;
    }
  }, [currentValue]);

  // Calculate line height and padding
  const getTextareaMetrics = React.useCallback(() => {
    if (!innerRef.current) return { lineHeight: 20, paddingTop: 0, paddingBottom: 0 };

    const style = window.getComputedStyle(innerRef.current);

    return {
      lineHeight: parseInt(style.lineHeight) || 20,
      paddingTop: parseInt(style.paddingTop) || 0,
      paddingBottom: parseInt(style.paddingBottom) || 0,
    };
  }, []);

  // Auto-resize logic using content mirror
  const adjustHeight = React.useCallback(() => {
    if (!innerRef.current || !contentRef.current) return;

    const textarea = innerRef.current;
    const contentMirror = contentRef.current;
    const metrics = getTextareaMetrics();

    // Update content mirror first
    updateContentMirror();

    // Get actual content height
    const contentHeight = contentMirror.offsetHeight;

    // Calculate min/max heights based on rows
    const minHeight = minRows * metrics.lineHeight + metrics.paddingTop + metrics.paddingBottom;
    const maxHeight = maxRows * metrics.lineHeight + metrics.paddingTop + metrics.paddingBottom;

    // Calculate new height
    let newHeight;

    if ((currentValue as string).trim() === '') {
      // For empty content, use minimum height
      newHeight = minHeight;
    } else {
      // For non-empty content, use content height plus padding
      newHeight = contentHeight + metrics.paddingTop + metrics.paddingBottom;

      // Apply min/max constraints
      newHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);
    }

    // Set new height
    textarea.style.height = `${newHeight}px`;

    // Enable scrolling if content exceeds max height
    textarea.style.overflowY = contentHeight > (maxHeight - metrics.paddingTop - metrics.paddingBottom) ? 'auto' : 'hidden';
  }, [minRows, maxRows, updateContentMirror, getTextareaMetrics, currentValue]);

  // Handle controlled/uncontrolled input
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;

    // For uncontrolled component
    if (value === undefined) {
      setCurrentValue(newValue);
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

    // Adjust height after value update
    requestAnimationFrame(() => {
      adjustHeight();
    });
  }, [value, currentValue, adjustHeight]);

  // Handle initial render and window resize
  React.useEffect(() => {
    // Initial height adjustment
    adjustHeight();

    // Handle window resize
    const handleResize = () => adjustHeight();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [adjustHeight]);

  // Force adjustment when component mounts to get accurate initial measurements
  React.useEffect(() => {
    // Small delay to ensure rendered
    const timeoutId = setTimeout(() => {
      updateContentMirror();
      adjustHeight();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [updateContentMirror, adjustHeight]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full"
    >
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
        style={{
          ...style,
        }}
        {...props}
      />

      {/* Hidden content mirror for accurate height measurement */}
      <div
        ref={contentRef}
        aria-hidden="true"
        className="absolute top-0 left-0 invisible overflow-hidden pointer-events-none"
        style={{
          height: 'auto',
          minHeight: 0,
          maxHeight: 'none',
        }}
      />
    </div>
  );
});

TextareaAutosize.displayName = 'TextareaAutosize';

export { TextareaAutosize };