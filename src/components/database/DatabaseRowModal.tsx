import { Check, PanelRight, PanelRightClose, Square } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContextOptional, useReadOnly } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch';
import { UIVariant } from '@/application/types';
import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { useDatabaseRestoreNotice } from '@/components/app/DatabaseRestoreNotice';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import { useRowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import {
  createRowPeekNavigation,
  hasRowPeekOverlay,
  RowPeekNavigationContext,
} from '@/components/database/row-peek/RowPeekNavigation';
import { RowPeekRowNavigation } from '@/components/database/row-peek/RowPeekRowNavigation';
import { RowPeekMode, RowPeekSurface } from '@/components/database/row-peek/RowPeekSurface';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function DatabaseRowModal({
  open,
  onOpenChange,
  rowId,
  openPage,
  onRegisterPrepare,
}: {
  open: boolean;
  rowId: string;
  onOpenChange: (open: boolean) => void;
  openPage?: (rowId: string) => void | Promise<void>;
  onRegisterPrepare?: (prepare: (() => Promise<boolean>) | null) => void;
}) {
  const context = useDatabaseContextOptional();
  const layout = useRowPeekLayout();
  const openPageModalViewId = context?.openPageModalViewId;
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const deleteRows = useTrashAwareDeleteRowsDispatch();
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [mode, setMode] = useState<RowPeekMode>('side');
  const side = mode === 'side' && layout?.canShow === true && !openPageModalViewId;
  const contentRef = useRef<HTMLDivElement>(null);
  const [navigation] = useState(createRowPeekNavigation);
  const prepare = useCallback(() => navigation.prepare(contentRef.current), [navigation]);
  const currentRow = useRef<string | null>(rowId);

  useLayoutEffect(() => {
    currentRow.current = rowId;
    return () => {
      currentRow.current = null;
    };
  }, [rowId]);
  useLayoutEffect(() => {
    onRegisterPrepare?.(prepare);
    return () => onRegisterPrepare?.(null);
  }, [onRegisterPrepare, prepare]);

  const closeImmediately = useCallback(() => onOpenChange(false), [onOpenChange]);
  const close = useCallback(() => {
    const closingRow = rowId;

    void prepare().then((saved) => {
      if (saved && currentRow.current === closingRow) closeImmediately();
    });
  }, [closeImmediately, prepare, rowId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Portaled editors live outside the center dialog's React event tree.
      // Handle Escape in either shell, while allowing visible overlays to own it.
      if (hasRowPeekOverlay(contentRef.current)) return;
      event.preventDefault();
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  const openFullPage = async () => {
    if (!openPage || !(await prepare()) || currentRow.current !== rowId) return;
    try {
      await openPage(rowId);
      if (currentRow.current === rowId) closeImmediately();
    } catch {
      toast.error(t('chat.openPagePreviewFailedToast'));
    }
  };

  const canOpenNewTab = Boolean(
    context?.workspaceId && context?.databasePageId && context.variant !== UIVariant.Publish
  );
  const openNewTab = () => {
    if (!canOpenNewTab || !context) return;
    // Reserve the tab in the click event; browsers block window.open after an
    // asynchronous editor commit. A rejected draft closes only this blank tab.
    const tab = window.open('about:blank', '_blank');

    if (!tab) return;
    tab.opener = null;
    const url = new URL(`/app/${context.workspaceId}/${context.databasePageId}`, window.location.origin);

    url.searchParams.set('v', context.activeViewId);
    url.searchParams.set('r', rowId);
    void prepare().then((saved) => {
      if (saved && currentRow.current === rowId) tab.location.replace(url.toString());
      else tab.close();
    });
  };

  useDatabaseRestoreNotice(context?.workspaceId || '', open ? context?.databaseDoc?.guid : undefined);

  return (
    <RowPeekSurface
      mode={mode}
      open={open}
      hideBackdrop={!!openPageModalViewId}
      onClose={close}
      prepare={prepare}
      closeImmediately={closeImmediately}
    >
      <RowPeekNavigationContext.Provider value={navigation}>
        <div
          ref={contentRef}
          data-testid='row-detail'
          data-peek-mode={side ? 'side' : 'center'}
          className='flex h-full min-h-0 w-full flex-col'
        >
          <div
            data-testid='row-detail-header'
            className='flex h-12 shrink-0 items-center gap-1 border-b border-border-primary px-2'
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  data-testid='row-detail-close'
                  aria-label={t('button.close')}
                  onClick={close}
                >
                  {openPageModalViewId ? <ArrowLeftIcon className='h-5 w-5' /> : <PanelRightClose className='h-5 w-5' />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('button.close')}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  data-testid='row-peek-mode-menu'
                  aria-label={t('grid.rowPage.switchPeekMode')}
                >
                  {side ? <PanelRight className='h-5 w-5' /> : <Square className='h-5 w-5' />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-60'>
                <DropdownMenuLabel>{t('grid.rowPage.openPageIn')}</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!layout?.canShow || !!openPageModalViewId}
                  data-testid='row-peek-mode-side'
                  onSelect={() => setMode('side')}
                >
                  <PanelRight className='h-5 w-5' />
                  {t('grid.rowPage.sidePeek')}
                  {side ? <Check className='ml-auto h-4 w-4' /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid='row-peek-mode-center' onSelect={() => setMode('center')}>
                  <Square className='h-5 w-5' />
                  {t('grid.rowPage.centerPeek')}
                  {!side ? <Check className='ml-auto h-4 w-4' /> : null}
                </DropdownMenuItem>
                {openPage ? (
                  <DropdownMenuItem onSelect={() => void openFullPage()}>
                    <ExpandIcon />
                    {t('grid.rowPage.openAsFullPage')}
                  </DropdownMenuItem>
                ) : null}
                {canOpenNewTab ? (
                  <DropdownMenuItem data-testid='row-peek-new-tab' onSelect={openNewTab}>
                    <OpenIcon />
                    {t('disclosureAction.openNewTab')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <RowPeekRowNavigation rowId={rowId} />
            <div className='flex-1' />
            {openPage ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='row-detail-open-full-page'
                    size='icon'
                    variant='ghost'
                    aria-label={t('grid.rowPage.openAsFullPage')}
                    onClick={() => void openFullPage()}
                  >
                    <ExpandIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('grid.rowPage.openAsFullPage')}</TooltipContent>
              </Tooltip>
            ) : null}
            {!readOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size='icon'
                    variant='ghost'
                    data-testid='row-detail-more-actions'
                    aria-label={t('grid.rowPage.moreRowActions')}
                  >
                    <MoreIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className='w-fit min-w-fit'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      data-testid='row-detail-duplicate'
                      disabled={duplicateLoading}
                      onSelect={async () => {
                        if (duplicateLoading || !(await prepare()) || currentRow.current !== rowId) return;
                        setDuplicateLoading(true);
                        try {
                          await duplicateRow?.(rowId);
                          if (currentRow.current === rowId) closeImmediately();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t('error.generalError'));
                        } finally {
                          setDuplicateLoading(false);
                        }
                      }}
                    >
                      {duplicateLoading ? <Progress variant='primary' /> : <DuplicateIcon className='h-5 w-5' />}
                      {t('grid.row.duplicate')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant='destructive'
                      data-testid='row-detail-delete'
                      onSelect={async () => {
                        if (!(await prepare()) || currentRow.current !== rowId) return;
                        try {
                          await deleteRows([rowId]);
                          if (currentRow.current === rowId) closeImmediately();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t('error.generalError'));
                        }
                      }}
                    >
                      <DeleteIcon className='h-5 w-5' />
                      {t('grid.row.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <AFScroller overflowXHidden className='appflowy-scroll-container w-full flex-1'>
            <DatabaseRow key={rowId} rowId={rowId} compact={side} />
          </AFScroller>
        </div>
      </RowPeekNavigationContext.Provider>
    </RowPeekSurface>
  );
}

export default DatabaseRowModal;
