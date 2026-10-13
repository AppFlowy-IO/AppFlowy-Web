import { ReactNode, useId } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A menu entry that cannot run right now. It stays focusable so keyboard and screen reader users
 * reach the reason; a disabled Radix item would be skipped and its tooltip never shown.
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
          className='cursor-default text-text-tertiary hover:bg-transparent [&_svg]:text-text-tertiary'
          onSelect={(event) => event.preventDefault()}
        >
          {icon}
          <div className='flex-1 text-left'>{label}</div>
          <span id={reasonId} className='sr-only'>
            {reason}
          </span>
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side='right' className='break-words'>
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
