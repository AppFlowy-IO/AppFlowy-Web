import useMediaQuery from '@mui/material/useMediaQuery';
import { forwardRef } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ChevronIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as MindMapIcon } from '@/assets/icons/mind_map.svg';
import { ReactComponent as PresentIcon } from '@/assets/icons/present.svg';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { preloadPresentation } from './presentation-preload';
import PresentationMenuPreview, { type PresentationChoice } from './PresentationMenuPreview';

const choices = [
  { mode: 'document', icon: PresentIcon, title: 'Present document', description: 'Present your page as a slideshow.' },
  {
    mode: 'mindmap',
    icon: MindMapIcon,
    title: 'Present AI mind map',
    description: 'Explore your ideas in an AI mind map.',
  },
  { mode: 'slides', icon: AIIcon, title: 'Generate AI ppt', description: 'Create AI slides to present or export.' },
] as const;

interface PresentationMenuProps {
  onSelect: (mode: PresentationChoice) => void;
  /** Server-disabled AI actions are omitted; document presentation remains available. */
  aiEnabled?: boolean;
  /** Why AI mind maps and slides are unavailable here; those rows stay visible and explain it on hover. */
  aiUnavailableReason?: string;
  onOpenChange?: (open: boolean) => void;
}

/** Uses the same row, text, icon sizing and hover treatment as the page actions menu. */
const PresentationMenu = forwardRef<HTMLButtonElement, PresentationMenuProps>(
  ({ onSelect, aiEnabled = true, aiUnavailableReason, onOpenChange }, ref) => {
    const narrow = useMediaQuery('(max-width: 640px)');
    const visibleChoices = aiEnabled ? choices : choices.filter((choice) => choice.mode === 'document');

    return (
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          // Choosing an item takes long enough to fetch the dialog chunk.
          if (open) preloadPresentation();
          onOpenChange?.(open);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button ref={ref} variant='outline' size='sm' data-testid='present-button' aria-label='Present'>
            <PresentIcon className='h-4 w-4' aria-hidden='true' />
            <span className='hidden sm:inline'>Present</span>
            <ChevronIcon className='h-4 w-4' aria-hidden='true' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' aria-label='Present menu' className='font-normal'>
          {visibleChoices.map((choice, index) => {
            // Not Radix `disabled`: that removes pointer events, and the row must still explain itself on hover.
            const unavailable = choice.mode !== 'document' ? aiUnavailableReason : undefined;

            return (
              <Tooltip key={choice.mode} delayDuration={300}>
                <TooltipTrigger
                  asChild
                  onBlur={(event) => {
                    // The menu focuses its container when the pointer leaves a row.
                    // Let the tooltip's hover boundary handle this move to the preview.
                    if (
                      event.relatedTarget instanceof HTMLElement &&
                      event.relatedTarget.getAttribute('role') === 'menu'
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <DropdownMenuItem
                    aria-disabled={unavailable ? true : undefined}
                    data-testid={`present-menu-${choice.mode}`}
                    className={cn(
                      unavailable &&
                        'cursor-not-allowed text-text-tertiary focus:bg-transparent focus:text-text-tertiary [&_svg]:text-text-tertiary'
                    )}
                    onSelect={(event) => {
                      if (unavailable) event.preventDefault();
                      else onSelect(choice.mode);
                    }}
                  >
                    <choice.icon aria-hidden='true' />
                    {choice.title}
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent
                  aria-label={unavailable ? `${choice.description} ${unavailable}` : choice.description}
                  side={narrow ? 'bottom' : 'left'}
                  align={narrow ? 'end' : 'center'}
                  sideOffset={narrow ? (visibleChoices.length - index - 1) * 32 + 20 : 12}
                  collisionPadding={12}
                  className='w-[312px] max-w-[calc(100vw-24px)] gap-2.5 whitespace-normal break-normal p-3'
                >
                  <PresentationMenuPreview mode={choice.mode} />
                  <p className='m-0 text-sm font-normal leading-5'>{choice.description}</p>
                  {unavailable && (
                    <p className='m-0 flex items-start gap-1.5 text-sm font-medium leading-5' role='note'>
                      <LockIcon className='mt-0.5 h-4 w-4 shrink-0' aria-hidden='true' />
                      {unavailable}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
);

PresentationMenu.displayName = 'PresentationMenu';
export default PresentationMenu;
