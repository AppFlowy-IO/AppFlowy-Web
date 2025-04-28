import { usePrimaryFieldId, useRowOrdersSelector } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const BOUNDARY_GAP = 100;

function NewCard ({ beforeId, fieldId, columnId, isCreating, setIsCreating }: {
  beforeId?: string;
  fieldId: string;
  columnId: string
  isCreating: boolean;
  setIsCreating: (isCreating: boolean) => void;
}) {
  const rows = useRowOrdersSelector();
  const primaryFieldId = usePrimaryFieldId();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const onNewCard = useNewRowDispatch();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);

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

  const handleSumit = useCallback((inputValue: string) => {
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

    const index = beforeId ? (rows.findIndex(row => row.id === beforeId) + 1) : undefined;

    setValue('');
    void onNewCard(index, cellsData);
    scrollToBottom();
  }, [beforeId, columnId, fieldId, onNewCard, primaryFieldId, rows, scrollToBottom]);

  React.useLayoutEffect(() => {
    if (!ref.current) return;

    const el = ref.current.parentElement as HTMLDivElement | null;

    if (!el) return;

    setContainer(el);

  }, [container, ref]);

  return (
    <Popover
      open={isCreating}
      onOpenChange={setIsCreating}
    >
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          size={'sm'}
          className={'w-full p-1 justify-start text-text-secondary'}
          variant={'ghost'}
        >
          {isCreating ? '' : <>
            <PlusIcon className={'w-4 h-4'} />
            {t('board.column.createNewCard')}
          </>}

        </Button>
      </PopoverTrigger>

      <PopoverContent
        container={container}
        align="center"
        side="bottom"
        alignOffset={0}
        sideOffset={-28}
        avoidCollisions={false}
        onCloseAutoFocus={e => e.preventDefault()}
        onKeyDown={e => {
          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            handleSumit(value);
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
          onChange={e => {
            setValue(e.target.value);
          }}
          className={'w-full !h-9 !rounded-300'}
        />
      </PopoverContent>
    </Popover>
  );
}

export default NewCard;