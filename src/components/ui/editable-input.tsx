import * as React from 'react';
import { forwardRef, useRef, useEffect, useCallback, useState } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Base styles that match Input component
const baseEditableStyles = cn(
  // Text and placeholder styling
  'text-text-primary cursor-text',

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
);

const editableVariants = cva(
  baseEditableStyles,
  {
    variants: {
      variant: {
        // Default variant with focus styles
        default: 'border-border-primary border focus-visible:border-border-theme-thick focus-visible:ring-border-theme-thick focus-visible:ring-[0.5px] disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary hover:border-border-primary-hover',

        // Destructive variant for error states
        destructive: 'border border-border-error-thick focus-visible:border-border-error-thick focus-visible:ring-border-error-thick focus-visible:ring-[0.5px] focus:caret-text-primary disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary',

        // Ghost variant without visible borders
        ghost: 'border-none focus-visible:border-transparent focus-visible:ring-transparent disabled:border-fill-transparent disabled:bg-fill-transparent disabled:text-text-tertiary',
      },
      size: {
        // Size variants to match Input component
        sm: 'p-0 rounded-none w-full min-h-5',
        md: 'p-0 rounded-none w-full min-h-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface EditableProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'size' | 'variant' | 'onChange' | 'defaultValue' | 'autoFocus'>,
    VariantProps<typeof editableVariants> {
  // Value control
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;

  // Auto-sizing configuration
  minHeight?: number;  // Minimum height in pixels
  maxHeight?: number;  // Maximum height in pixels
  wrapText?: boolean;  // Allow text wrapping within single line (no line breaks)

  // Input-like properties
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean; // Add invalid state for form validation
  autoFocus?: boolean; // Add autoFocus functionality

  // Position cursor at end on focus
  focusAtEnd?: boolean;

  // Callback for Enter key press
  onEnterPress?: (e: React.KeyboardEvent) => void;
}

const EditableInput = forwardRef<HTMLDivElement, EditableProps>(({
  className,
  variant,
  size,
  value,
  defaultValue,
  onChange,
  minHeight = 20, // Default minimum height matches input
  maxHeight,
  wrapText = false, // Default to nowrap text behavior like a standard input
  placeholder,
  disabled = false,
  readOnly = false,
  invalid = false,
  autoFocus = false,
  focusAtEnd = true,
  onEnterPress,
  onKeyDown,
  onInput,
  onPaste,
  onBlur,
  onFocus,
  style,
  ...props
}, ref) => {
  // Internal reference to the editable div
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Internal state for uncontrolled mode
  const [content, setContent] = useState(defaultValue || '');

  // Track placeholder visibility
  const [showPlaceholder, setShowPlaceholder] = useState(!defaultValue && !value);

  // Forward ref to both internal and external refs
  const setRefs = useCallback((element: HTMLDivElement | null) => {
    innerRef.current = element;

    if (typeof ref === 'function') {
      ref(element);
    } else if (ref) {
      ref.current = element;
    }
  }, [ref]);

  // Set cursor to end of content
  const setCursorToEnd = useCallback(() => {
    const div = innerRef.current;

    if (!div || !focusAtEnd) return;

    // Create a range at the end of content
    const range = document.createRange();
    const selection = window.getSelection();

    if (div.childNodes.length > 0) {
      const lastNode = div.childNodes[div.childNodes.length - 1];

      range.setStart(lastNode, lastNode.textContent?.length || 0);
      range.collapse(true);

      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      // If no content, set cursor at the beginning
      range.setStart(div, 0);
      range.collapse(true);

      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [focusAtEnd]);

  // Adjust height based on content
  const adjustHeight = useCallback(() => {
    const div = innerRef.current;

    if (!div) return;

    // Reset height for accurate scrollHeight calculation
    div.style.height = 'auto';

    // Get content height
    const contentHeight = div.scrollHeight;

    // Apply height constraints
    let newHeight = contentHeight;

    // Enforce minimum height
    if (minHeight !== undefined && contentHeight < minHeight) {
      newHeight = minHeight;
    }

    // Enforce maximum height and add scrolling if needed
    if (maxHeight !== undefined && contentHeight > maxHeight) {
      newHeight = maxHeight;
      div.style.overflowY = 'auto';
    } else {
      div.style.overflowY = 'hidden';
    }

    // Apply the calculated height
    div.style.height = `${newHeight}px`;
  }, [minHeight, maxHeight]);

  // Handle content changes
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const div = e.currentTarget;
    const newContent = div.innerText || '';

    // Always remove line breaks regardless of wrapText setting
    // wrapText only affects visual wrapping, not actual line breaks
    if (newContent.includes('\n')) {
      // Prevent default to avoid line breaks
      e.preventDefault();

      // Clean content by replacing line breaks with spaces
      const cleanContent = newContent.replace(/[\r\n]+/g, ' ');

      // Update div content
      div.innerText = cleanContent;

      // Move cursor to the end of content
      setCursorToEnd();

      // Update internal state for uncontrolled mode
      if (value === undefined) {
        setContent(cleanContent);
      }

      // Trigger onChange callback
      onChange?.(cleanContent);
    } else {
      // Update internal state for uncontrolled mode
      if (value === undefined) {
        setContent(newContent);
      }

      // Trigger onChange callback
      onChange?.(newContent);
    }

    // Update placeholder visibility
    setShowPlaceholder(!newContent);

    // Adjust height to match content
    adjustHeight();

    // Call original onInput handler
    onInput?.(e);
  };

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle Enter key press - always prevent new lines
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnterPress?.(e);
    }

    // Call original onKeyDown handler
    onKeyDown?.(e);
  };

  // Handle paste events
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Prevent default paste behavior
    e.preventDefault();

    // Get plain text and clean line breaks
    const text = e.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');

    // Insert cleaned text
    document.execCommand('insertText', false, text);

    // Call original onPaste handler
    onPaste?.(e);
  };

  // Handle blur event
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // When content is empty, show placeholder
    setShowPlaceholder(!innerRef.current?.innerText);

    // Call original onBlur handler
    onBlur?.(e);
  };

  // Handle focus event
  const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    // Place cursor at the end if focusAtEnd is true
    if (focusAtEnd) {
      setCursorToEnd();
    }

    // Call original onFocus handler
    onFocus?.(e);
  };

  // Handle autoFocus
  useEffect(() => {
    if (autoFocus && innerRef.current && !disabled && !readOnly) {
      // Set focus after a small delay to ensure the component is fully mounted
      const focusTimer = setTimeout(() => {
        innerRef.current?.focus();
        setCursorToEnd();
      }, 0);

      return () => clearTimeout(focusTimer);
    }
  }, [autoFocus, disabled, readOnly, setCursorToEnd]);

  // Sync controlled component value
  useEffect(() => {
    // Only update when value is defined and differs from current content
    if (value !== undefined && innerRef.current) {
      const currentContent = innerRef.current.innerText;

      if (value !== currentContent) {
        innerRef.current.innerText = value;
        setShowPlaceholder(!value);
        adjustHeight();
      }
    }
  }, [value, adjustHeight]);

  // Initialize and handle window resizing
  useEffect(() => {
    // Initialize content and height
    if (innerRef.current) {
      // Set initial content
      const initialContent = value !== undefined ? value : content;

      if (initialContent && innerRef.current.innerText !== initialContent) {
        innerRef.current.innerText = initialContent;
      }

      // Adjust initial height
      adjustHeight();
    }

    // Listen for window resize events
    const handleResize = () => adjustHeight();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [adjustHeight, content, value]);

  return (
    <div className="relative w-full inline-flex">
      {/* Editable input area */}
      <div
        ref={setRefs}
        contentEditable={!disabled && !readOnly}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onFocus={handleFocus}
        className={cn(
          editableVariants({ variant, size }),
          // State-based styling
          disabled && 'opacity-60 cursor-not-allowed',
          readOnly && 'cursor-default',
          // Invalid state styling
          invalid && 'ring-border-error-thick border-border-error-thick',
          // Text wrapping vs nowrap styling - both are still single-line
          wrapText ? 'break-words overflow-hidden' : 'whitespace-nowrap overflow-x-auto',
          // Center text vertically for input-like appearance
          'inline-flex items-center',
          // External class
          className,
        )}
        role="textbox"
        aria-multiline="false"
        aria-disabled={disabled}
        aria-readonly={readOnly}
        aria-invalid={invalid}
        style={{
          ...style,
          minHeight: minHeight ? `${minHeight}px` : undefined,
          maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        }}
        {...props}
      />

      {/* Custom placeholder */}
      {placeholder && showPlaceholder && (
        <div
          className={cn(
            'absolute top-0 left-0 pointer-events-none h-full text-sm flex items-center',
            'text-text-tertiary',
          )}
          aria-hidden="true"
        >
          {placeholder}
        </div>
      )}
    </div>
  );
});

EditableInput.displayName = 'EditableInput';

export { EditableInput };