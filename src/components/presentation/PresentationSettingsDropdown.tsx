import { useId, useRef, useState } from 'react';

import { ReactComponent as ChevronIcon } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';

export default function PresentationSettingsDropdown({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  ariaLabel = label,
  className = 'ps-field',
  labelClassName,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  labelClassName?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            id={id}
            type='button'
            variant='outline'
            aria-label={ariaLabel}
            disabled={disabled}
            className='h-8 w-full min-w-0 justify-between bg-surface-primary px-2 py-1 text-sm font-normal focus-visible:border-border-theme-thick focus-visible:outline-none data-[state=open]:border-border-theme-thick'
          >
            <span className='min-w-0 truncate'>{options.find((option) => option.value === value)?.label}</span>
            <ChevronIcon className='h-4 w-4 text-icon-primary' aria-hidden='true' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          // Keep keyboard focus inside the presentation dialog's focus trap.
          container={triggerRef.current?.closest('[role="dialog"]') ?? undefined}
          className='z-[1500] max-h-[var(--radix-dropdown-menu-content-available-height)] w-[var(--radix-dropdown-menu-trigger-width)] min-w-0'
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenuRadioGroup value={value} onValueChange={onValueChange} aria-label={ariaLabel}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} className='min-h-8 py-1'>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
