import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContext } from '@/application/database-yjs';
import { useDeleteRowDispatch, useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { DatabaseRow } from '@/components/database/DatabaseRow';
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

function DatabaseRowModal({
  open,
  onOpenChange,
  rowId,
  openPage,
}: {
  open: boolean;
  rowId: string;
  onOpenChange: (open: boolean) => void;
  openPage?: (rowId: string) => void;
}) {
  const { openPageModalViewId } = useDatabaseContext();
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const deleteRow = useDeleteRowDispatch();
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={() => {
        onOpenChange(false);
      }}
      fullWidth={true}
      keepMounted={false}
      disableAutoFocus={false}
      disableEnforceFocus={false}
      disableRestoreFocus={true}
      hideBackdrop={!!openPageModalViewId}
      PaperProps={{
        className: `max-w-[70vw] relative w-[1188px] h-[80vh] overflow-hidden flex flex-col`,
      }}
    >
      <DialogContent className={'flex h-full w-full flex-col px-0 py-0'}>
        <DialogTitle className={'flex max-h-[48px] flex-1 items-center justify-end gap-2 px-2'}>
          <div className='flex flex-1 items-center'>
            {openPageModalViewId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size={'icon'}
                    variant='ghost'
                    onClick={() => {
                      onOpenChange(false);
                    }}
                  >
                    <ArrowLeftIcon className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Go back</TooltipContent>
              </Tooltip>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={'icon'}
                variant='ghost'
                onClick={() => {
                  openPage?.(rowId);
                  onOpenChange(false);
                }}
              >
                <ExpandIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('grid.rowPage.openAsFullPage')}</TooltipContent>
          </Tooltip>
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
                      onOpenChange(false);
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
                    deleteRow?.(rowId);
                    onOpenChange(false);
                  }}
                >
                  <DeleteIcon className={'h-5 w-5'} />
                  {t('grid.row.delete')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogTitle>

        <AFScroller overflowXHidden className={'appflowy-scroll-container w-full flex-1'}>
          <DatabaseRow rowId={rowId} />
        </AFScroller>
      </DialogContent>
    </Dialog>
  );
}

export default DatabaseRowModal;
