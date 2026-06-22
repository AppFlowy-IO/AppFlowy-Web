import { cva } from 'class-variance-authority';
import { Users } from 'lucide-react';
import * as React from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as PersonIcon } from '@/assets/icons/person.svg';
import { PersonAvatar } from '@/components/app/share/PersonAvatar';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface EmailTag {
  id: string;
  email: string;
  avatar: string;
  name?: string; // Optional name field - if provided, display name instead of email
  new?: boolean; // Optional new field - if provided, display new tag
  isGuest?: boolean; // Optional guest field - if provided, display guest tag
  kind?: 'user' | 'group';
  groupId?: string;
  memberCount?: number;
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

  // Disabled state
  'disabled:pointer-events-none disabled:cursor-not-allowed'
);

const tagInputVariants = cva('flex items-center gap-1', {
  variants: {
    variant: {
      // Default variant with focus styles
      default:
        'border-border-primary border data-[focused=true]:border-border-theme-thick data-[focused=true]:ring-border-theme-thick data-[focused=true]:ring-[0.5px] disabled:border-border-primary disabled:bg-fill-primary-hover disabled:text-text-tertiary hover:border-border-primary-hover',
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

// Email tag component
interface EmailTagComponentProps {
  tag: EmailTag;
  onRemove: (id: string) => void;
  getTooltipText?: (tag: EmailTag) => string;
}

const EmailTagComponent = ({ tag, onRemove, getTooltipText }: EmailTagComponentProps) => {
  // Display name if available (from mentionable list), otherwise display email (manual input)
  const displayText = tag.name || tag.email;
  const avatarName = tag.name || tag.email;

  // Create tooltip text: "Invite John Doe (john@example.com) as a guest" or "Invite john@example.com as a guest"
  const tooltipText = getTooltipText?.(tag) ?? `Invite ${tag.email} as a guest`;

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <div
          style={{
            color: tag.isGuest ? 'var(--border-warning-thick)' : 'var(--text-primary)',
            backgroundColor: tag.isGuest ? 'var(--fill-warning-light)' : 'var(--surface-container-layer-02)',
          }}
          className={cn(
            'flex h-[22px] min-w-[80px] max-w-[200px] flex-shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded-[6px] px-1 py-[1px]'
          )}
        >
          {tag.kind === 'group' ? (
            <Users className='h-4 w-4 shrink-0 text-icon-secondary' />
          ) : tag.avatar ? (
            <PersonAvatar size={16} avatarUrl={tag.avatar} name={avatarName} />
          ) : (
            <PersonIcon className='h-5 w-5' />
          )}
          <span className={'flex-1 truncate text-sm text-text-primary'}>{displayText}</span>
          <button
            type='button'
            tabIndex={-1}
            className='flex h-[14px] w-[14px] items-start justify-center rounded-full p-0.5 focus:outline-none '
            onClick={() => onRemove(tag.id)}
          >
            <CloseIcon className='h-[10px] w-[10px] text-icon-secondary' />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export interface InviteInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'variant' | 'value' | 'onChange'> {
  loading?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  emailTags?: EmailTag[];
  onEmailTagsChange?: (tags: EmailTag[]) => void;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  multiple?: boolean;
  afterExtra?: React.ReactNode;
  getTagTooltip?: (tag: EmailTag) => string;
}

const InviteInput = forwardRef<HTMLDivElement, InviteInputProps>(
  (
    {
      className,
      loading = false,
      inputRef,
      inputValue = '',
      onInputChange,
      emailTags = [],
      onEmailTagsChange,
      afterExtra,
      getTagTooltip,
      readOnly,
      ...props
    },
    ref
  ) => {
    const [focused, setFocused] = useState(false);
    const [internalInputValue, setInternalInputValue] = useState(inputValue);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputElementRef = useRef<HTMLInputElement>(null);

    // Handle the forwarded ref
    const resolvedInputRef = (inputRef as React.RefObject<HTMLInputElement>) || inputElementRef;

    useEffect(() => {
      setInternalInputValue(inputValue);
    }, [inputValue]);

    // Auto-scroll to end when tags change to keep input visible
    useEffect(() => {
      if (containerRef.current) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollLeft = containerRef.current.scrollWidth;
          }
        });
      }
    }, [emailTags.length]); // Trigger when number of tags changes

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      setInternalInputValue(value);
      onInputChange?.(value);
    };

    const handleRemoveTag = (id: string) => {
      if (onEmailTagsChange) {
        const newTags = emailTags.filter((tag) => tag.id !== id);

        onEmailTagsChange(newTags);

        // After removing tag, scroll to end to keep input visible
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollLeft = containerRef.current.scrollWidth;
          }
        }, 0);
      }
    };

    const focusInput = () => {
      resolvedInputRef.current?.focus();
    };

    return (
      <div className={cn('relative w-full overflow-hidden p-[1px]', className)}>
        <div
          ref={ref}
          data-slot='email-tag-input'
          className={cn(tagInputVariants({ variant: 'default', size: 'sm' }))}
          data-focused={focused}
          onClick={focusInput}
        >
          <div
            ref={containerRef}
            className={
              'flex h-full w-full items-center overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            }
          >
            <div className={'flex h-full min-w-full flex-nowrap items-center gap-1'}>
              {/* Render email tags */}
              {emailTags.map((tag) => (
                <EmailTagComponent key={tag.id} tag={tag} onRemove={handleRemoveTag} getTooltipText={getTagTooltip} />
              ))}

              {/* Input field */}
              <input
                ref={resolvedInputRef}
                type='text'
                className={cn('min-w-[80px] flex-1 flex-shrink', baseInputStyles, readOnly && 'cursor-default')}
                onFocus={(e) => {
                  if (readOnly) return;
                  setFocused(true);
                  props?.onFocus?.(e);
                }}
                onBlur={(e) => {
                  setFocused(false);
                  props?.onBlur?.(e);
                }}
                value={internalInputValue}
                onChange={handleInputChange}
                readOnly={readOnly}
                autoCapitalize='off'
                autoComplete='off'
                spellCheck='false'
                autoCorrect='off'
                {...props}
              />

              {/* Right side buttons container - inline flow */}
              <div className='flex flex-shrink-0 items-center gap-1'>
                {/* Loading icon */}
                {loading && (
                  <div className='flex h-4 w-4 items-center justify-center'>
                    <Progress variant={'primary'} />
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* After extra content inside border */}
          {afterExtra && <div className='flex-shrink-0'>{afterExtra}</div>}
        </div>
      </div>
    );
  }
);

InviteInput.displayName = 'InviteInput';

export { InviteInput };
