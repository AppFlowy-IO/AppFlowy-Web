import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSelectFieldOptions } from '@/application/database-yjs';
import { useAddSelectOption } from '@/application/database-yjs/dispatch';
import { getColorByOption } from '@/application/database-yjs/fields/select-option/utils';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';


function AddGroupColumn({ fieldId }: { fieldId: string; groupId: string }) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [value, setValue] = useState('');

  const options = useSelectFieldOptions(fieldId);
  const addOption = useAddSelectOption(fieldId);

  const [focused, setFocused] = useState(false);

  return (
    <>
      <div ref={setContainer} className={'relative mt-2 flex h-[26px] w-[240px] items-center'}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                setIsCreating(true);
                setValue('');
              }}
              variant={'ghost'}
              size={'icon-sm'}
              className={'text-icon-secondary'}
            >
              <AddIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={'right'}>{t('board.column.createNewColumn')}</TooltipContent>
        </Tooltip>
        <Popover open={isCreating} onOpenChange={setIsCreating}>
          <PopoverTrigger asChild>
            <div className={'absolute left-0 top-0'} />
          </PopoverTrigger>

          <PopoverContent
            container={container}
            align='start'
            side='bottom'
            alignOffset={0}
            sideOffset={0}
            avoidCollisions={false}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                addOption({
                  id: value,
                  name: value,
                  color: getColorByOption(options),
                });
                setIsCreating(false);
                setValue('');
              }
            }}
          >
            <div
              className={cn(
                'flex w-full items-center gap-2 rounded-300 border border-border-primary px-2',
                focused && 'ring-1 ring-border-theme-thick'
              )}
            >
              <Input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
                className={'flex-1 px-0'}
                variant='ghost'
                onFocus={() => {
                  setFocused(true);
                }}
                onBlur={() => {
                  setFocused(false);
                }}
              />
              <Button
                onClick={() => {
                  addOption({
                    id: value,
                    name: value,
                    color: getColorByOption(options),
                  });
                }}
                size={'sm'}
                className={'h-[22px] rounded-200 px-2 text-xs'}
              >
                {t('button.done')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

export default AddGroupColumn;
