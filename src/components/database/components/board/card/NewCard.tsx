import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrimaryFieldId, useRowOrdersSelector } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

const BOUNDARY_GAP = 100;
const NEW_CARD_HEIGHT = 44;
const NEW_CARD_CONTROL_HEIGHT = 36;

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
  const rows = useRowOrdersSelector();
  const primaryFieldId = usePrimaryFieldId();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const onNewCard = useNewRowDispatch();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    if (!containerRef.current) return;

    const scrollElement = containerRef.current.closest('.appflowy-scroll-container') as HTMLDivElement;
    const rect = containerRef.current.getBoundingClientRect();

    const scrollY = rect.bottom + BOUNDARY_GAP - window.innerHeight;

    if (scrollY <= 0) return;
    if (!scrollElement) return;

    scrollElement.scrollBy({
      top: scrollY,
      behavior: 'smooth',
    });
  }, []);

  const handleSubmit = useCallback(
    (inputValue: string) => {
      if (!rows) {
        throw new Error('Rows not found');
      }

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
    [beforeId, columnId, fieldId, onNewCard, primaryFieldId, rows, scrollToBottom]
  );

  useLayoutEffect(() => {
    if (!isCreating || !inputRef.current) return;

    inputRef.current.focus();
    inputRef.current.setSelectionRange(0, inputRef.current.value.length);
  }, [isCreating]);

  const handleClose = useCallback(() => {
    setIsCreating(false);
  }, [setIsCreating]);

  return (
    <div
      ref={containerRef}
      className={'flex w-full items-center'}
      style={{
        height: NEW_CARD_HEIGHT,
      }}
    >
      {isCreating ? (
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={handleClose}
          onKeyDown={(e) => {
            if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
              e.preventDefault();
              e.stopPropagation();
              handleSubmit(value);
              return;
            }

            if (createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) {
              e.preventDefault();
              e.stopPropagation();
              handleClose();
            }
          }}
          className={'w-full !rounded-[6px] !bg-transparent px-3 text-text-primary shadow-none'}
          style={{
            height: NEW_CARD_CONTROL_HEIGHT,
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={'sm'}
              className={'w-full justify-start p-1 text-text-secondary'}
              style={{
                height: NEW_CARD_CONTROL_HEIGHT,
              }}
              variant={'ghost'}
              onClick={() => setIsCreating(true)}
            >
              <div className={'flex w-full items-center gap-1.5'}>
                <PlusIcon className={'h-5 w-5'} />
                {t('board.column.createNewCard')}
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('board.column.addToColumnBottomTooltip')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default NewCard;
