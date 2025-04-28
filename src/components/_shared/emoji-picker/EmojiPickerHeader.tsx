import SwitchSkin from '@/components/_shared/emoji-picker/SwitchSkin';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { TooltipContent, TooltipTrigger, Tooltip } from '@/components/ui/tooltip';
import React, { useEffect, useRef } from 'react';

import { randomEmoji } from '@/utils/emoji';
import { ReactComponent as ShuffleIcon } from '@/assets/icons/shuffle.svg';
import { useTranslation } from 'react-i18next';

interface Props {
  onEmojiSelect: (emoji: string) => void;
  skin: number;
  onSkinSelect: (skin: number) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

function EmojiPickerHeader ({ onEmojiSelect, onSkinSelect, searchValue, onSearchChange, skin }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, []);

  return (
    <div className={''}>
      <div className={'search-input flex items-end justify-between gap-2'}>
        <SearchInput
          value={searchValue}
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
          inputRef={inputRef}
          autoFocus={true}
          className={'search-emoji-input w-full'}
          placeholder={t('search.label')}
        />

        <div className={'flex items-center gap-1'}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={'outline'}
                size={'icon-lg'}
                data-testid={'random-emoji'}
                onClick={async () => {
                  const emoji = await randomEmoji();

                  onEmojiSelect(emoji);
                }}
              >
                <ShuffleIcon className={'h-5 w-5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('emoji.random')}
            </TooltipContent>

          </Tooltip>
          <SwitchSkin
            skin={skin}
            onSkinSelect={onSkinSelect}
          />

        </div>
      </div>
    </div>
  );
}

export default EmojiPickerHeader;
