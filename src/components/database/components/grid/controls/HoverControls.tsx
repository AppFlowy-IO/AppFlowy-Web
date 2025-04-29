import { useSortsSelector } from '@/application/database-yjs';
import {
  useHoverControlsActions,
  useHoverControlsDisplay,
} from '@/components/database/components/grid/controls/HoverControls.hooks';
import { HoverControlsProvider } from '@/components/database/components/grid/controls/HoverControlsContext';
import RowMenu from '@/components/database/components/grid/controls/RowMenu';
import { ItemState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import ClearSortingConfirm from '@/components/database/components/sorts/ClearSortingConfirm';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isMac } from '@/utils/hotkeys';
import React, { useCallback, useRef, useState } from 'react';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { useTranslation } from 'react-i18next';

export function HoverControls ({ rowId, dragHandleRef }: {
  rowId: string;
  dragHandleRef?: (node: HTMLDivElement | null) => void;
  state: ItemState
}) {
  const { ref } = useHoverControlsDisplay(rowId);

  const {
    onAddRowBelow,
    onAddRowAbove,
    addAboveLoading,
    addBelowLoading,
  } = useHoverControlsActions(rowId);
  const { t } = useTranslation();

  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [openPrevented, setOpenPrevented] = useState<boolean>(false);
  const sorts = useSortsSelector();
  const hasSorted = sorts.length > 0;
  const continueRef = useRef<(() => void) | null>(null);

  const showPreventDialog = useCallback((continueFn: () => void) => {
    if (hasSorted) {
      setOpenPrevented(true);
      continueRef.current = continueFn;
    } else {
      continueFn();
    }
  }, [hasSorted]);

  return (
    <HoverControlsProvider
      value={{
        showPreventDialog,
      }}
    >
      <div
        ref={ref}
        style={{
          minHeight: 36,
        }}
        className={'flex relative border w-full py-1 border-transparent items-start left-0 justify-end'}
      >
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              loading={addBelowLoading || addAboveLoading}
              tabIndex={-1}
              variant={'ghost'}
              size={'icon-sm'}
              className={'text-icon-secondary'}
              onClick={async (e) => {
                e.stopPropagation();
                const altKey = e.altKey;

                showPreventDialog(() => {
                  if (altKey) {
                    void onAddRowAbove();
                  } else {
                    void onAddRowBelow();
                  }
                });

              }}
            >
              {(addBelowLoading || addAboveLoading) ? <Progress variant={'primary'} /> :
                <AddIcon className={'w-4 h-4'} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('tooltip.addNewRow')}
            <TooltipShortcut>{`${isMac() ? t('blockActions.addAboveMacCmd') : t('blockActions.addAboveCmd')} ${t('blockActions.addAboveTooltip')}`}</TooltipShortcut>
          </TooltipContent>
        </Tooltip>
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <div
              ref={dragHandleRef}
              onClick={() => {
                setMenuOpen(true);
              }}
              className={cn(buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
                className: 'text-icon-secondary cursor-pointer',
              }))}
            >
              <DragIcon className={'w-4 h-4 '} />
            </div>

          </TooltipTrigger>
          <TooltipContent>
            {t('tooltip.dragRow')}
            <TooltipShortcut>{t('tooltip.openMenu')}</TooltipShortcut>
          </TooltipContent>
        </Tooltip>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              tabIndex={-1}
              className={'absolute right-0 opacity-0 z-[-1]'}
            />
          </DropdownMenuTrigger>
          <RowMenu
            onClose={() => {
              setMenuOpen(false);
            }}
            rowId={rowId}
          />
        </DropdownMenu>
      </div>
      <ClearSortingConfirm
        open={openPrevented}
        onClose={() => {
          setOpenPrevented(false);
        }}
        onRemoved={() => {
          continueRef.current?.();
          continueRef.current = null;
        }}
      />
    </HoverControlsProvider>
  );
}

export default HoverControls;