import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSortsSelector } from '@/application/database-yjs';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import {
  useHoverControlsActions,
  useHoverControlsDisplay,
} from '@/components/database/components/grid/controls/HoverControls.hooks';
import { HoverControlsProvider } from '@/components/database/components/grid/controls/HoverControlsContext';
import RowMenu from '@/components/database/components/grid/controls/RowMenu';
import { ItemState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import ClearSortingConfirm from '@/components/database/components/sorts/ClearSortingConfirm';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { isMac } from '@/utils/hotkeys';

export function HoverControls({
  rowId,
  rowKey,
  groupFieldId,
  groupId,
  dragHandleRef,
  canDrag = true,
}: {
  rowId: string;
  rowKey: string;
  groupFieldId?: string;
  groupId?: string;
  canDrag?: boolean;
  dragHandleRef?: (node: HTMLDivElement | null) => void;
  state: ItemState;
}) {
  const { ref } = useHoverControlsDisplay(rowKey);

  const { onAddRowBelow, onAddRowAbove, addAboveLoading, addBelowLoading } = useHoverControlsActions(
    rowId,
    groupFieldId,
    groupId
  );
  const { t } = useTranslation();

  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [openPrevented, setOpenPrevented] = useState<boolean>(false);
  const sorts = useSortsSelector();
  const hasSorted = sorts.length > 0;
  const continueRef = useRef<(() => void) | null>(null);

  const showPreventDialog = useCallback(
    (continueFn: () => void) => {
      if (hasSorted) {
        setOpenPrevented(true);
        continueRef.current = continueFn;
      } else {
        continueFn();
      }
    },
    [hasSorted]
  );

  return (
    <HoverControlsProvider
      value={{
        showPreventDialog,
      }}
    >
      <div
        ref={ref}
        style={{
          minHeight: 34,
        }}
        className={
          'relative left-0 flex w-full items-start justify-end border border-transparent py-1.5 focus-within:!pointer-events-auto focus-within:!opacity-100'
        }
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
              {addBelowLoading || addAboveLoading ? <Progress variant={'primary'} /> : <AddIcon className={'h-5 w-5'} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('tooltip.addNewRow')}
            <TooltipShortcut>{`${isMac() ? t('blockActions.addAboveMacCmd') : t('blockActions.addAboveCmd')} ${t(
              'blockActions.addAboveTooltip'
            )}`}</TooltipShortcut>
          </TooltipContent>
        </Tooltip>
        <div ref={dragHandleRef} className='flex shrink-0'>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={canDrag ? `${t('tooltip.dragRow')}. ${t('tooltip.openMenu')}` : t('tooltip.openMenu')}
                    className='text-icon-secondary focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
                    data-testid='row-accessory-button'
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <DragIcon aria-hidden='true' className='h-5 w-5' />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {canDrag ? (
                  <>
                    {t('tooltip.dragRow')}
                    <TooltipShortcut>{t('tooltip.openMenu')}</TooltipShortcut>
                  </>
                ) : (
                  t('tooltip.openMenu')
                )}
              </TooltipContent>
            </Tooltip>
            <RowMenu
              groupFieldId={groupFieldId}
              groupId={groupId}
              onClose={() => {
                setMenuOpen(false);
              }}
              rowId={rowId}
            />
          </DropdownMenu>
        </div>
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
