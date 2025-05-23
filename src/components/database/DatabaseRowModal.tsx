import { useDeleteRowDispatch, useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import DatabaseRow from '@/components/database/DatabaseRow';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import React, { useState } from 'react';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { toast } from 'sonner';

function DatabaseRowModal ({ open, onOpenChange, rowId, openPage }: {
  open: boolean;
  rowId: string;
  onOpenChange: (open: boolean) => void;
  openPage?: (rowId: string) => void;
}) {
  // const {} = useDatabaseContext();
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const deleteRow = useDeleteRowDispatch();
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
        onOpenAutoFocus={e => {
          e.preventDefault();
        }}
        showCloseButton={false}
        className={'flex flex-col min-w-[80vw] min-h-[80vh]'}
      >
        <DialogHeader>
          <DialogTitle className={'flex-1 flex items-center justify-end'}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size={'icon'}
                  variant="ghost"
                  onClick={() => {
                    openPage?.(rowId);
                    onOpenChange(false);
                  }}
                >
                  <ExpandIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('grid.rowPage.openAsFullPage')}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size={'icon'}
                      variant="ghost"
                      onClick={() => onOpenChange(false)}
                    >
                      <MoreIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('grid.rowPage.moreRowActions')}
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={' min-w-fit w-fit'}>
                <DropdownMenuGroup>
                  <DropdownMenuItem
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
                    {duplicateLoading ? (<Progress variant={'primary'} />) : <DuplicateIcon className={'w-5 h-5'} />}

                    {t('grid.row.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={'hover:text-text-error'}
                    onSelect={() => {
                      deleteRow?.(rowId);
                      onOpenChange(false);
                    }}
                  >
                    <DeleteIcon className={'w-5 h-5'} />
                    {t('grid.row.delete')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogTitle>

        </DialogHeader>
        <div
          className={'flex-1 appflowy-scroller overflow-hidden overflow-y-auto'}
        >
          <DatabaseRow
            rowId={rowId}
          />
        </div>

      </DialogContent>
    </Dialog>
  );
}

export default DatabaseRowModal;