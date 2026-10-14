import { ReactNode, useId } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The menu's 8px padding and 1px border, and a gap: the reason opens clear of the menu. */
const REASON_OFFSET = 14;

/**
 * A menu entry that cannot run right now. It stays focusable so keyboard and screen reader users
 * reach the reason; a disabled Radix item would be skipped and its tooltip never shown. Radix
 * focuses the entry under the pointer, so only keyboard focus fills it: under the pointer it shows a
 * not-allowed cursor and no fill, and does not look clickable.
 */
export function UnavailableMenuItem({
  icon,
  label,
  reason,
  testId,
}: {
  icon: ReactNode;
  label: string;
  reason: string;
  testId?: string;
}) {
  const reasonId = useId();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          data-testid={testId}
          aria-label={label}
          aria-disabled='true'
          aria-describedby={reasonId}
          className='cursor-not-allowed text-text-tertiary hover:bg-transparent focus:bg-transparent focus-visible:bg-fill-content-hover [&_svg]:text-text-tertiary'
          onSelect={(event) => event.preventDefault()}
        >
          {icon}
          <div className='flex-1 text-left'>{label}</div>
          <span id={reasonId} className='sr-only'>
            {reason}
          </span>
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side='right' sideOffset={REASON_OFFSET} className='break-words'>
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
