import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContextOptional, useReadOnly } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/double_arrow_right.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The Duplicate / Delete menu of an open record. */
function RowActionsMenu({ rowId, onClose }: { rowId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const deleteRows = useTrashAwareDeleteRowsDispatch();
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={'h-7 w-7'}>
            <DropdownMenuTrigger asChild>
              <Button size={'icon'} variant='ghost' data-testid='row-detail-more-actions'>
                <MoreIcon />
              </Button>
            </DropdownMenuTrigger>
          </div>
        </TooltipTrigger>
        <TooltipContent>{t('grid.rowPage.moreRowActions')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className={' w-fit min-w-fit'}>
        <DropdownMenuGroup>
          <DropdownMenuItem
            data-testid='row-detail-duplicate'
            onSelect={async () => {
              if (duplicateLoading) return;
              setDuplicateLoading(true);
              try {
                await duplicateRow?.(rowId);
                onClose();
                // eslint-disable-next-line
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setDuplicateLoading(false);
              }
            }}
          >
            {duplicateLoading ? <Progress variant={'primary'} /> : <DuplicateIcon className={'h-5 w-5'} />}

            {t('grid.row.duplicate')}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant={'destructive'}
            data-testid='row-detail-delete'
            onSelect={() => {
              void deleteRows([rowId]).catch((e: Error) => {
                toast.error(e.message);
              });
              onClose();
            }}
          >
            <DeleteIcon className={'h-5 w-5'} />
            {t('grid.row.delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderButton({
  testId,
  label,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} data-testid={testId} onClick={onClick} size={'icon'} variant='ghost'>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Opens the record as a full page, then closes the peek. */
function FullPageButton({
  rowId,
  testId,
  openPage,
  onClose,
}: {
  rowId: string;
  testId: string;
  openPage: (rowId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <HeaderButton
      label={t('grid.rowPage.openAsFullPage')}
      onClick={() => {
        openPage(rowId);
        onClose();
      }}
      testId={testId}
    >
      <ExpandIcon />
    </HeaderButton>
  );
}

interface PeekHeaderProps {
  rowId: string;
  onClose: () => void;
  /** Open the record as a full page; the control is hidden without it. */
  openPage?: (rowId: string) => void;
}

/**
 * The title bar of the centre peek (`DatabaseRowModal`): Back (inside a page
 * modal), Open as full page and the row actions, right-aligned.
 */
export function CenterPeekHeader({ rowId, onClose, openPage }: PeekHeaderProps) {
  const openPageModalViewId = useDatabaseContextOptional()?.openPageModalViewId;
  const readOnly = useReadOnly();

  return (
    <>
      <div className='flex flex-1 items-center'>
        {openPageModalViewId ? (
          <HeaderButton label='Go back' onClick={onClose} testId='row-detail-back'>
            <ArrowLeftIcon className='h-5 w-5' />
          </HeaderButton>
        ) : null}
      </div>

      {openPage ? (
        <FullPageButton onClose={onClose} openPage={openPage} rowId={rowId} testId='row-detail-open-full-page' />
      ) : null}
      {!readOnly ? <RowActionsMenu onClose={onClose} rowId={rowId} /> : null}
    </>
  );
}

export interface SidePeekHeaderProps extends PeekHeaderProps {
  /** Close the peek and open the centre peek for the same record. */
  onSwitchToCenter?: () => void;
}

/**
 * The 44px header of the side peek (WP13 §3.9): Close, Open as full page and
 * Open in center peek on the left, the row actions on the right. The row
 * actions keep their test ids in both headers.
 */
export function SidePeekHeader({ rowId, onClose, openPage, onSwitchToCenter }: SidePeekHeaderProps) {
  const readOnly = useReadOnly();
  const { t } = useTranslation();

  return (
    <>
      <div className='flex flex-1 items-center gap-1'>
        <HeaderButton label={t('button.close', { defaultValue: 'Close' })} onClick={onClose} testId='row-side-peek-close'>
          <CloseIcon />
        </HeaderButton>
        {openPage ? (
          <FullPageButton onClose={onClose} openPage={openPage} rowId={rowId} testId='row-side-peek-full-page' />
        ) : null}
        {onSwitchToCenter ? (
          <HeaderButton
            label={t('grid.rowPage.openInCenterPeek', { defaultValue: 'Open in center peek' })}
            onClick={onSwitchToCenter}
            testId='row-side-peek-center'
          >
            <CenterPeekIcon className='h-4 w-4' />
          </HeaderButton>
        ) : null}
      </div>
      {!readOnly ? <RowActionsMenu onClose={onClose} rowId={rowId} /> : null}
    </>
  );
}
