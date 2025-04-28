import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React from 'react';
import { useTranslation } from 'react-i18next';

const skinTones = [
  {
    value: 0,
    icon: '👋',
  },
  {
    value: 1,
    icon: '👋🏻',
  },
  {
    value: 2,
    icon: '👋🏼',
  },
  {
    value: 3,
    icon: '👋🏽',
  },
  {
    value: 4,
    icon: '👋🏾',
  },
  {
    value: 5,
    icon: '👋🏿',
  },
];

function SwitchSkin ({ skin, onSkinSelect }: {
  skin: number;
  onSkinSelect: (skin: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();

  return (
    <Popover
      modal
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={'outline'}
                size={'icon-lg'}
                data-testid={'random-emoji'}
              >
                <span className={'text-xl'}>{skinTones[skin].icon}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('emoji.selectSkinTone')}
            </TooltipContent>
          </Tooltip>
        </div>

      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-center gap-2 p-2">
          {skinTones.map((item) => (
            <Button
              key={item.value}
              variant={'ghost'}
              size={'icon'}
              onClick={() => {
                onSkinSelect(item.value);
                setOpen(false);
              }}
            >
              {item.icon}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>

  );
}

export default SwitchSkin;