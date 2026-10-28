import Tooltip from '@mui/material/Tooltip';
import { useEffect, useRef, useState } from 'react';

import { ReactComponent as ChevronIcon } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function SlideCountDropdown({
  value,
  maxCount,
  disabled,
  onValueChange,
}: {
  value?: number;
  maxCount?: number;
  disabled: boolean;
  onValueChange: (value: number) => void;
}) {
  const slideCounts = Array.from({ length: Math.max(0, Math.floor(maxCount ?? 0)) }, (_, index) => index + 1);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || value === undefined) return;
    // Wait for the portaled menu to be positioned before revealing its selected row.
    const frame = requestAnimationFrame(() => {
      selectedRef.current?.focus();
      selectedRef.current?.scrollIntoView({ block: 'nearest' });
    });

    return () => cancelAnimationFrame(frame);
  }, [open, value]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!disabled || !next) setOpen(next);
      }}
      modal={false}
    >
      <Tooltip title={disabled ? 'Load workspace limits to choose a custom count' : ''} placement='top' describeChild>
        <span className='ps-ppt-custom-count' tabIndex={disabled ? 0 : undefined}>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              type='button'
              variant='outline'
              disabled={disabled}
              aria-label='Custom'
              aria-pressed={value !== undefined}
              className='focus-visible:border-border-theme-thick focus-visible:outline-none aria-pressed:border-border-theme-thick aria-pressed:bg-fill-theme-select aria-pressed:text-text-action data-[state=open]:border-border-theme-thick'
            >
              {value === undefined ? 'Custom' : `Custom · ${value}`}
              <ChevronIcon aria-hidden='true' />
            </Button>
          </DropdownMenuTrigger>
        </span>
      </Tooltip>
      <DropdownMenuContent
        align='start'
        container={triggerRef.current?.closest('[role="dialog"]') ?? undefined}
        className='z-[1500] max-h-[min(256px,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] min-w-0'
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuRadioGroup
          aria-label='Custom slide count'
          value={value === undefined ? '' : String(value)}
          onValueChange={(next) => onValueChange(Number(next))}
        >
          {slideCounts.map((count) => (
            <DropdownMenuRadioItem
              key={count}
              ref={count === value ? selectedRef : undefined}
              value={String(count)}
              className='min-h-8 py-1'
            >
              {count}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
