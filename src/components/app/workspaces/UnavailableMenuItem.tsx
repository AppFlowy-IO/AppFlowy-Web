import { ReactNode, useId, useRef, useState } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The menu's 8px padding and 1px border, and a gap: the reason opens clear of the menu. */
const REASON_OFFSET = 14;
/** Radix focuses the entry right after the pointer moves onto it. */
const POINTER_FOCUS_WINDOW_MS = 100;

/**
 * A menu entry that cannot run right now. It stays focusable so keyboard and screen reader users
 * reach the reason; a disabled Radix item would be skipped and its tooltip never shown. Under the
 * pointer it has a not-allowed cursor and no fill, so it does not look clickable; keyboard focus
 * keeps the usual fill. Radix focuses the entry under the pointer, and browsers count that as
 * keyboard-style focus (`:focus-visible`), so the entry notes whether the pointer just moved there.
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
  const pointerMovedAt = useRef(-Infinity);
  const [pointerFocus, setPointerFocus] = useState(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          data-testid={testId}
          aria-label={label}
          aria-disabled='true'
          aria-describedby={reasonId}
          data-pointer-focus={pointerFocus ? '' : undefined}
          className='cursor-not-allowed text-text-tertiary hover:bg-transparent data-[pointer-focus]:focus:bg-transparent [&_svg]:text-text-tertiary'
          onPointerMove={() => {
            pointerMovedAt.current = performance.now();
          }}
          onFocus={() => setPointerFocus(performance.now() - pointerMovedAt.current < POINTER_FOCUS_WINDOW_MS)}
          onBlur={() => setPointerFocus(false)}
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
