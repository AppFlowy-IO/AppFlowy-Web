import { SelectOptionColor } from '@/application/database-yjs';
import { AFScroller } from '@/components/_shared/scroller';
import { forwardRef, useState, useRef, useEffect, KeyboardEvent } from 'react';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';

const tagColorClasses = {
  [SelectOptionColor.Purple]: `bg-tint-purple`,
  [SelectOptionColor.Pink]: `bg-tint-pink`,
  [SelectOptionColor.LightPink]: `bg-tint-red`,
  [SelectOptionColor.Orange]: `bg-tint-orange`,
  [SelectOptionColor.Yellow]: `bg-tint-yellow`,
  [SelectOptionColor.Lime]: `bg-tint-lime`,
  [SelectOptionColor.Green]: `bg-tint-green`,
  [SelectOptionColor.Aqua]: `bg-tint-aqua`,
  [SelectOptionColor.Blue]: `bg-tint-blue`,
};

export interface Tag {
  id: string;
  text: string;
  color?: SelectOptionColor;
}

// Base input styles that apply to all variants and sizes
const baseInputStyles = cn(
  // Text and placeholder styling
  'text-text-primary placeholder:text-text-tertiary',

  // Selection styling
  'selection:bg-fill-theme-thick selection:text-text-on-fill focus:caret-fill-theme-thick',

  'bg-fill-content',

  // Layout
  'flex min-w-[100px]',

  // Typography
  'text-sm',

  // Effects
  'outline-none',

  // File input styling
  'file:inline-flex file:border-0 file:bg-fill-content file:text-sm file:font-medium',

  // Disabled state
  'disabled:pointer-events-none disabled:cursor-not-allowed',
);

const tagInputVariants = cva(
  'flex items-center gap-1 overflow-x-auto scrollbar-hide',
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

// Tag component styles
const tagStyles = cva(
  'flex items-center h-5 py-[1px] max-w-[120px] rounded-[6px] px-1 text-text-primary text-sm gap-1 whitespace-nowrap',
  {
    variants: {
      color: tagColorClasses,
    },
    defaultVariants: {
      color: SelectOptionColor.Purple,
    },
  },
);

// Tag component
interface TagComponentProps {
  tag: Tag;
  onRemove: (id: string) => void;
}

const TagComponent = ({ tag, onRemove }: TagComponentProps) => {
  return (
    <div className={cn(tagStyles({ color: tag.color || SelectOptionColor.Blue }))}>
      <span className={'truncate flex-1'}>{tag.text}</span>
      <button
        type="button"
        tabIndex={-1}
        className="p-0.5 w-[14px] flex items-start justify-center h-[14px] focus:outline-none rounded-full hover:bg-fill-content-hover focus:ring-1 focus:ring-offset-1"
        onClick={() => onRemove(tag.id)}
      >
        <CloseIcon className="w-[10px] h-[10px]" />
      </button>
    </div>
  );
};

export interface TagInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'variant' | 'value' | 'onChange'>,
    VariantProps<typeof tagInputVariants> {
  multiple?: boolean;
  tags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  onInputChange?: (value: string) => void;
  inputValue?: string;
}

const TagsInput = forwardRef<HTMLDivElement, TagInputProps>(({
  className,
  variant,
  size,
  multiple = false,
  tags,
  onTagsChange,
  inputProps,
  inputRef,
  onInputChange,
  inputValue = '',
  onKeyDown: onKeyDownProp,
  ...props
}, ref) => {
  const [focused, setFocused] = useState(false);
  const [internalInputValue, setInternalInputValue] = useState(inputValue);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputElementRef = useRef<HTMLInputElement>(null);

  // Handle the forwarded ref
  const resolvedInputRef = (inputRef as React.RefObject<HTMLInputElement>) || inputElementRef;

  useEffect(() => {
    setInternalInputValue(inputValue);
  }, [inputValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    setInternalInputValue(value);
    onInputChange?.(value);
  };

  const handleRemoveTag = (id: string) => {
    const newTags = tags.filter(tag => tag.id !== id);

    onTagsChange(newTags);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Handle a backspace key when input is empty to remove the last tag
    if (e.key === 'Backspace' && internalInputValue === '' && tags.length > 0) {
      const newTags = [...tags];

      newTags.pop();
      onTagsChange(newTags);
    }

    // Handle Enter key to add a new tag
    if (e.key === 'Enter' && internalInputValue.trim() !== '') {
      e.preventDefault();

      // For single tag mode, replace the existing tag
      if (!multiple) {
        onTagsChange([{
          id: Date.now().toString(),
          text: internalInputValue.trim(),
        }]);
      } else {
        // For multiple tags, add to the existing ones
        onTagsChange([
          ...tags,
          {
            id: Date.now().toString(),
            text: internalInputValue.trim(),
          },
        ]);
      }

      setInternalInputValue('');
      onInputChange?.('');
    }
  };

  const focusInput = () => {
    resolvedInputRef.current?.focus();
  };

  return (
    <div
      ref={ref}
      data-slot="tag-input"
      className={cn(
        tagInputVariants({ variant, size }),
        'flex-wrap', // Allow content to wrap
        className,
      )}
      data-focused={focused}
      onClick={focusInput}
      onKeyDown={(e) => {
        onKeyDownProp?.(e);
      }}
    >
      <AFScroller
        overflowYHidden
        ref={containerRef}
        className="flex items-center gap-1 flex-grow whitespace-nowrap"
      >
        {/* Render tags */}
        {tags.map(tag => (
          <TagComponent
            key={tag.id}
            tag={tag}
            onRemove={handleRemoveTag}
          />
        ))}

        {/* Input field */}
        <input
          onScroll={e => {
            console.log('Scroll event:', e);
          }}
          ref={resolvedInputRef}
          type="text"
          className={cn(
            'flex-1 min-w-[100px]',
            baseInputStyles,
            // Invalid state styling (applied via aria-invalid attribute)
            'aria-invalid:ring-border-error-thick aria-invalid:border-border-error-thick',
            inputProps?.className,
          )}

          onFocus={(e) => {
            setFocused(true);
            props?.onFocus?.(e);
          }}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            setFocused(false);
            props?.onBlur?.(e);
          }}
          {...props}
          {...inputProps}

          value={internalInputValue}
          onChange={handleInputChange}
        />
      </AFScroller>
    </div>
  );
});

export { TagsInput };