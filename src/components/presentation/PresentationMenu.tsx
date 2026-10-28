import useMediaQuery from '@mui/material/useMediaQuery';
import { forwardRef } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ChevronIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as MindMapIcon } from '@/assets/icons/mind_map.svg';
import { ReactComponent as PresentIcon } from '@/assets/icons/present.svg';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

/** Uses the same row, text, icon sizing and hover treatment as the page actions menu. */
const PresentationMenu = forwardRef<HTMLButtonElement, { onSelect: (mode: PresentationChoice) => void }>(
  ({ onSelect }, ref) => {
    const narrow = useMediaQuery('(max-width: 640px)');

    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={ref} variant='outline' size='sm' data-testid='present-button' aria-label='Present'>
            <PresentIcon className='h-4 w-4' aria-hidden='true' />
            <span className='hidden sm:inline'>Present</span>
            <ChevronIcon className='h-4 w-4' aria-hidden='true' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' aria-label='Present menu' className='font-normal'>
          {choices.map((choice, index) => (
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
                <DropdownMenuItem onSelect={() => onSelect(choice.mode)}>
                  <choice.icon aria-hidden='true' />
                  {choice.title}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent
                aria-label={choice.description}
                side={narrow ? 'bottom' : 'left'}
                align={narrow ? 'end' : 'center'}
                sideOffset={narrow ? (choices.length - index - 1) * 32 + 20 : 12}
                collisionPadding={12}
                className='w-[312px] max-w-[calc(100vw-24px)] gap-2.5 whitespace-normal break-normal p-3'
              >
                <PresentationMenuPreview mode={choice.mode} />
                <p className='m-0 text-sm font-normal leading-5'>{choice.description}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
);

PresentationMenu.displayName = 'PresentationMenu';
export default PresentationMenu;
