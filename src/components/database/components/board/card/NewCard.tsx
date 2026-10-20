import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrimaryFieldId } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

const BOUNDARY_GAP = 100;

function NewCard({
  beforeId,
  fieldId,
  columnId,
  isCreating,
  setIsCreating,
}: {
  beforeId?: string;
  fieldId: string;
  columnId: string;
  isCreating: boolean;
  setIsCreating: (isCreating: boolean) => void;
}) {
  const primaryFieldId = usePrimaryFieldId();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const onNewCard = useNewRowDispatch();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    if (!container) return;

    const scrollElement = container.closest('.appflowy-scroll-container') as HTMLDivElement;
    const rect = container.getBoundingClientRect();

    const scrollY = rect.bottom + BOUNDARY_GAP - window.innerHeight;

    if (scrollY <= 0) return;

    scrollElement.scrollBy({
      top: scrollY,
      behavior: 'smooth',
    });
  }, [container]);

  const handleSubmit = useCallback(
    (inputValue: string) => {
      if (!primaryFieldId) {
        throw new Error('Primary field not found');
      }

      const cellsData = {
        [primaryFieldId]: inputValue,
        [fieldId]: columnId,
      };

      setValue('');
      void onNewCard({
        cellsData,
        beforeRowId: beforeId,
      });
      scrollToBottom();
    },
    [beforeId, columnId, fieldId, onNewCard, primaryFieldId, scrollToBottom]
  );

  useLayoutEffect(() => {
    if (!ref.current) return;

    const el = ref.current.parentElement as HTMLDivElement | null;

    if (!el) return;

    setContainer(el);
  }, []);

  return (
    <Popover open={isCreating} onOpenChange={setIsCreating}>
      <PopoverTrigger asChild>
        <Button ref={ref} size={'sm'} className={'w-full justify-start p-1 text-text-secondary'} variant={'ghost'}>
          {isCreating ? (
            ''
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={'flex w-full items-center gap-1.5'}>
                  <PlusIcon className={'h-5 w-5'} />
                  {t('board.column.createNewCard')}
                </div>
              </TooltipTrigger>
              <TooltipContent>{t('board.column.addToColumnBottomTooltip')}</TooltipContent>
            </Tooltip>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        container={container}
        align='center'
        side='bottom'
        alignOffset={0}
        sideOffset={-28}
        avoidCollisions={false}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            handleSubmit(value);
          }
        }}
      >
        <Input
          ref={(input: HTMLInputElement) => {
            if (!input) return;
            if (!inputRef.current) {
              setTimeout(() => {
                input.setSelectionRange(0, input.value.length);
              }, 100);

              inputRef.current = input;
            }
          }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          className={'!h-9 w-full !rounded-300 text-text-primary'}
        />
      </PopoverContent>
    </Popover>
  );
}

export default NewCard;
