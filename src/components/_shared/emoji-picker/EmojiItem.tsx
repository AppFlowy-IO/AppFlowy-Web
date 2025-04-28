import { Emoji } from '@/components/_shared/emoji-picker/EmojiPicker.hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import React from 'react';

function EmojiItem ({
  emoji,
  onClick,
  isFlag,
}: {
  isFlag: boolean;
  emoji: Emoji;
  onClick: () => void;
}) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          variant={'ghost'}
          className={cn('h-8 w-8 text-xl min-w-[32px] items-center p-0', isFlag ? 'icon' : '')}
          onClick={onClick}
        >
          {emoji.native}

        </Button>

      </TooltipTrigger>
      <TooltipContent side={'bottom'}>
        {emoji.name}
      </TooltipContent>
    </Tooltip>
  );
}

export default EmojiItem;