import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContextOptional, useReadOnly } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch';
import { UIVariant } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { useDatabaseRestoreNotice } from '@/components/app/DatabaseRestoreNotice';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import { RowPeekHeader } from '@/components/database/row-peek/RowPeekHeader';
import { useRowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import {
  createRowPeekNavigation,
  hasRowPeekOverlay,
  RowPeekNavigationContext,
} from '@/components/database/row-peek/RowPeekNavigation';
import { RowPeekMode, RowPeekSurface } from '@/components/database/row-peek/RowPeekSurface';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import '@/components/database/row-peek/row-peek.css';

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
  const duplicatePending = useRef(false);
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
  const rowUrl =
    canOpenNewTab && context
      ? new URL(`/app/${context.workspaceId}/${context.databasePageId}`, window.location.origin)
      : undefined;

  rowUrl?.searchParams.set('v', context?.activeViewId || '');
  rowUrl?.searchParams.set('r', rowId);
  const openNewTab = () => {
    if (!rowUrl) return;
    // Reserve the tab in the click event; browsers block window.open after an
    // asynchronous editor commit. A rejected draft closes only this blank tab.
    const tab = window.open('about:blank', '_blank');

    if (!tab) return;
    tab.opener = null;
    void prepare().then((saved) => {
      if (saved && currentRow.current === rowId) tab.location.replace(rowUrl.toString());
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
          className='row-peek flex h-full min-h-0 w-full flex-col'
        >
          <RowPeekHeader
            rowId={rowId}
            side={side}
            canShowSide={layout?.canShow === true && !openPageModalViewId}
            nested={!!openPageModalViewId}
            onClose={close}
            onModeChange={setMode}
            onOpenFullPage={openPage ? () => void openFullPage() : undefined}
            onOpenNewTab={canOpenNewTab ? openNewTab : undefined}
            prepare={prepare}
            shareUrl={rowUrl?.toString()}
          >
            {!readOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='row-peek-icon-button'
                    data-testid='row-detail-more-actions'
                    aria-label={t('grid.rowPage.moreRowActions')}
                  >
                    <MoreIcon className='h-5 w-5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className='w-fit min-w-fit'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      data-testid='row-detail-duplicate'
                      disabled={duplicateLoading}
                      onSelect={async () => {
                        if (duplicatePending.current) return;
                        duplicatePending.current = true;
                        setDuplicateLoading(true);
                        try {
                          if (!(await prepare()) || currentRow.current !== rowId) return;
                          await duplicateRow?.(rowId);
                          if (currentRow.current === rowId) closeImmediately();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t('error.generalError'));
                        } finally {
                          duplicatePending.current = false;
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
          </RowPeekHeader>
          <AFScroller overflowXHidden className='appflowy-scroll-container w-full flex-1'>
            <DatabaseRow key={rowId} rowId={rowId} compact={side} />
          </AFScroller>
        </div>
      </RowPeekNavigationContext.Provider>
    </RowPeekSurface>
  );
}

export default DatabaseRowModal;
