import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconColors, renderColor } from '@/utils/color';

function IconItem({
  icon,
  onSelect,
  enableColor = true,
  container,
}: {
  icon: {
    id: string;
    name: string;
    content: string;
    cleanSvg: string;
  };
  onSelect: (icon: { value: string; color: string; content: string }) => void;
  enableColor?: boolean;
  container?: HTMLDivElement;
}) {
  const trigger = useMemo(() => {
    return (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            variant={'ghost'}
            className='h-8 w-8 min-w-[32px] items-center p-[7px]'
            onClick={() => {
              if (!enableColor) {
                onSelect({
                  value: icon.id,
                  color: '',
                  content: icon.content,
                });
              }
            }}
          >
            <div className={'h-5 w-5 text-text-primary'} dangerouslySetInnerHTML={{ __html: icon.cleanSvg }} />
          </Button>
        </TooltipTrigger>
        <TooltipContent container={container} side={'bottom'}>
          {icon.name.replaceAll('-', ' ')}
        </TooltipContent>
      </Tooltip>
    );
  }, [enableColor, icon, onSelect, container]);

  if (!enableColor) {
    return trigger;
  }

  return (
    <Popover modal>
      <PopoverTrigger>
        <div>{trigger}</div>
      </PopoverTrigger>

      <PopoverContent className={'p-2'} container={container}>
        <div className={'grid grid-cols-6 gap-1'}>
          {IconColors.map((color) => (
            <Button
              key={color}
              variant={'ghost'}
              className={'h-9 w-9 min-w-[36px] px-0 py-0'}
              onClick={() => {
                onSelect({
                  value: icon.id,
                  color,
                  content: icon.content,
                });
              }}
            >
              <div style={{ backgroundColor: renderColor(color) }} className={'h-full w-full rounded-[8px]'} />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default IconItem;
